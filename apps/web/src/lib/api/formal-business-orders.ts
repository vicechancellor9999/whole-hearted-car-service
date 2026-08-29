import { notifyFormalDataChanged } from "../formal-data-changes";

export type FormalBusinessOrderStatus =
  | "waiting_assignment"
  | "assigned"
  | "in_repair"
  | "return_pending_review"
  | "formally_handed_off";

export type FormalBusinessOrder = {
  id: number;
  orderNo: string;
  vehicleId: number;
  payer: {
    type: "person" | "company";
    displayName: string;
    phone: string | null;
    trn: string | null;
    contactName: string | null;
  };
  vehicle: { plate: string; description: string; vin: string | null };
  status: FormalBusinessOrderStatus;
  currentChargeVersionNo: number;
  createdAt: string;
  voided: boolean;
  voidReason: string | null;
  version: number;
};

export type FormalChargeSnapshot = {
  id: number;
  businessOrderId: number;
  versionNo: number;
  reason: string;
  totals: {
    grossMinor: number;
    lineDiscountMinor: number;
    laborDiscountMinor: number;
    partDiscountMinor: number;
    otherDiscountMinor: number;
    categoryDiscountMinor: number;
    wholeOrderDiscountMinor: number;
    totalDueMinor: number;
    includedGctMinor: number;
  };
  items: Array<{
    id: number;
    kind: "labor" | "part" | "other";
    nameZh: string;
    nameEn: string | null;
    descriptionZh: string | null;
    descriptionEn: string | null;
    unitItemId: number;
    quantity: string;
    unitPriceMinor: number;
    itemDiscountMinor: number;
    subtotalMinor: number;
    sortOrder: number;
  }>;
  notes: Array<{
    id: number;
    kind: string;
    contentZh: string | null;
    contentEn: string | null;
    sortOrder: number;
  }>;
  businessOrderVersion: number;
};

export function formalGroupedChargeDiscounts(charges: {
  items: ReadonlyArray<{
    kind: "labor" | "part" | "other";
    itemDiscountMinor: number;
  }>;
  totals: {
    laborDiscountMinor: number;
    partDiscountMinor: number;
    otherDiscountMinor: number;
  };
}) {
  const itemDiscounts = charges.items.reduce(
    (totals, item) => {
      totals[item.kind] += item.itemDiscountMinor;
      return totals;
    },
    { labor: 0, part: 0, other: 0 },
  );

  return {
    laborDiscountMinor: itemDiscounts.labor + charges.totals.laborDiscountMinor,
    partDiscountMinor: itemDiscounts.part + charges.totals.partDiscountMinor,
    otherDiscountMinor: itemDiscounts.other + charges.totals.otherDiscountMinor,
  };
}

export type FormalLedgerTransaction = {
  type: "payment" | "refund";
  id: number;
  referenceNo: string;
  amountMinor: number;
  methodCode: string;
  methodLabelZh: string;
  methodLabelEn: string | null;
  occurredAt: string;
  note: string | null;
  receiptId: number | null;
};

export type FormalBusinessOrderLedger = {
  businessOrderId: number;
  currentDueMinor: number;
  totalPaidMinor: number;
  totalRefundedMinor: number;
  balanceMinor: number;
  transactions: FormalLedgerTransaction[];
};

export type FormalRefundEvidence = {
  fileId?: number;
  kind: "refund_proof" | "customer_signature";
  originalName?: string;
};

export type FormalRefund = {
  id: number;
  refundNo: string;
  paymentMethodCode: string;
  paymentMethodLabelZh: string;
  amountMinor: number;
  reason: string;
  originalDocumentStatus: "returned" | "unavailable";
  originalDocumentNote: string | null;
  refundedAt: string;
  evidence: FormalRefundEvidence[];
};

export type FormalPaymentMethod = {
  id: number;
  code: string;
  labelZh: string;
  labelEn: string | null;
};

export type FormalChargeUnit = FormalPaymentMethod;

export type FormalReceipt = {
  id: number;
  receiptNo: string;
  businessOrderId: number;
  paymentId: number;
  issuedAt: string;
  issuedBy: number;
  snapshot: FormalReceiptSnapshot;
};

export type FormalReceiptSnapshot = {
  version: 1;
  businessOrder: {
    id: number;
    orderNo: string;
    plate: string;
    vehicleDescription: string;
    vin: string | null;
    payerName: string;
    payerPhone: string | null;
    payerTrn: string | null;
    payerContactName: string | null;
  };
  charges: FormalPrintableCharges;
  transactions: FormalPrintableTransaction[];
  currentPayment: {
    paymentNo: string;
    amountMinor: number;
    methodCode: string;
    methodLabelZh: string;
    methodLabelEn: string | null;
    paidAt: string;
    note: string | null;
  };
  totals: {
    currentDueMinor: number;
    totalPaidMinor: number;
    totalRefundedMinor: number;
    balanceAfterMinor: number;
  };
};

export type FormalPrintableCharges = {
  versionNo: number;
  totals: FormalChargeSnapshot["totals"];
  items: Array<Omit<FormalChargeSnapshot["items"][number], "id" | "unitItemId" | "sortOrder"> & {
    unitLabelZh: string;
    unitLabelEn: string | null;
  }>;
  notes: Array<{
    kind: "customer_concern" | "work_instruction" | "liability_notice" | "internal";
    contentZh: string | null;
    contentEn: string | null;
  }>;
};

export type FormalPrintableTransaction = {
  type: "payment" | "refund";
  referenceNo: string;
  amountMinor: number;
  methodCode: string;
  methodLabelZh: string;
  methodLabelEn: string | null;
  occurredAt: string;
  note: string | null;
};

export type FormalBusinessOrderDocument = {
  id: number;
  documentNo: string;
  businessOrderId: number;
  kind: "customer_copy" | "office_archive" | "mechanic_work";
  chargeVersionId: number;
  chargeVersionNo: number;
  repairRoundId: number | null;
  repairRoundNo: number | null;
  generatedAt: string;
  generatedBy: number;
  snapshot: FormalCustomerCopySnapshot | FormalOfficeArchiveSnapshot | FormalMechanicWorkSnapshot;
};

export type FormalBusinessOrderDocumentRevision = {
  id: number;
  documentId: number;
  revisionNo: number;
  fieldOverrides: Record<string, string>;
  rendererVersion: string;
  fileId: number;
  contentSha256: string;
  englishFileId: number | null;
  englishContentSha256: string | null;
  createdAt: string;
  createdBy: number;
};

export type FormalBusinessOrderDocumentDetail = {
  document: FormalBusinessOrderDocument;
  revisions: FormalBusinessOrderDocumentRevision[];
  latestRevisionNo: number;
};

export type FormalCustomerCopySnapshot = {
  version: 1;
  kind: "customer_copy";
  businessOrder: FormalReceiptSnapshot["businessOrder"];
  charges: FormalPrintableCharges;
  transactions: FormalPrintableTransaction[];
  totals: {
    currentDueMinor: number;
    totalPaidMinor: number;
    totalRefundedMinor: number;
    balanceMinor: number;
  };
  approval: { statementZh: string; statementEn: string };
};

export type FormalOfficeArchiveSnapshot = {
  version: 1;
  kind: "office_archive";
  presentation?: "office_english_primary_v1";
  businessOrder: FormalReceiptSnapshot["businessOrder"];
  charges: FormalPrintableCharges;
  transactions: FormalPrintableTransaction[];
  totals: {
    currentDueMinor: number;
    totalPaidMinor: number;
    totalRefundedMinor: number;
    balanceMinor: number;
  };
  approval: { statementZh: string; statementEn: string };
};

export function formalOfficeArchiveUsesEnglishPrimary(
  snapshot: Pick<FormalOfficeArchiveSnapshot, "version" | "kind" | "presentation">,
): boolean {
  return snapshot.presentation === "office_english_primary_v1";
}

export type FormalMechanicWorkSnapshot = {
  version: 1;
  kind: "mechanic_work";
  businessOrder: { id: number; orderNo: string };
  vehicle: { plate: string; description: string; vin: string | null };
  repairRound: { id: number; roundNo: number; teamName: string | null };
  workItems: Array<{
    kind: "labor" | "part" | "other";
    nameZh: string;
    descriptionZh: string | null;
    unitLabelZh: string;
    quantity: string;
  }>;
  notes: Array<{
    kind: "customer_concern" | "work_instruction" | "liability_notice";
    contentZh: string;
  }>;
};

export type FormalBusinessOrderList = {
  items: FormalBusinessOrder[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
};

export type FormalBusinessOrderDetail = {
  order: FormalBusinessOrder;
  charges: FormalChargeSnapshot;
  ledger: FormalBusinessOrderLedger;
  refunds: FormalRefund[];
  documents: FormalBusinessOrderDocument[];
  paymentMethods: FormalPaymentMethod[];
  chargeUnits: FormalChargeUnit[];
  currentAccountId: number;
  unreadMentionCount: number;
  capabilities: {
    canWrite: boolean;
    canRecordPayment: boolean;
    canRefund: boolean;
    canCollaborate: boolean;
  };
};

export type FormalChargeVersionInput = {
  expectedBusinessOrderVersion: number;
  reason: string;
  laborDiscount: string;
  partDiscount: string;
  otherDiscount: string;
  wholeOrderDiscount: string;
  items: Array<{
    kind: "labor" | "part" | "other";
    nameZh: string;
    nameEn?: string | null;
    descriptionZh?: string | null;
    descriptionEn?: string | null;
    unitItemId: number;
    quantity: string;
    unitPrice: string;
    itemDiscount: string;
  }>;
  notes: Array<{
    kind: "customer_concern" | "work_instruction" | "liability_notice" | "internal";
    contentZh?: string | null;
    contentEn?: string | null;
  }>;
};

export type FormalRepairRound = {
  id: number;
  businessOrderId: number;
  roundNo: number;
  source: "initial" | "after_sales";
  afterSalesIssue: string | null;
  status: FormalBusinessOrderStatus;
  assignedTeamId: number | null;
  intakeMileageKm: number | null;
  intakePhotoFileIds: number[];
  latestWorkReturnId: number | null;
  approvedWorkReturnId: number | null;
  latestWorkReturn: FormalWorkReturn | null;
  version: number;
};

export type FormalWorkReturnItemResult = {
  chargeItemId: string;
  category: "labor" | "part" | "other";
  labelZh: string;
  labelEn?: string | null;
  result: "completed" | "not_completed";
  note?: string | null;
};

export type FormalWorkReturn = {
  id: number;
  submissionNo: number;
  submissionSource: "electronic" | "paper";
  workSummary: string | null;
  exceptionSummary: string | null;
  itemResults: FormalWorkReturnItemResult[];
  actualStaffMemberId: number | null;
  actualStaffName: string | null;
  submittedBy: number;
  submittedByName: string;
  submittedAt: string;
  attachments: Array<{ id: number; purpose: "paper_return" | "service_photo"; originalName: string; mediaType: string }>;
  review: null | {
    result: "approved" | "rejected";
    reason: string | null;
    reviewerAccountId: number;
    reviewerName: string;
    reviewedAt: string;
  };
};

export type FormalMechanicWorkOrderSummary = {
  businessOrderId: number;
  orderNo: string;
  status: FormalBusinessOrderStatus;
  vehicle: { plate: string; description: string; vin: string | null };
  repairRound: { id: number; roundNo: number; assignedTeamId: number; assignedTeamName: string; version: number };
  latestRejectionReason: string | null;
};

export type FormalMechanicWorkOrder = FormalMechanicWorkOrderSummary & {
  intakeMileageKm: number | null;
  intakePhotoFileIds: number[];
  workItems: Array<{
    id: string;
    kind: "labor" | "part" | "other";
    nameZh: string;
    nameEn: string | null;
    descriptionZh: string | null;
    descriptionEn: string | null;
    quantity: string;
  }>;
  notes: Array<{
    kind: "customer_concern" | "work_instruction" | "liability_notice";
    contentZh: string | null;
    contentEn: string | null;
  }>;
  latestWorkReturn: FormalWorkReturn | null;
};

export type FormalRepairRoundWorkspace = {
  current: FormalRepairRound;
  auditTrail: Array<{
    id: number;
    occurredAt: string;
    actorAccountId: number | null;
    actorDisplayName: string | null;
    actorUsername: string | null;
    eventType: string;
    objectType: string;
    objectId: string;
    reason: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>;
  history: Array<FormalRepairRound & {
    createdAt: string;
    createdBy: number;
    updatedAt: string;
    events: Array<{
      id: number;
      eventType: string;
      teamId: number | null;
      workReturnId: number | null;
      note: string | null;
      actorAccountId: number;
      occurredAt: string;
    }>;
    formalHandoffs: Array<{ id: number; handoffNo: number; performanceMinor: number; jamaicaMonth: string; handedOffAt: string; cancelledAt: string | null }>;
  }>;
};

const STATUS_LABELS: Record<FormalBusinessOrderStatus, string> = {
  waiting_assignment: "待派单",
  assigned: "已派单",
  in_repair: "维修中",
  return_pending_review: "回单待审核",
  formally_handed_off: "已交单",
};

const STATUS_LABELS_EN: Record<FormalBusinessOrderStatus, string> = {
  waiting_assignment: "Awaiting assignment",
  assigned: "Assigned",
  in_repair: "In repair",
  return_pending_review: "Work return awaiting review",
  formally_handed_off: "Formally handed off",
};

export function formalBusinessOrderStatusLabel(status: FormalBusinessOrderStatus, language: "zh" | "en" = "zh"): string {
  return language === "en" ? STATUS_LABELS_EN[status] : STATUS_LABELS[status];
}

export function formalDocumentKindLabel(kind: FormalBusinessOrderDocument["kind"], language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    if (kind === "customer_copy") return "Customer copy";
    return kind === "office_archive" ? "Office signature archive" : "Mechanic work copy";
  }
  if (kind === "customer_copy") return "客户联";
  return kind === "office_archive" ? "办公室签字留底联" : "维修工联";
}

export function formatFormalMoney(valueMinor: number): string {
  const prefix = valueMinor < 0 ? "−" : "";
  return `${prefix}JMD ${(Math.abs(valueMinor) / 100).toLocaleString("en-JM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formalRefundNeedsProof(refund: Pick<FormalRefund, "paymentMethodCode" | "evidence">): boolean {
  return refund.paymentMethodCode !== "cash"
    && !refund.evidence.some((evidence) => evidence.kind === "refund_proof");
}

export function formalRefundHasSignedAcknowledgement(
  refund: Pick<FormalRefund, "evidence">,
): boolean {
  return refund.evidence.some((evidence) => evidence.kind === "customer_signature");
}

async function formalJson<ResponseBody>(input: RequestInfo | URL, init?: RequestInit): Promise<ResponseBody> {
  const response = await fetch(input, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { error?: unknown } & ResponseBody;
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "正式数据读取失败");
  }
  if (init?.method && init.method.toUpperCase() !== "GET") notifyFormalDataChanged();
  return payload;
}

export function fetchFormalBusinessOrders(input: {
  search?: string;
  status?: FormalBusinessOrderStatus;
  page?: number;
  pageSize?: number;
} = {}): Promise<FormalBusinessOrderList> {
  const query = new URLSearchParams();
  if (input.search) query.set("search", input.search);
  if (input.status) query.set("status", input.status);
  query.set("page", String(input.page ?? 1));
  query.set("pageSize", String(input.pageSize ?? 20));
  return formalJson(`/api/formal/business-orders?${query.toString()}`);
}

export function createFormalBusinessOrder(input: {
  vehicleId: number;
  companyContactId?: number | null;
}): Promise<FormalBusinessOrder> {
  return formalJson("/api/formal/business-orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function fetchFormalBusinessOrder(id: number): Promise<FormalBusinessOrderDetail> {
  return formalJson(`/api/formal/business-orders/${id}`);
}

export function fetchFormalRepairRounds(id: number): Promise<FormalRepairRoundWorkspace> {
  return formalJson(`/api/formal/business-orders/${id}/rounds`);
}

export function runFormalRepairRoundAction(id: number, input: Record<string, unknown>): Promise<FormalRepairRoundWorkspace & { result: unknown }> {
  return formalJson(`/api/formal/business-orders/${id}/rounds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function fetchFormalMechanicWorkOrders(): Promise<{ items: FormalMechanicWorkOrderSummary[] }> {
  return formalJson("/api/formal/mechanic/work-orders");
}

export function fetchFormalMechanicWorkOrder(id: number): Promise<FormalMechanicWorkOrder> {
  return formalJson(`/api/formal/mechanic/work-orders/${id}`);
}

export function cancelFormalHandoffInSameMonth(
  businessOrderId: number,
  input: { formalHandoffId: number; reason: string },
): Promise<FormalRepairRoundWorkspace & { result: unknown }> {
  return runFormalRepairRoundAction(businessOrderId, {
    action: "cancel_formal_handoff",
    formalHandoffId: input.formalHandoffId,
    reason: input.reason.trim(),
  });
}

export function replaceFormalChargeVersion(
  id: number,
  input: FormalChargeVersionInput,
): Promise<FormalChargeSnapshot> {
  return formalJson(`/api/formal/business-orders/${id}/charges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function recordFormalPayment(id: number, input: {
  amount: string;
  paymentMethodItemId: number;
  note?: string;
}): Promise<{ payment: unknown; receipt: { receiptNo: string } }> {
  return formalJson(`/api/formal/business-orders/${id}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function recordFormalRefund(id: number, formData: FormData): Promise<FormalRefund> {
  return formalJson(`/api/formal/business-orders/${id}/refunds`, {
    method: "POST",
    body: formData,
  });
}

export function appendFormalRefundProof(
  businessOrderId: number,
  refundId: number,
  formData: FormData,
): Promise<FormalRefund> {
  return formalJson(
    `/api/formal/business-orders/${businessOrderId}/refunds/${refundId}/proof`,
    { method: "POST", body: formData },
  );
}

export function appendFormalRefundSignedAcknowledgement(
  businessOrderId: number,
  refundId: number,
  formData: FormData,
): Promise<FormalRefund> {
  return formalJson(
    `/api/formal/business-orders/${businessOrderId}/refunds/${refundId}/signed-acknowledgement`,
    { method: "POST", body: formData },
  );
}

export function fetchFormalReceipt(businessOrderId: number, receiptId: number): Promise<FormalReceipt> {
  return formalJson(`/api/formal/business-orders/${businessOrderId}/receipts/${receiptId}`);
}

export function fetchFormalDocument(
  businessOrderId: number,
  documentId: number,
): Promise<FormalBusinessOrderDocument> {
  return formalJson(`/api/formal/business-orders/${businessOrderId}/documents/${documentId}`);
}

export function generateFormalDocument(
  businessOrderId: number,
  kind: FormalBusinessOrderDocument["kind"],
): Promise<FormalBusinessOrderDocument> {
  return formalJson(`/api/formal/business-orders/${businessOrderId}/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind }),
  });
}

export function fetchFormalDocumentDetail(
  businessOrderId: number,
  documentId: number,
): Promise<FormalBusinessOrderDocumentDetail> {
  return formalJson(`/api/formal/business-orders/${businessOrderId}/documents/${documentId}/revisions`);
}

export function createFormalDocumentRevision(
  businessOrderId: number,
  documentId: number,
  input: { expectedLatestRevisionNo: number; fieldOverrides: Record<string, string> },
): Promise<FormalBusinessOrderDocumentRevision> {
  return formalJson(`/api/formal/business-orders/${businessOrderId}/documents/${documentId}/revisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function formalDocumentRevisionFileUrl(
  businessOrderId: number,
  documentId: number,
  revisionId: number,
  options: { language: "zh" | "en"; download?: boolean } = { language: "zh" },
) {
  const url = `/api/formal/business-orders/${businessOrderId}/documents/${documentId}/revisions/${revisionId}/file`;
  const searchParams = new URLSearchParams();
  searchParams.set("language", options.language);
  if (options.download) searchParams.set("download", "1");
  return `${url}?${searchParams.toString()}`;
}
