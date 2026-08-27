import type { OrderTeamId } from "./types";

export type { OrderTeamId } from "./types";

export type VehiclePool = "ordinary" | "engineering" | "bodywork";
export type OrderAssignmentKind = "inspection" | "repair";
export type OrderAssignmentStatus =
  | "awaiting_acceptance"
  | "in_progress"
  | "blocked"
  | "returned"
  | "completed";

export type OrderOperationsStage =
  | "inspection_awaiting_dispatch"
  | "inspection_awaiting_acceptance"
  | "inspection_in_progress"
  | "inspection_awaiting_frontdesk"
  | "quote_awaiting_customer"
  | "quote_accepted_awaiting_order"
  | "repair_awaiting_dispatch"
  | "repair_awaiting_acceptance"
  | "repair_in_progress"
  | "blocked"
  | "returned_awaiting_frontdesk"
  | "awaiting_formal_handover"
  | "submitted_awaiting_collection"
  | "vehicle_collected";

export interface InspectionSuggestedLaborItem {
  readonly id: string;
  readonly name: string;
  readonly suggestedHours?: number;
  readonly quotedJmd: number;
}

export interface InspectionSuggestedPartItem {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly quotedUnitJmd?: number;
}

export interface InspectionPhoto {
  readonly id: string;
  readonly url: string;
  readonly caption?: string;
}

export interface InspectionSubmission {
  readonly id: string;
  readonly inspectionReportNo: string;
  readonly vehicleId: string;
  readonly inspectorId: string;
  readonly inspectorName: string;
  readonly inspectorTeamId: OrderTeamId;
  readonly submittedAt: string;
  readonly naturalLanguageResult: string;
  readonly suggestedLaborItems: ReadonlyArray<InspectionSuggestedLaborItem>;
  readonly suggestedPartItems: ReadonlyArray<InspectionSuggestedPartItem>;
  readonly photos: ReadonlyArray<InspectionPhoto>;
  readonly mileageKm?: number;
  readonly sourceVersion: number;
  readonly submissionSource: "mechanic_portal" | "mechanic_mobile";
}

export interface InspectionSubmissionInput extends InspectionSubmission {}

export interface InspectionAiDraftItem {
  readonly id: string;
  readonly title: string;
  readonly sourceFactRefs: ReadonlyArray<string>;
}

export interface InspectionAiDraft {
  readonly id: string;
  readonly inspectionReportNo: string;
  readonly sourceSubmissionId: string;
  readonly sourceSubmissionVersion: number;
  readonly generatedAt: string;
  readonly conclusion: string;
  readonly items: ReadonlyArray<InspectionAiDraftItem>;
  readonly customerExplanationZh: string;
  readonly customerExplanationEn?: string;
}

export interface InspectionAiDraftInput {
  readonly id: string;
  readonly generatedAt: string;
  readonly conclusion: string;
  readonly items: ReadonlyArray<InspectionAiDraftItem>;
  readonly customerExplanationZh: string;
  readonly customerExplanationEn?: string;
}

export type InspectionCustomerDecision = "pending" | "accepted" | "rejected" | "deferred";

export interface InspectionQuoteItem {
  readonly id: string;
  readonly description: string;
  readonly laborQuotedJmd: number;
  readonly partsQuotedJmd: number;
  readonly customerDecision: InspectionCustomerDecision;
  readonly sourceFactRefs: ReadonlyArray<string>;
}

export interface InspectionQuoteVersion {
  readonly id: string;
  readonly inspectionReportNo: string;
  readonly version: number;
  readonly versionLabel: `V${number}`;
  readonly sourceSubmissionId: string;
  readonly sourceSubmissionVersion: number;
  readonly sourceAiDraftId: string;
  readonly publishedAt: string;
  readonly publishedBy: Readonly<{ id: string; name: string }>;
  readonly items: ReadonlyArray<InspectionQuoteItem>;
}

export interface InspectionQuoteDocument {
  readonly id: string;
  readonly inspectionReportNo: string;
  readonly vehicleId: string;
  readonly sourceSubmissionId: string;
  readonly stage: OrderOperationsStage;
  readonly versions: ReadonlyArray<InspectionQuoteVersion>;
}

export interface BusinessOrderConversion {
  readonly id: string;
  readonly businessOrderId: string;
  readonly sourceInspectionReportNo: string;
  readonly sourceVersion: number;
  readonly sourceItemIds: ReadonlyArray<string>;
  readonly convertedAt: string;
  readonly convertedBy: Readonly<{ id: string; name: string }>;
}

export interface CreateBusinessOrderConversionInput {
  readonly id: string;
  readonly businessOrderId: string;
  readonly sourceVersion: number;
  readonly sourceItemIds: ReadonlyArray<string>;
  readonly convertedAt: string;
  readonly convertedBy: Readonly<{ id: string; name: string }>;
  readonly existingConversions: ReadonlyArray<BusinessOrderConversion>;
}

export interface AssignmentActor {
  readonly id: string;
  readonly name: string;
}

export interface AssignmentReassignment {
  readonly fromTeamId: OrderTeamId;
  readonly toTeamId: OrderTeamId;
  readonly reason: string;
  readonly actor: AssignmentActor;
  readonly changedAt: string;
}

export interface SourceInspectionAttribution {
  readonly submissionId: string;
  readonly inspectionReportNo: string;
  readonly inspectorId: string;
  readonly inspectorName: string;
  readonly inspectorTeamId: OrderTeamId;
  readonly submittedAt: string;
}

export interface OrderAssignment {
  readonly id: string;
  readonly vehicleId: string;
  readonly documentId: string;
  readonly kind: OrderAssignmentKind;
  readonly vehiclePool: VehiclePool;
  readonly firstAssignedTeamId: OrderTeamId;
  readonly firstAssignedAt: string;
  readonly teamId: OrderTeamId;
  readonly status: OrderAssignmentStatus;
  readonly assignedAt: string;
  readonly acceptedAt?: string;
  readonly completedAt?: string;
  readonly submittedAt?: string;
  readonly sourceInspection?: SourceInspectionAttribution;
  readonly reassignmentHistory: ReadonlyArray<AssignmentReassignment>;
}

export interface RepairOrderAssignment extends OrderAssignment {
  readonly kind: "repair";
  readonly sourceInspection: SourceInspectionAttribution;
}

export interface CreateRepairAssignmentInput {
  readonly id: string;
  readonly documentId: string;
  readonly vehiclePool: VehiclePool;
  readonly assignedAt: string;
  readonly status?: OrderAssignmentStatus;
  readonly acceptedAt?: string;
  readonly completedAt?: string;
  readonly submittedAt?: string;
}

export interface ReassignOrderAssignmentInput {
  readonly newTeamId: OrderTeamId;
  readonly reason: string;
  readonly actor: AssignmentActor;
  readonly changedAt: string;
}

const INSPECTION_REPORT_PATTERN = /^[A-Z][A-Z0-9]{1,7}-[A-Z][A-Z0-9]{1,7}-IR-\d{13}$/;
const ORDER_TEAM_IDS = new Set<OrderTeamId>(["t1", "t2", "t3", "t4"]);

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(Reflect.get(value, key));
  }
  return Object.freeze(value);
}

function assertText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label}不能为空`);
  }
}

function assertTimestamp(value: string, label: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new RangeError(`${label}必须是有效时间`);
  }
}

function assertInspectionReportNo(value: string): void {
  if (!INSPECTION_REPORT_PATTERN.test(value)) {
    throw new RangeError("检查报告编号格式无效");
  }
}

function assertTeamId(value: OrderTeamId): void {
  if (!ORDER_TEAM_IDS.has(value)) {
    throw new RangeError("班组无效");
  }
}

function cloneLaborItem(item: InspectionSuggestedLaborItem): InspectionSuggestedLaborItem {
  return {
    id: item.id,
    name: item.name,
    ...(item.suggestedHours === undefined ? {} : { suggestedHours: item.suggestedHours }),
    quotedJmd: item.quotedJmd,
  };
}

function clonePartItem(item: InspectionSuggestedPartItem): InspectionSuggestedPartItem {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    ...(item.quotedUnitJmd === undefined ? {} : { quotedUnitJmd: item.quotedUnitJmd }),
  };
}

export function createInspectionSubmission(input: InspectionSubmissionInput): InspectionSubmission {
  assertInspectionReportNo(input.inspectionReportNo);
  assertText(input.id, "检查提交 ID");
  assertText(input.vehicleId, "车辆 ID");
  assertText(input.inspectorId, "检查人 ID");
  assertText(input.inspectorName, "检查人姓名");
  assertTeamId(input.inspectorTeamId);
  assertTimestamp(input.submittedAt, "提交时间");
  assertText(input.naturalLanguageResult, "自然语言检查原文");
  if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1) {
    throw new RangeError("检查提交来源版本必须为正整数");
  }

  return deepFreeze({
    id: input.id,
    inspectionReportNo: input.inspectionReportNo,
    vehicleId: input.vehicleId,
    inspectorId: input.inspectorId,
    inspectorName: input.inspectorName,
    inspectorTeamId: input.inspectorTeamId,
    submittedAt: input.submittedAt,
    naturalLanguageResult: input.naturalLanguageResult,
    suggestedLaborItems: input.suggestedLaborItems.map(cloneLaborItem),
    suggestedPartItems: input.suggestedPartItems.map(clonePartItem),
    photos: input.photos.map((photo) => ({
      id: photo.id,
      url: photo.url,
      ...(photo.caption === undefined ? {} : { caption: photo.caption }),
    })),
    ...(input.mileageKm === undefined ? {} : { mileageKm: input.mileageKm }),
    sourceVersion: input.sourceVersion,
    submissionSource: input.submissionSource,
  });
}

export function createInspectionAiDraft(
  submission: InspectionSubmission,
  input: InspectionAiDraftInput,
): InspectionAiDraft {
  assertText(input.id, "AI 草稿 ID");
  assertTimestamp(input.generatedAt, "AI 草稿生成时间");
  assertText(input.conclusion, "AI 整理结论");
  assertText(input.customerExplanationZh, "客户说明");

  const availableSourceFactRefs = new Set([
    "naturalLanguageResult",
    ...(submission.mileageKm === undefined ? [] : ["mileageKm"]),
    ...submission.suggestedLaborItems.map((item) => `suggestedLaborItems:${item.id}`),
    ...submission.suggestedPartItems.map((item) => `suggestedPartItems:${item.id}`),
    ...submission.photos.map((photo) => `photos:${photo.id}`),
  ]);

  const items = input.items.map((item) => {
    assertText(item.id, "AI 草稿项目 ID");
    assertText(item.title, "AI 草稿项目标题");
    if (item.sourceFactRefs.length === 0) {
      throw new TypeError("AI 草稿项目必须引用至少一个原始检查事实");
    }
    if (new Set(item.sourceFactRefs).size !== item.sourceFactRefs.length) {
      throw new TypeError("AI 草稿项目不得重复引用同一原始检查事实");
    }
    return {
      id: item.id,
      title: item.title,
      sourceFactRefs: item.sourceFactRefs.map((reference) => {
        assertText(reference, "检查事实引用");
        if (!availableSourceFactRefs.has(reference)) {
          throw new RangeError(`检查事实引用 ${reference} 不存在或越界`);
        }
        return reference;
      }),
    };
  });

  return deepFreeze({
    id: input.id,
    inspectionReportNo: submission.inspectionReportNo,
    sourceSubmissionId: submission.id,
    sourceSubmissionVersion: submission.sourceVersion,
    generatedAt: input.generatedAt,
    conclusion: input.conclusion,
    items,
    customerExplanationZh: input.customerExplanationZh,
    ...(input.customerExplanationEn === undefined
      ? {}
      : { customerExplanationEn: input.customerExplanationEn }),
  });
}

export function createInspectionQuoteDocument(input: {
  readonly id: string;
  readonly sourceSubmission: InspectionSubmission;
  readonly stage: OrderOperationsStage;
}): InspectionQuoteDocument {
  assertText(input.id, "检查报价单 ID");
  return deepFreeze({
    id: input.id,
    inspectionReportNo: input.sourceSubmission.inspectionReportNo,
    vehicleId: input.sourceSubmission.vehicleId,
    sourceSubmissionId: input.sourceSubmission.id,
    stage: input.stage,
    versions: [],
  });
}

export function publishInspectionQuoteVersion(
  document: InspectionQuoteDocument,
  input: {
    readonly id: string;
    readonly sourceSubmission: InspectionSubmission;
    readonly sourceAiDraft: InspectionAiDraft;
    readonly publishedAt: string;
    readonly publishedBy: AssignmentActor;
    readonly items: ReadonlyArray<InspectionQuoteItem>;
  },
): InspectionQuoteDocument {
  if (
    input.sourceSubmission.inspectionReportNo !== document.inspectionReportNo
    || input.sourceSubmission.id !== document.sourceSubmissionId
  ) {
    throw new RangeError("报价版本来源检查提交与 IR 单据不一致");
  }
  if (
    input.sourceAiDraft.inspectionReportNo !== document.inspectionReportNo
    || input.sourceAiDraft.sourceSubmissionId !== input.sourceSubmission.id
    || input.sourceAiDraft.sourceSubmissionVersion !== input.sourceSubmission.sourceVersion
  ) {
    throw new RangeError("AI 草稿来源版本与检查提交不一致");
  }
  assertText(input.id, "报价版本 ID");
  assertTimestamp(input.publishedAt, "报价发布时间");
  assertText(input.publishedBy.id, "发布人 ID");
  assertText(input.publishedBy.name, "发布人姓名");

  const version = document.versions.length + 1;
  const quoteVersion: InspectionQuoteVersion = {
    id: input.id,
    inspectionReportNo: document.inspectionReportNo,
    version,
    versionLabel: `V${version}`,
    sourceSubmissionId: input.sourceSubmission.id,
    sourceSubmissionVersion: input.sourceSubmission.sourceVersion,
    sourceAiDraftId: input.sourceAiDraft.id,
    publishedAt: input.publishedAt,
    publishedBy: { id: input.publishedBy.id, name: input.publishedBy.name },
    items: input.items.map((item) => ({
      id: item.id,
      description: item.description,
      laborQuotedJmd: item.laborQuotedJmd,
      partsQuotedJmd: item.partsQuotedJmd,
      customerDecision: item.customerDecision,
      sourceFactRefs: [...item.sourceFactRefs],
    })),
  };

  return deepFreeze({
    ...document,
    stage: "quote_awaiting_customer" as const,
    versions: [...document.versions, quoteVersion],
  });
}

export function createBusinessOrderConversion(
  document: InspectionQuoteDocument,
  input: CreateBusinessOrderConversionInput,
): BusinessOrderConversion {
  assertText(input.id, "转换记录 ID");
  assertText(input.businessOrderId, "维修业务单 ID");
  assertTimestamp(input.convertedAt, "转换时间");
  assertText(input.convertedBy.id, "转换操作人 ID");
  assertText(input.convertedBy.name, "转换操作人姓名");

  const version = document.versions.find((item) => item.version === input.sourceVersion);
  if (version === undefined) {
    throw new RangeError("找不到指定的检查报价版本");
  }
  if (input.sourceItemIds.length === 0 || new Set(input.sourceItemIds).size !== input.sourceItemIds.length) {
    throw new RangeError("转换项目行必须非空且不得重复");
  }

  const itemsById = new Map(version.items.map((item) => [item.id, item]));
  for (const sourceItemId of input.sourceItemIds) {
    const item = itemsById.get(sourceItemId);
    if (item === undefined) {
      throw new RangeError(`找不到来源项目行 ${sourceItemId}`);
    }
    if (item.customerDecision !== "accepted") {
      throw new Error("只有客户已采用（accepted）的项目可以转换为维修业务单");
    }
    const alreadyConverted = input.existingConversions.some((conversion) =>
      conversion.sourceInspectionReportNo === document.inspectionReportNo
      && conversion.sourceVersion === input.sourceVersion
      && conversion.sourceItemIds.includes(sourceItemId));
    if (alreadyConverted) {
      throw new Error(`来源项目行 ${sourceItemId} 已经转换，不能重复成立业务单`);
    }
  }

  return deepFreeze({
    id: input.id,
    businessOrderId: input.businessOrderId,
    sourceInspectionReportNo: document.inspectionReportNo,
    sourceVersion: input.sourceVersion,
    sourceItemIds: [...input.sourceItemIds],
    convertedAt: input.convertedAt,
    convertedBy: { id: input.convertedBy.id, name: input.convertedBy.name },
  });
}

export function createRepairAssignmentFromInspection(
  submission: InspectionSubmission,
  input: CreateRepairAssignmentInput,
): RepairOrderAssignment {
  assertText(input.id, "派组 ID");
  assertText(input.documentId, "维修业务单 ID");
  assertTimestamp(input.assignedAt, "派组时间");
  if (input.submittedAt !== undefined) {
    assertTimestamp(input.submittedAt, "前台正式交单时间");
  }

  return deepFreeze({
    id: input.id,
    vehicleId: submission.vehicleId,
    documentId: input.documentId,
    kind: "repair",
    vehiclePool: input.vehiclePool,
    firstAssignedTeamId: submission.inspectorTeamId,
    firstAssignedAt: input.assignedAt,
    teamId: submission.inspectorTeamId,
    status: input.status ?? "awaiting_acceptance",
    assignedAt: input.assignedAt,
    ...(input.acceptedAt === undefined ? {} : { acceptedAt: input.acceptedAt }),
    ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
    ...(input.submittedAt === undefined ? {} : { submittedAt: input.submittedAt }),
    sourceInspection: {
      submissionId: submission.id,
      inspectionReportNo: submission.inspectionReportNo,
      inspectorId: submission.inspectorId,
      inspectorName: submission.inspectorName,
      inspectorTeamId: submission.inspectorTeamId,
      submittedAt: submission.submittedAt,
    },
    reassignmentHistory: [],
  });
}

export function reassignOrderAssignment(
  assignment: RepairOrderAssignment,
  input: ReassignOrderAssignmentInput,
): RepairOrderAssignment {
  if (assignment.submittedAt !== undefined) {
    throw new Error("前台正式交单后禁止普通改组");
  }
  assertTeamId(input.newTeamId);
  if (input.newTeamId === assignment.teamId) {
    throw new RangeError("新班组必须与当前班组不同");
  }
  assertText(input.reason, "改组原因");
  assertText(input.actor.id, "改组操作人 ID");
  assertText(input.actor.name, "改组操作人姓名");
  assertTimestamp(input.changedAt, "改组时间");

  const change: AssignmentReassignment = {
    fromTeamId: assignment.teamId,
    toTeamId: input.newTeamId,
    reason: input.reason.trim(),
    actor: { id: input.actor.id, name: input.actor.name },
    changedAt: input.changedAt,
  };

  return deepFreeze({
    ...assignment,
    teamId: input.newTeamId,
    assignedAt: input.changedAt,
    reassignmentHistory: [...assignment.reassignmentHistory, change],
  });
}
