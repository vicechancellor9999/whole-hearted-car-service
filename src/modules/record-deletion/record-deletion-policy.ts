import { createHash } from "node:crypto";
import type {
  DeletionBlocker,
  RecordDeletionPreview,
  RecordKind,
  RecordLocator,
  RecordReference,
  ReleasedIdentityKind,
} from "@formal/modules/record-deletion/record-deletion-types";

type CommonFact = {
  reference: RecordReference;
  linkedPrimaryRecords: RecordReference[];
  dependentCounts: Record<string, number>;
  releasedIdentityKinds: ReleasedIdentityKind[];
};

export type CustomerDeletionFact = CommonFact & {
  kind: "personal_customer" | "company_customer";
  externalBusinessFactCount: number;
};

export type VehicleDeletionFact = CommonFact & {
  kind: "vehicle";
  disputeCount: number;
  presenceFactCount: number;
  mileageRecordCount: number;
  repairFactCount: number;
  parkingFactCount: number;
};

export type BusinessOrderDeletionFact = CommonFact & {
  kind: "business_order";
  status: "waiting_assignment" | "assigned" | "in_repair" | "return_pending_review" | "formally_handed_off";
  repairRoundCount: number;
  afterSalesRoundCount: number;
  assignmentOrRepairEventCount: number;
  workReturnCount: number;
  mileageRecordCount: number;
  intakePhotoCount: number;
  paymentCount: number;
  refundCount: number;
  receiptCount: number;
  documentCount: number;
  handoffCount: number;
  pickupOrDepartureCount: number;
  parkingFactCount: number;
};

export type InspectionReportDeletionFact = CommonFact & {
  kind: "inspection_report";
  status: "draft" | "submitted";
  communicationCount: number;
  correctionLinkCount: number;
  formalDocumentReferenceCount: number;
};

export type RecordDeletionFact =
  | CustomerDeletionFact
  | VehicleDeletionFact
  | BusinessOrderDeletionFact
  | InspectionReportDeletionFact;

export type DeletionFacts = {
  root: RecordReference;
  records: RecordDeletionFact[];
};

export function evaluateDeletionGraph(
  root: RecordReference,
  selectedRecords: RecordLocator[],
  facts: DeletionFacts,
): RecordDeletionPreview {
  const factsByKey = new Map(facts.records.map((fact) => [recordKey(fact.reference), fact]));
  const rootFact = factsByKey.get(recordKey(root));
  if (!rootFact) throw new Error("删除资格资料缺少当前记录");

  const reachable = collectReachable(rootFact, factsByKey);
  const reachableKeys = new Set(reachable.map((fact) => recordKey(fact.reference)));
  const selectedKeys = new Set(selectedRecords.map(recordKey));
  const blockers: DeletionBlocker[] = [];

  for (const selected of selectedRecords) {
    const key = recordKey(selected);
    if (!factsByKey.has(key)) blockers.push(blocker("SELECTED_RECORD_NOT_FOUND", "所选记录已经不存在", selected));
    else if (!reachableKeys.has(key)) blockers.push(blocker("UNRELATED_RECORD_SELECTED", "所选记录不属于当前删除范围", selected));
  }

  for (const recordFact of reachable) {
    blockers.push(...intrinsicBlockers(recordFact));
    if (!selectedKeys.has(recordKey(recordFact.reference)) && recordKey(recordFact.reference) !== recordKey(root)) {
      blockers.push(linkedRecordBlocker(root.kind, recordFact.reference));
    }
  }

  if (!selectedKeys.has(recordKey(root))) {
    blockers.push(blocker("ROOT_RECORD_NOT_SELECTED", "删除范围必须包含当前记录", root));
  }

  const selectedFacts = reachable.filter((fact) => selectedKeys.has(recordKey(fact.reference)));
  const dependentCounts = aggregateDependentCounts(selectedFacts);
  const releasedIdentityKinds = aggregateReleasedIdentities(selectedFacts);
  const selectableLinkedRecords = reachable
    .map((fact) => fact.reference)
    .filter((reference) => recordKey(reference) !== recordKey(root))
    .sort(compareReferences);
  const sortedBlockers = dedupeBlockers(blockers).sort(compareBlockers);
  const previewFingerprint = fingerprint({
    root,
    selectedRecords: [...selectedRecords].sort(compareLocators),
    facts: reachable.map(normalizeFactForFingerprint).sort((left, right) => left.key.localeCompare(right.key)),
    dependentCounts,
    releasedIdentityKinds,
    blockers: sortedBlockers,
  });

  return {
    eligible: sortedBlockers.length === 0,
    rootRecord: root,
    selectableLinkedRecords,
    dependentCounts,
    releasedIdentityKinds,
    blockers: sortedBlockers,
    previewFingerprint,
  };
}

function collectReachable(
  root: RecordDeletionFact,
  factsByKey: Map<string, RecordDeletionFact>,
): RecordDeletionFact[] {
  const found = new Map<string, RecordDeletionFact>();
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const key = recordKey(current.reference);
    if (found.has(key)) continue;
    found.set(key, current);
    for (const linked of current.linkedPrimaryRecords) {
      const linkedFact = factsByKey.get(recordKey(linked));
      if (linkedFact && !found.has(recordKey(linked))) queue.push(linkedFact);
    }
  }
  return [...found.values()].sort((left, right) => compareReferences(left.reference, right.reference));
}

function intrinsicBlockers(fact: RecordDeletionFact): DeletionBlocker[] {
  const result: DeletionBlocker[] = [];
  if (fact.kind === "personal_customer" || fact.kind === "company_customer") {
    addCountBlocker(result, fact.externalBusinessFactCount, "HAS_CUSTOMER_BUSINESS_FACT", "客户已有不能删除的业务记录", fact.reference);
    return result;
  }
  if (fact.kind === "vehicle") {
    addCountBlocker(result, fact.disputeCount, "HAS_VEHICLE_DISPUTE", "车辆已有争议记录", fact.reference);
    addCountBlocker(result, fact.presenceFactCount, "HAS_VEHICLE_PRESENCE_FACT", "车辆已有进场、取车或离场记录", fact.reference);
    addCountBlocker(result, fact.mileageRecordCount, "HAS_MILEAGE_RECORD", "车辆已有里程记录", fact.reference);
    addCountBlocker(result, fact.repairFactCount, "HAS_REPAIR_FACT", "车辆已有维修记录", fact.reference);
    addCountBlocker(result, fact.parkingFactCount, "HAS_PARKING_FACT", "车辆已有停车记录", fact.reference);
    return result;
  }
  if (fact.kind === "business_order") {
    if (fact.status !== "waiting_assignment") {
      result.push(blocker("ORDER_PROGRESS_STARTED", "业务单已经进入维修流程", fact.reference));
    }
    if (fact.repairRoundCount !== 1) {
      result.push(blocker("INVALID_INITIAL_REPAIR_ROUND", "业务单维修轮次不符合删除条件", fact.reference));
    }
    addCountBlocker(result, fact.afterSalesRoundCount, "HAS_AFTER_SALES_ROUND", "业务单已有售后维修轮次", fact.reference);
    addCountBlocker(result, fact.assignmentOrRepairEventCount, "HAS_REPAIR_EVENT", "业务单已有派工、接单或维修操作", fact.reference);
    addCountBlocker(result, fact.workReturnCount, "HAS_WORK_RETURN", "业务单已有维修回单", fact.reference);
    addCountBlocker(result, fact.mileageRecordCount, "HAS_MILEAGE_RECORD", "业务单已有里程记录", fact.reference);
    addCountBlocker(result, fact.intakePhotoCount, "HAS_INTAKE_PHOTO", "业务单已有接车照片", fact.reference);
    addCountBlocker(result, fact.paymentCount, "HAS_PAYMENT", "业务单已有收款", fact.reference);
    addCountBlocker(result, fact.refundCount, "HAS_REFUND", "业务单已有退款", fact.reference);
    addCountBlocker(result, fact.receiptCount, "HAS_RECEIPT", "业务单已有 Receipt", fact.reference);
    addCountBlocker(result, fact.documentCount, "HAS_FORMAL_DOCUMENT", "业务单已有正式打印文件", fact.reference);
    addCountBlocker(result, fact.handoffCount, "HAS_FORMAL_HANDOFF", "业务单已有正式交单记录", fact.reference);
    addCountBlocker(result, fact.pickupOrDepartureCount, "HAS_PICKUP_OR_DEPARTURE", "业务单已有取车或离场记录", fact.reference);
    addCountBlocker(result, fact.parkingFactCount, "HAS_PARKING_FACT", "业务单已有停车记录", fact.reference);
    return result;
  }
  if (fact.kind !== "inspection_report") return result;
  if (fact.status === "submitted") {
    result.push(blocker("INSPECTION_SUBMITTED", "检查单已经提交", fact.reference));
  }
  addCountBlocker(result, fact.communicationCount, "HAS_CUSTOMER_COMMUNICATION", "检查单已有客户沟通记录", fact.reference);
  addCountBlocker(result, fact.correctionLinkCount, "HAS_INSPECTION_CORRECTION", "检查单已有更正关系", fact.reference);
  addCountBlocker(result, fact.formalDocumentReferenceCount, "HAS_FORMAL_DOCUMENT_REFERENCE", "检查单已被正式文件引用", fact.reference);
  return result;
}

function linkedRecordBlocker(rootKind: RecordKind, linked: RecordReference): DeletionBlocker {
  if (linked.kind === "business_order") return blocker("HAS_BUSINESS_ORDER", "存在关联业务单，请明确选择", linked);
  if (linked.kind === "inspection_report") return blocker("HAS_INSPECTION_REPORT", "存在关联检查单，请明确选择", linked);
  if (linked.kind === "vehicle") return blocker("HAS_VEHICLE", "存在关联车辆，请明确选择", linked);
  if ((rootKind === "personal_customer" || rootKind === "company_customer")
      && (linked.kind === "personal_customer" || linked.kind === "company_customer")) {
    return blocker("HAS_CUSTOMER_RELATION", "存在关联客户档案，请明确选择", linked);
  }
  return blocker("LINKED_RECORD_NOT_SELECTED", "存在关联记录，请明确选择", linked);
}

function addCountBlocker(
  target: DeletionBlocker[],
  count: number,
  code: string,
  label: string,
  reference: RecordReference,
): void {
  if (count > 0) target.push(blocker(code, label, reference));
}

function blocker(code: string, label: string, linked: RecordLocator | null): DeletionBlocker {
  return {
    code,
    label,
    linkedRecord: linked ? { kind: linked.kind, recordNo: linked.recordNo } : null,
  };
}

function aggregateDependentCounts(facts: RecordDeletionFact[]): Record<string, number> {
  const entries = new Map<string, number>();
  for (const fact of facts) {
    for (const [name, count] of Object.entries(fact.dependentCounts)) {
      entries.set(name, (entries.get(name) ?? 0) + count);
    }
  }
  return Object.fromEntries([...entries.entries()].filter(([, count]) => count > 0).sort(([left], [right]) => left.localeCompare(right)));
}

function aggregateReleasedIdentities(facts: RecordDeletionFact[]): ReleasedIdentityKind[] {
  const order: ReleasedIdentityKind[] = ["phone", "trn", "plate", "vin"];
  const present = new Set(facts.flatMap((fact) => fact.releasedIdentityKinds));
  return order.filter((identity) => present.has(identity));
}

function normalizeFactForFingerprint(fact: RecordDeletionFact) {
  const normalized = {
    ...fact,
    key: recordKey(fact.reference),
    linkedPrimaryRecords: [...fact.linkedPrimaryRecords].sort(compareReferences),
    dependentCounts: Object.fromEntries(Object.entries(fact.dependentCounts).sort(([left], [right]) => left.localeCompare(right))),
    releasedIdentityKinds: [...fact.releasedIdentityKinds].sort(),
  };
  return normalized;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function dedupeBlockers(blockers: DeletionBlocker[]): DeletionBlocker[] {
  return [...new Map(blockers.map((item) => [
    `${item.code}:${item.linkedRecord ? recordKey(item.linkedRecord) : "none"}`,
    item,
  ])).values()];
}

function compareBlockers(left: DeletionBlocker, right: DeletionBlocker): number {
  return `${left.code}:${left.linkedRecord ? recordKey(left.linkedRecord) : ""}`
    .localeCompare(`${right.code}:${right.linkedRecord ? recordKey(right.linkedRecord) : ""}`);
}

function compareReferences(left: RecordReference, right: RecordReference): number {
  return compareLocators(left, right) || left.version - right.version;
}

function compareLocators(left: RecordLocator, right: RecordLocator): number {
  return recordKey(left).localeCompare(recordKey(right));
}

function recordKey(record: RecordLocator): string {
  return `${record.kind}:${record.recordNo}`;
}
