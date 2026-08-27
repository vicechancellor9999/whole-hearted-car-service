import type { InspectionReportStatus } from "../orders/inspection-report";
import type { OrderTeamId } from "../orders/types";
import { businessDateInJamaica, formatInspectionReportNo } from "../orders/document-number";
import {
  DEFAULT_QUOTATION_NOTE_EN,
  DEFAULT_QUOTATION_NOTE_ZH,
  type GeneratedCustomerFileBundleMetadata,
} from "../orders/quotation";
import { WHOLE_HEARTED_COMPANY_IDENTITY } from "../company-identity";
import {
  IR_PDF_RENDERER_VERSION,
  type IrPdfLanguage,
  type IrPdfSource,
} from "../orders/ir-pdf-contract";
import {
  getIrGeneratedFileRepository,
  type IrGeneratedFileRepository,
  type IrGeneratedFileRecord,
} from "../orders/ir-generated-file-cache";
import {
  getReportPhotoRepository,
  inspectReportPhotoFile,
  resolveVerifiedReportPhoto,
  type ReportPhotoBlobRecord,
  type ReportPhotoRepository,
} from "../attachments/indexeddb-attachment-store";
import {
  calculateQuotedChargeTotals,
  validateQuotedChargeLine,
  type FixedTotalChargeLine,
  type QuotedChargeLine,
  type UnitPricedChargeLine,
} from "../billing/quoted-charges";
import {
  discountApprovalRequirement,
  discountSignatureStrokeDigest,
  validateDiscountApprovalEvidence,
  type DiscountApprovalEvidence,
} from "../billing/discount-approval";
import {
  getMockLinkedOperationsStore,
  LinkedApiDomainError,
  type LinkedImportedCommunicationEvent,
  type LinkedImportedCustomerResponseEvent,
  type LinkedCurrentCommunicationEvent,
  type LinkedCustomerResponseEvent,
  type LinkedFormalReportNotificationEvent,
  type LinkedClassifiedCustomerResponseEvent,
  type LinkedCommunicationFact,
  type LinkedInspectionReportFact,
  type LinkedOperationsState,
  type MockLinkedOperationsStore,
} from "./mock-orders";
import {
  appendSharedQuickOrderToState,
  type SharedQuickOrderMutationActor,
} from "./mock-quick-orders";
import type { QuickOrder, QuickOrderChargeLine } from "../orders/quick-order-types";
import { canonicalParkingNoticeFacts, type ParkingNoticeFacts } from "../parking/notice";
import { agingLevel, replyAgingDays } from "./mock-ir-followup";

export interface InspectionReportListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: InspectionReportStatus;
  teamId?: OrderTeamId;
  communication?: IrCommunicationFilter;
  sourceBusinessOrderId?: string;
}

export type IrCommunicationFilter = IrCommunicationStatus | Exclude<IrCurrentResponse, null>;

export interface InspectionReportListItem {
  id: string;
  sourceBusinessOrderId?: string;
  reportNo: string;
  customer: { id: string; nameZh: string; phone: string };
  vehicle: { id: string; plate: string; modelZh?: string; modelEn?: string };
  inspector: { id: string; name: string; teamId: OrderTeamId };
  status: InspectionReportStatus;
  sourceVersion: number;
  submittedAt: string;
  communicationStatus: IrCommunicationStatus;
  currentResponse: IrCurrentResponse;
  lastNotification: IrNotificationHistoryItem | null;
  latestGeneratedVersion: number | null;
  latestGeneratedAt: string | null;
  updatedAt: string;
  /**
   * 发送与回应摘要（2026-08-20 老板）：列表只显示状态、分类桶、待发送提醒，
   * 发送与发送记录都在详情页；摘要从详情页的沟通事件推导。
   */
  sentSummary: {
    reportSentAt?: string;
    photosSentAt?: string;
    repliedAt?: string;
    replyChannel?: LinkedCommunicationFact["channel"];
    replyResponse?: LinkedCommunicationFact["response"];
  };
}

export interface InspectionReportListResponse {
  items: InspectionReportListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  communicationCounts: Record<IrCommunicationFilter, number>;
  followUpCounts: {
    notNotified: number;
    replyFresh: number;
    replyWarn: number;
    replyOverdue: number;
  };
}

/** Dedicated mechanic contract: intentionally unable to represent customer,
 * price, generated-file or communication facts. Photo facts are restricted to
 * active, integrity-checked Blob metadata owned by the mechanic's own report. */
export interface MechanicInspectionIntakeItem {
  readonly id: string;
  readonly reportNo: string;
  readonly vehicle: {
    readonly id: string;
    readonly plate: string;
    readonly modelZh?: string;
    readonly modelEn?: string;
  };
  readonly status: InspectionReportStatus;
  readonly submittedAt: string;
  readonly rawText: string;
  readonly photos: ReadonlyArray<{
    readonly id: string;
    readonly detectedMediaType: "image/jpeg" | "image/png" | "image/webp";
    readonly widthPx: number;
    readonly heightPx: number;
  }>;
  readonly findings: ReadonlyArray<{
    readonly id: string;
    readonly findingZh: string;
    readonly findingEn?: string;
    readonly recommendationZh: string;
    readonly recommendationEn?: string;
  }>;
}

export interface MechanicInspectionIntakeResponse {
  readonly items: ReadonlyArray<MechanicInspectionIntakeItem>;
}

export interface QuotationItemDto {
  id: string;
  sourceInspectionItemId: string;
  descZh: string;
  descEn: string;
  remarkZh?: string;
  remarkEn?: string;
  unit: string;
  unitEn?: string;
  quantity: number;
  unitPriceJmd: number;
  pendingQuote: boolean;
  /** 与业务单收费项严格一致：只有工时/配件两类（8/20 老板纠正）。 */
  category: "labor" | "parts";
}

export interface InspectionReportDetailResponse {
  id: string;
  reportNo: string;
  revision: number;
  sourceVersion: number;
  customer: { id: string; nameZh: string; nameEn: string | null; phone: string; email: string | null };
  vehicle: { id: string; plate: string; modelZh?: string; modelEn?: string };
  inspector: { id: string; name: string; teamId: OrderTeamId };
  status: InspectionReportStatus;
  submission: { id: string; submittedAt: string; rawText: string };
  aiDraft: string;
  photos: InspectionReportPhotoDto[];
  items: Array<{
    id: string;
    findingZh: string;
    findingEn?: string;
    recommendationZh: string;
    recommendationEn?: string;
    /** 情况描述备注 + 下一步待定说明。 */
    remarkZh?: string;
    remarkEn?: string;
    nextStepZh?: string;
    nextStepEn?: string;
  }>;
  quotation: {
    id: string;
    quotationNo: string;
    inspectionReportId: string;
    noteZh: string;
    noteEn: string;
    lines: Array<UnitPricedChargeLine | FixedTotalChargeLine>;
    generationCounter: number;
    contentRevision: number;
    lastGeneratedAt: string | null;
    generatedFromRevision: number | null;
    activeGeneratedBundle: GeneratedCustomerFileBundleMetadata | null;
    generatedFileStale: boolean;
    /** @deprecated Read-only compatibility projection for inherited PDF code. */
    versions: Array<{ id: string; version: number; createdAt: string; items: QuotationItemDto[] }>;
  };
  communications: LinkedCommunicationFact[];
  communicationStatus: IrCommunicationStatus;
  currentResponse: IrCurrentResponse;
  lastNotification: IrNotificationHistoryItem | null;
  notificationHistory: IrNotificationHistoryItem[];
  responseHistory: IrResponseHistoryItem[];
  parkingNotice: ParkingNoticeFacts | null;
  /** Retired canonical facts remain readable, but no current writer appends here. */
  legacyCommunications: LinkedCommunicationFact[];
}


export type IrCommunicationStatus = "not_notified" | "awaiting_reply" | "closed";
export type IrCurrentResponse = "interested" | "not_interested" | null;

export interface IrNotificationHistoryItem {
  id: string;
  channel: string;
  target: string | null;
  language: "zh" | "en" | "bilingual" | null;
  recordedAt: string;
  source: "current" | "legacy_followup" | "legacy_communication";
  message: string | null;
  subject: string | null;
  providerMode: string | null;
  providerResult: string | null;
  providerReference: string | null;
  actorId: string | null;
  actorName: string | null;
  fileName: string | null;
  demoReportUrl: string | null;
}

export interface IrResponseHistoryItem {
  id: string;
  result: "interested" | "not_interested" | "legacy_unclassified";
  recordedAt: string;
  source: "current" | "legacy_followup" | "legacy_communication";
  note: string;
  actorId: string | null;
  actorName: string | null;
  supersedesEventId: string | null;
}

export interface IrCommunicationSummary {
  communicationStatus: IrCommunicationStatus;
  currentResponse: IrCurrentResponse;
  lastNotification: IrNotificationHistoryItem | null;
  notificationHistory: IrNotificationHistoryItem[];
  responseHistory: IrResponseHistoryItem[];
  legacyCommunications: LinkedCommunicationFact[];
}

export interface InspectionCommunicationStaleDetails {
  readonly code: "INSPECTION_COMMUNICATION_STALE";
  readonly latestRevision: number;
  readonly summary: IrCommunicationSummary;
}

function inspectionCommunicationStaleError(
  state: LinkedOperationsState,
  reportId: string,
): LinkedApiDomainError {
  const details: InspectionCommunicationStaleDetails = {
    code: "INSPECTION_COMMUNICATION_STALE",
    latestRevision: state.revision,
    summary: deriveInspectionCommunicationSummary(state, reportId),
  };
  return new LinkedApiDomainError("Inspection Report 版本已变化，请刷新", 409, details);
}

export type InspectionReportPhotoDto = {
  id: string;
  reportId: string;
  vehicleId: string;
  lifecycle: "active";
  storageKind: "indexeddb_blob";
  originalName: string | null;
  detectedMediaType: "image/jpeg" | "image/png" | "image/webp";
  widthPx: number;
  heightPx: number;
  byteLength: number;
  sha256: `sha256-bytes-v1:${string}`;
  createdAt: string;
  uploaderActorId: string;
  uploaderActorName: string;
  repairNeeded: false;
} | {
  id: string;
  reportId: string;
  vehicleId: string;
  lifecycle: "active";
  storageKind: "legacy_reference";
  originalName: null;
  detectedMediaType: null;
  widthPx: null;
  heightPx: null;
  byteLength: null;
  sha256: null;
  createdAt: null;
  uploaderActorId: null;
  uploaderActorName: null;
  repairNeeded: boolean;
};

export interface RecordCommunicationInput {
  reportId: string;
  expectedRevision: number;
  expectedSourceVersion: number;
  /** 发送内容（2026-08-20 老板）：文字报告与报价 / 现场照片 / 仅记录客户回应。缺省=report。 */
  contentKind?: LinkedCommunicationFact["contentKind"];
  channel: LinkedCommunicationFact["channel"];
  target: string;
  delivery: LinkedCommunicationFact["delivery"];
  response: LinkedCommunicationFact["response"];
  followupDate?: string;
  note: string;
}

const REPORT_STATUSES = new Set<InspectionReportStatus>([
  "mechanic_submitted", "ai_structured", "awaiting_frontdesk",
  "returned_for_revision", "approved", "published",
]);

function photoDtoFromAttachment(
  attachment: LinkedOperationsState["reportAttachments"][number],
): InspectionReportPhotoDto {
  if (attachment.storageKind === "legacy_reference") {
    return {
      id: attachment.id,
      reportId: attachment.reportId,
      vehicleId: attachment.vehicleId,
      lifecycle: "active",
      storageKind: attachment.storageKind,
      originalName: null,
      detectedMediaType: null,
      widthPx: null,
      heightPx: null,
      byteLength: null,
      sha256: null,
      createdAt: null,
      uploaderActorId: null,
      uploaderActorName: null,
      repairNeeded: attachment.repairStatus === "repair_needed",
    };
  }
  return {
    id: attachment.id,
    reportId: attachment.reportId,
    vehicleId: attachment.vehicleId,
    lifecycle: "active",
    storageKind: attachment.storageKind,
    originalName: attachment.originalName,
    detectedMediaType: attachment.detectedMediaType,
    widthPx: attachment.widthPx,
    heightPx: attachment.heightPx,
    byteLength: attachment.byteLength,
    sha256: attachment.sha256,
    createdAt: attachment.createdAt,
    uploaderActorId: attachment.uploaderActorId,
    uploaderActorName: attachment.uploaderActorName,
    repairNeeded: false,
  };
}

function positivePage(value: number | undefined, fallback: number, max?: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || (max !== undefined && result > max)) {
    throw new LinkedApiDomainError("检查报告分页参数无效", 400);
  }
  return result;
}

function legacyResponseResult(response: LinkedCommunicationFact["response"]): IrResponseHistoryItem["result"] | null {
  if (response === "return_planned") return "interested";
  if (response === "declined") return "not_interested";
  if (response === "deferred") return "legacy_unclassified";
  return null;
}

function importedEventPayload(
  event: LinkedCurrentCommunicationEvent | LinkedCustomerResponseEvent,
): Record<string, unknown> | null {
  return isImportedCommunication(event) ? event.payload : null;
}

function isImportedCommunication(
  event: LinkedCurrentCommunicationEvent | LinkedCustomerResponseEvent,
): event is LinkedImportedCommunicationEvent | LinkedImportedCustomerResponseEvent {
  return event.sourceKey === "wh_ir_followup_v1";
}

function latestByTime<T extends { recordedAt: string }>(values: T[]): T | null {
  return values.reduce<T | null>((latest, value) => (
    latest === null || Date.parse(value.recordedAt) >= Date.parse(latest.recordedAt) ? value : latest
  ), null);
}

function communicationHistoryOrder(
  left: { recordedAt: string; source: IrNotificationHistoryItem["source"] | IrResponseHistoryItem["source"] },
  right: { recordedAt: string; source: IrNotificationHistoryItem["source"] | IrResponseHistoryItem["source"] },
): number {
  const byTime = Date.parse(left.recordedAt) - Date.parse(right.recordedAt);
  if (byTime !== 0) return byTime;
  const priority = { legacy_communication: 0, legacy_followup: 1, current: 2 } as const;
  return priority[left.source] - priority[right.source];
}

export function deriveInspectionCommunicationSummary(
  state: Pick<LinkedOperationsState, "communicationEvents" | "responseEvents" | "communications">,
  reportId: string,
): IrCommunicationSummary {
  const currentNotifications = state.communicationEvents.flatMap((event): IrNotificationHistoryItem[] => {
    if (event.reportId !== reportId) return [];
    if (isImportedCommunication(event)) {
      const payload = event.payload;
      if (payload.eventKind !== "formal_report_notification" || payload.outcome !== "success") return [];
      return [{
        id: event.id,
        channel: String(payload.originalChannel ?? "legacy"),
        target: typeof payload.originalTarget === "string" ? payload.originalTarget : null,
        language: null,
        recordedAt: event.recordedAt,
        source: "legacy_followup",
        message: typeof payload.originalNote === "string" ? payload.originalNote : null,
        subject: null,
        providerMode: null,
        providerResult: String(payload.outcome),
        providerReference: null,
        actorId: null,
        actorName: typeof payload.originalActorName === "string" ? payload.originalActorName : null,
        fileName: null,
        demoReportUrl: null,
      }];
    }
    if (event.eventKind !== "formal_report_notification") return [];
    return [{
      id: event.id,
      channel: event.channel,
      target: event.target,
      language: event.language,
      recordedAt: event.recordedAt,
      source: "current",
      message: event.message,
      subject: event.subject ?? null,
      providerMode: event.providerMode,
      providerResult: event.providerResult,
      providerReference: event.providerReference,
      actorId: event.actorId,
      actorName: event.actorName,
      fileName: event.fileName ?? null,
      demoReportUrl: event.demoReportUrl ?? null,
    }];
  });
  const legacyCommunications = state.communications.filter((event) => event.reportId === reportId);
  const legacyNotifications = legacyCommunications.flatMap((event): IrNotificationHistoryItem[] => (
    event.contentKind === "report" && event.delivery !== "failed"
      ? [{
        id: event.id,
        channel: event.channel,
        target: event.target,
        language: null,
        recordedAt: event.recordedAt,
        source: "legacy_communication",
        message: event.note,
        subject: null,
        providerMode: null,
        providerResult: event.delivery,
        providerReference: null,
        actorId: event.actorId,
        actorName: null,
        fileName: null,
        demoReportUrl: null,
      }]
      : []
  ));
  const notificationHistory = [
    ...[...legacyNotifications, ...currentNotifications.filter((event) => event.source !== "current")]
      .sort(communicationHistoryOrder),
    ...currentNotifications.filter((event) => event.source === "current"),
  ];

  const canonicalResponses = state.responseEvents.flatMap((event): IrResponseHistoryItem[] => {
    if (event.reportId !== reportId) return [];
    const payload = importedEventPayload(event);
    return [{
      id: event.id,
      result: event.result,
      recordedAt: event.recordedAt,
      source: payload ? "legacy_followup" : "current",
      note: typeof payload?.originalNote === "string" ? payload.originalNote : "note" in event ? event.note : "",
      actorId: "actorId" in event && typeof event.actorId === "string" ? event.actorId : null,
      actorName: "actorName" in event && typeof event.actorName === "string"
        ? event.actorName
        : typeof payload?.originalActorName === "string"
          ? payload.originalActorName
          : null,
      supersedesEventId: "supersedesEventId" in event && typeof event.supersedesEventId === "string" ? event.supersedesEventId : null,
    }];
  });
  const legacyResponses = legacyCommunications.flatMap((event): IrResponseHistoryItem[] => {
    const result = legacyResponseResult(event.response);
    return result === null ? [] : [{
      id: event.id,
      result,
      recordedAt: event.recordedAt,
      source: "legacy_communication",
      note: event.note,
      actorId: event.actorId,
      actorName: null,
      supersedesEventId: null,
    }];
  });
  const responseHistory = [
    ...[...legacyResponses, ...canonicalResponses.filter((event) => event.source !== "current")]
      .sort(communicationHistoryOrder),
    ...canonicalResponses.filter((event) => event.source === "current"),
  ];
  const latestCurrentResponse = canonicalResponses
    .filter((event) => event.source === "current" && event.result !== "legacy_unclassified")
    .at(-1) ?? null;
  const latestClassified = latestCurrentResponse
    ?? latestByTime(responseHistory.filter((event) => event.source !== "current" && event.result !== "legacy_unclassified"));
  const lastNotification = currentNotifications.filter((event) => event.source === "current").at(-1)
    ?? latestByTime(notificationHistory.filter((event) => event.source !== "current"));
  const currentResponse = latestClassified?.result === "interested" || latestClassified?.result === "not_interested"
    ? latestClassified.result
    : null;
  return {
    communicationStatus: currentResponse !== null
      ? "closed"
      : notificationHistory.length > 0
        ? "awaiting_reply"
        : "not_notified",
    currentResponse,
    lastNotification,
    notificationHistory,
    responseHistory,
    legacyCommunications: structuredClone(legacyCommunications),
  };
}

function detailFromState(state: LinkedOperationsState, reportId: string): InspectionReportDetailResponse {
  const report = state.inspectionReports.find((item) => item.id === reportId);
  if (!report) throw new LinkedApiDomainError("Inspection Report 不存在", 404);
  const customer = state.customers.find((item) => item.id === report.customerId);
  const vehicle = state.vehicles.find((item) => item.id === report.vehicleId);
  const quotation = state.currentQuotations.find((item) => item.id === report.quotationId);
  if (!customer || !vehicle || !quotation) throw new Error("Inspection Report 来源引用不完整");
  const legacyQuotation = state.quotations.find((item) => item.id === quotation.id);
  const legacyLatestVersion = legacyQuotation?.versions.at(-1);
  const currentLines = quotation.lineIds.map((lineId) => {
    const line = state.quotedChargeLines.find((candidate) => candidate.id === lineId);
    if (!line) throw new Error("Quotation 当前收费项目引用不完整");
    if (line.pricingMode === "parking_projection") throw new Error("IR Quotation 不允许停车投影收费行");
    return line;
  });
  const currentItems = currentLines.flatMap((line) => {
    if (line.pricingMode !== "unit") return [];
    return [{
      id: line.id,
      sourceInspectionItemId: line.sourceId ?? report.itemIds[0] ?? "",
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      unit: line.unit,
      unitEn: line.unitEn,
      quantity: line.quantity,
      unitPriceJmd: line.unitPriceJmd,
      pendingQuote: line.pendingQuote,
      category: line.category,
    } satisfies QuotationItemDto];
  });
  const communicationSummary = deriveInspectionCommunicationSummary(state, report.id);
  const activeParking = state.parkingCases
    .filter((candidate) => candidate.vehicleId === report.vehicleId && !candidate.pickupDate)
    .sort((left, right) => left.notificationDate.localeCompare(right.notificationDate))
    .at(-1) ?? null;
  return {
    id: report.id,
    reportNo: report.inspectionReportNo,
    revision: state.revision,
    sourceVersion: report.submissionSourceVersion,
    customer: { id: customer.id, nameZh: customer.nameZh, nameEn: customer.nameEn ?? null, phone: customer.phone, email: customer.email },
    vehicle: { id: vehicle.id, plate: vehicle.plate, modelZh: vehicle.modelZh, modelEn: vehicle.modelEn },
    inspector: { id: report.inspectorId, name: report.inspectorName, teamId: report.inspectorTeamId },
    status: report.status,
    submission: { id: report.submissionId, submittedAt: report.submittedAt, rawText: report.rawText },
    aiDraft: report.aiDraft,
    photos: report.photoIds.map((photoId) => {
      const attachment = state.reportAttachments.find((candidate) => candidate.id === photoId);
      if (!attachment || attachment.lifecycle !== "active") throw new Error("Inspection Report 照片引用不完整");
      return photoDtoFromAttachment(attachment);
    }),
    items: report.itemIds.map((id) => {
      const item = state.inspectionItems.find((candidate) => candidate.id === id);
      if (!item) throw new Error("Inspection Report 项目引用不完整");
      return {
        id: item.id,
        findingZh: item.findingZh,
        findingEn: item.findingEn ?? "",
        recommendationZh: item.recommendationZh,
        recommendationEn: item.recommendationEn ?? "",
        remarkZh: item.remarkZh ?? "",
        remarkEn: item.remarkEn ?? "",
        nextStepZh: item.nextStepZh ?? "",
        nextStepEn: item.nextStepEn ?? "",
      };
    }),
    quotation: {
      id: quotation.id,
      quotationNo: quotation.quotationNo,
      inspectionReportId: quotation.inspectionReportId,
      noteZh: quotation.noteZh,
      noteEn: quotation.noteEn,
      lines: structuredClone(currentLines),
      generationCounter: quotation.generationCounter,
      contentRevision: quotation.contentRevision,
      lastGeneratedAt: quotation.lastGeneratedAt,
      generatedFromRevision: quotation.generatedFromRevision,
      activeGeneratedBundle: quotation.activeGeneratedBundle,
      generatedFileStale: quotation.activeGeneratedBundle !== null
        && quotation.activeGeneratedBundle.contentRevision !== quotation.contentRevision,
      versions: [{
        id: legacyLatestVersion?.id ?? `${quotation.id}-current`,
        version: Math.max(1, quotation.generationCounter),
        createdAt: quotation.lastGeneratedAt ?? legacyLatestVersion?.createdAt ?? report.submittedAt,
        items: currentItems,
      }],
    },
    communications: state.communications.filter((event) => event.reportId === report.id),
    parkingNotice: canonicalParkingNoticeFacts(activeParking),
    ...communicationSummary,
  };
}

export function getMockInspectionReports(
  query: InspectionReportListQuery = {},
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): InspectionReportListResponse {
  const page = positivePage(query.page, 1);
  const pageSize = positivePage(query.pageSize, 50, 200);
  if (query.status !== undefined && !REPORT_STATUSES.has(query.status)) {
    throw new LinkedApiDomainError("检查报告状态无效", 400);
  }
  if (query.teamId !== undefined && !["t1", "t2", "t3", "t4"].includes(query.teamId)) {
    throw new LinkedApiDomainError("检查班组无效", 400);
  }
  if (query.communication !== undefined && !["not_notified", "awaiting_reply", "closed", "interested", "not_interested"].includes(query.communication)) {
    throw new LinkedApiDomainError("客户沟通筛选无效", 400);
  }
  return store.read((state) => {
    const search = query.search?.trim().toLocaleLowerCase();
    const baseItems = state.inspectionReports.map((report) => {
      const customer = state.customers.find((item) => item.id === report.customerId);
      const vehicle = state.vehicles.find((item) => item.id === report.vehicleId);
      if (!customer || !vehicle) throw new Error("Inspection Report 客户车辆引用不完整");
      const facts = state.communications.filter((event) => event.reportId === report.id);
      const reportSend = facts.find((event) => event.contentKind === "report" && event.delivery !== "failed");
      const photosSend = facts.find((event) => event.contentKind === "photos" && event.delivery !== "failed");
      const reply = facts.find((event) => event.response !== "no_response");
      const quotation = state.currentQuotations.find((candidate) => candidate.id === report.quotationId);
      if (!quotation) throw new Error("Inspection Report Quotation 引用不完整");
      const communication = deriveInspectionCommunicationSummary(state, report.id);
      const reportMutations = state.mutationReceipts.flatMap((receipt) => {
        if (!receipt.payloadCanonical) return [];
        try {
          const payload = JSON.parse(receipt.payloadCanonical) as unknown;
          return payload !== null
            && typeof payload === "object"
            && !Array.isArray(payload)
            && (payload as { reportId?: unknown }).reportId === report.id
            ? [{ committedAt: receipt.committedAt, committedRevision: receipt.committedRevision }]
            : [];
        } catch {
          return [];
        }
      });
      const latestMutation = reportMutations
        .sort((left, right) => left.committedRevision - right.committedRevision)
        .at(-1);
      const updatedAt = latestMutation?.committedAt
        ?? quotation.lastGeneratedAt
        ?? communication.responseHistory.at(-1)?.recordedAt
        ?? communication.lastNotification?.recordedAt
        ?? report.submittedAt;
      return {
        id: report.id,
        ...(report.sourceBusinessOrderId ? { sourceBusinessOrderId: report.sourceBusinessOrderId } : {}),
        reportNo: report.inspectionReportNo,
        customer: { id: customer.id, nameZh: customer.nameZh, phone: customer.phone },
        vehicle: { id: vehicle.id, plate: vehicle.plate, modelZh: vehicle.modelZh, modelEn: vehicle.modelEn },
        inspector: { id: report.inspectorId, name: report.inspectorName, teamId: report.inspectorTeamId },
        status: report.status,
        sourceVersion: report.submissionSourceVersion,
        submittedAt: report.submittedAt,
        communicationStatus: communication.communicationStatus,
        currentResponse: communication.currentResponse,
        lastNotification: communication.lastNotification,
        latestGeneratedVersion: quotation.activeGeneratedBundle?.generation ?? null,
        latestGeneratedAt: quotation.activeGeneratedBundle?.generatedAt ?? null,
        updatedAt,
        sentSummary: {
          ...(reportSend ? { reportSentAt: reportSend.recordedAt } : {}),
          ...(photosSend ? { photosSentAt: photosSend.recordedAt } : {}),
          ...(reply ? { repliedAt: reply.recordedAt, replyChannel: reply.channel, replyResponse: reply.response } : {}),
        },
      };
    }).filter((item) => (!query.status || item.status === query.status)
      && (!query.teamId || item.inspector.teamId === query.teamId)
      && (!query.sourceBusinessOrderId || item.sourceBusinessOrderId === query.sourceBusinessOrderId)
      && (!search || [item.reportNo, item.customer.nameZh, item.customer.phone, item.vehicle.plate]
        .some((value) => value.toLocaleLowerCase().includes(search))));
    const communicationCounts: Record<IrCommunicationFilter, number> = {
      not_notified: 0,
      awaiting_reply: 0,
      closed: 0,
      interested: 0,
      not_interested: 0,
    };
    for (const item of baseItems) {
      communicationCounts[item.communicationStatus] += 1;
      if (item.currentResponse) communicationCounts[item.currentResponse] += 1;
    }
    const followUpCounts = {
      notNotified: communicationCounts.not_notified,
      replyFresh: 0,
      replyWarn: 0,
      replyOverdue: 0,
    };
    const nowMs = Date.now();
    for (const item of baseItems) {
      if (item.communicationStatus !== "awaiting_reply" || !item.lastNotification) continue;
      const level = agingLevel(replyAgingDays(item.lastNotification.recordedAt, nowMs));
      if (level === "overdue") followUpCounts.replyOverdue += 1;
      else if (level === "warn") followUpCounts.replyWarn += 1;
      else followUpCounts.replyFresh += 1;
    }
    const items = baseItems.filter((item) => !query.communication
      || (query.communication === "interested" || query.communication === "not_interested"
        ? item.currentResponse === query.communication
        : item.communicationStatus === query.communication));
    const total = items.length;
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      communicationCounts,
      followUpCounts,
    };
  }, "inspection.list.read");
}

export function getMockMechanicInspectionIntake(
  mechanicId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): MechanicInspectionIntakeResponse {
  return store.read((state) => ({
    items: state.inspectionReports
      .filter((report) => report.inspectorId === mechanicId)
      .map((report): MechanicInspectionIntakeItem => {
        const vehicle = state.vehicles.find((candidate) => candidate.id === report.vehicleId);
        if (!vehicle) throw new LinkedApiDomainError("维修工检查入口车辆引用不完整", 503);
        return {
          id: report.id,
          reportNo: report.inspectionReportNo,
          vehicle: {
            id: vehicle.id,
            plate: vehicle.plate,
            ...(vehicle.modelZh ? { modelZh: vehicle.modelZh } : {}),
            ...(vehicle.modelEn ? { modelEn: vehicle.modelEn } : {}),
          },
          status: report.status,
          submittedAt: report.submittedAt,
          rawText: report.rawText,
          photos: report.photoIds.flatMap((attachmentId) => {
            const attachment = state.reportAttachments.find((candidate) => candidate.id === attachmentId);
            // Legacy references awaiting repair remain canonical migration
            // facts, but their raw source is never exposed to the mechanic and
            // one unreadable occurrence must not hide the rest of the report.
            if (!attachment || attachment.lifecycle !== "active" || attachment.storageKind !== "indexeddb_blob") return [];
            return [{
              id: attachment.id,
              detectedMediaType: attachment.detectedMediaType,
              widthPx: attachment.widthPx,
              heightPx: attachment.heightPx,
            }];
          }),
          findings: report.itemIds.map((itemId) => {
            const item = state.inspectionItems.find((candidate) => candidate.id === itemId);
            if (!item) throw new LinkedApiDomainError("维修工检查入口项目引用不完整", 503);
            return {
              id: item.id,
              findingZh: item.findingZh,
              ...(item.findingEn ? { findingEn: item.findingEn } : {}),
              recommendationZh: item.recommendationZh,
              ...(item.recommendationEn ? { recommendationEn: item.recommendationEn } : {}),
            };
          }),
        };
      }),
  }), "inspection.mechanicIntake.read");
}

export async function resolveMockMechanicInspectionPhotoBlob(
  mechanicId: string,
  reportId: string,
  attachmentId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  repository: ReportPhotoRepository = getReportPhotoRepository(),
): Promise<Blob> {
  const assertOwned = () => store.read((state) => {
    const report = state.inspectionReports.find((candidate) => (
      candidate.id === reportId && candidate.inspectorId === mechanicId
    ));
    if (!report || !report.photoIds.includes(attachmentId)) {
      throw new LinkedApiDomainError("维修工检查照片不存在", 404);
    }
  }, "inspection.mechanicPhoto.ownership.read");
  assertOwned();
  const blob = await resolveCanonicalReportPhotoBlob(reportId, attachmentId, null, store, repository);
  assertOwned();
  return blob;
}

export function getMockInspectionReportDetail(reportId: string): InspectionReportDetailResponse {
  return getMockLinkedOperationsStore().read(
    (state) => detailFromState(state, reportId),
    "inspection.detail.read",
  );
}

export interface VehicleInspectionReportPhotoGroup {
  readonly reportId: string;
  readonly reportNo: string;
  readonly submittedAt: string;
  readonly photos: InspectionReportPhotoDto[];
}

export interface VehicleInspectionReportArchiveGroup extends VehicleInspectionReportPhotoGroup {
  readonly findings: InspectionReportDetailResponse["items"];
  readonly quotation: {
    readonly id: string;
    readonly quotationNo: string;
    readonly noteZh: string;
    readonly noteEn: string;
    readonly lines: InspectionReportDetailResponse["quotation"]["lines"];
  };
  readonly generation: { readonly version: number; readonly generatedAt: string } | null;
  readonly communicationStatus: IrCommunicationStatus;
  readonly currentResponse: IrCurrentResponse;
  readonly notificationHistory: IrNotificationHistoryItem[];
  readonly responseHistory: IrResponseHistoryItem[];
  readonly legacyHistory: LinkedOperationsState["legacyIrHistory"];
}

export function getMockVehicleInspectionReportArchive(
  vehicleId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): VehicleInspectionReportArchiveGroup[] {
  return store.read((state) => {
    if (!state.vehicles.some((vehicle) => vehicle.id === vehicleId)) throw new LinkedApiDomainError("车辆不存在", 404);
    return state.inspectionReports
      .filter((report) => report.vehicleId === vehicleId)
      .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt))
      .map((report) => {
        const detail = detailFromState(state, report.id);
        const reportRecords = state.legacyIrHistory.inspectionReports.filter((record) => (
          record.id === report.id || record.inspectionReportNo === report.inspectionReportNo
        ));
        const itemRecords = state.legacyIrHistory.inspectionItems.filter((record) => record.inspectionReportId === report.id);
        const quotations = state.legacyIrHistory.quotations.filter((quotation) => quotation.inspectionReportId === report.id);
        const versionIds = new Set(quotations.flatMap((quotation) => quotation.versions.map((version) => version.id)));
        const quotationItems = state.legacyIrHistory.quotationItems.filter((record) => versionIds.has(String(record.quotationVersionId ?? "")));
        return {
          reportId: detail.id,
          reportNo: detail.reportNo,
          submittedAt: detail.submission.submittedAt,
          photos: detail.photos,
          findings: detail.items,
          quotation: {
            id: detail.quotation.id,
            quotationNo: detail.quotation.quotationNo,
            noteZh: detail.quotation.noteZh,
            noteEn: detail.quotation.noteEn,
            lines: detail.quotation.lines,
          },
          generation: detail.quotation.activeGeneratedBundle
            ? { version: detail.quotation.activeGeneratedBundle.generation, generatedAt: detail.quotation.activeGeneratedBundle.generatedAt }
            : null,
          communicationStatus: detail.communicationStatus,
          currentResponse: detail.currentResponse,
          notificationHistory: detail.notificationHistory,
          responseHistory: detail.responseHistory,
          legacyHistory: {
            sourceSchemaVersion: state.legacyIrHistory.sourceSchemaVersion,
            inspectionReports: structuredClone(reportRecords),
            inspectionItems: structuredClone(itemRecords),
            quotations: structuredClone(quotations),
            quotationItems: structuredClone(quotationItems),
          },
        };
      });
  }, "vehicle.inspectionArchive.read");
}

export function getMockVehicleInspectionReportPhotos(
  vehicleId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): VehicleInspectionReportPhotoGroup[] {
  return store.read((state) => {
    if (!state.vehicles.some((vehicle) => vehicle.id === vehicleId)) throw new LinkedApiDomainError("车辆不存在", 404);
    return state.inspectionReports
      .filter((report) => report.vehicleId === vehicleId && report.photoIds.length > 0)
      .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt))
      .map((report) => ({
        reportId: report.id,
        reportNo: report.inspectionReportNo,
        submittedAt: report.submittedAt,
        photos: report.photoIds.map((photoId) => {
        const attachment = state.reportAttachments.find((candidate) => candidate.id === photoId);
        if (!attachment || attachment.lifecycle !== "active") throw new Error("车辆档案照片引用不完整");
        return photoDtoFromAttachment(attachment);
        }),
      }));
  });
}

function indexedAttachmentIntegrityMetadata(
  attachment: Extract<LinkedOperationsState["reportAttachments"][number], { storageKind: "indexeddb_blob" }>,
) {
  return {
    id: attachment.id,
    reportId: attachment.reportId,
    vehicleId: attachment.vehicleId,
    originalName: attachment.originalName,
    detectedMediaType: attachment.detectedMediaType,
    widthPx: attachment.widthPx,
    heightPx: attachment.heightPx,
    byteLength: attachment.byteLength,
    sha256: attachment.sha256,
  };
}

async function resolveCanonicalReportPhotoBlob(
  reportId: string,
  attachmentId: string,
  expectedVehicleId: string | null,
  store: MockLinkedOperationsStore,
  repository: ReportPhotoRepository,
): Promise<Blob> {
  const readCurrentMetadata = () => store.read((state) => {
    const report = state.inspectionReports.find((candidate) => candidate.id === reportId);
    if (!report || (expectedVehicleId !== null && report.vehicleId !== expectedVehicleId)) {
      throw new LinkedApiDomainError("Inspection Report 照片不存在", 404);
    }
    if (!report.photoIds.includes(attachmentId)) throw new LinkedApiDomainError("Inspection Report 照片不存在", 404);
    const attachment = state.reportAttachments.find((candidate) => candidate.id === attachmentId);
    if (
      !attachment
      || attachment.lifecycle !== "active"
      || attachment.reportId !== report.id
      || attachment.vehicleId !== report.vehicleId
      || attachment.storageKind !== "indexeddb_blob"
    ) throw new LinkedApiDomainError("Inspection Report 照片不可读取", 404);
    return indexedAttachmentIntegrityMetadata(attachment);
  });
  const metadata = readCurrentMetadata();
  let record: ReportPhotoBlobRecord;
  try {
    record = await resolveVerifiedReportPhoto(repository, metadata);
  } catch (error) {
    throw new LinkedApiDomainError(error instanceof Error ? error.message : "现场照片完整性校验失败", 503);
  }
  const currentMetadata = readCurrentMetadata();
  if (Object.entries(metadata).some(([key, value]) => (
    currentMetadata[key as keyof typeof currentMetadata] !== value
  ))) {
    throw new LinkedApiDomainError("Inspection Report 照片归属已改变", 404);
  }
  return record.blob;
}

export function resolveMockInspectionReportPhotoBlob(
  reportId: string,
  attachmentId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  repository: ReportPhotoRepository = getReportPhotoRepository(),
): Promise<Blob> {
  return resolveCanonicalReportPhotoBlob(reportId, attachmentId, null, store, repository);
}

export function resolveMockVehicleInspectionReportPhotoBlob(
  vehicleId: string,
  reportId: string,
  attachmentId: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  repository: ReportPhotoRepository = getReportPhotoRepository(),
): Promise<Blob> {
  return resolveCanonicalReportPhotoBlob(reportId, attachmentId, vehicleId, store, repository);
}

function requiredText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new LinkedApiDomainError(`${label}不能为空`, 400);
  return value.trim();
}

export type UpdateQuotationUnitLineInput = Omit<UnitPricedChargeLine, "id" | "sourceId"> & { id?: string };
export type UpdateQuotationFixedLineInput = Omit<FixedTotalChargeLine, "id" | "sourceId"> & { id?: string };
export type UpdateQuotationLineInput = UpdateQuotationUnitLineInput | UpdateQuotationFixedLineInput;

export interface UpdateQuotationInput {
  reportId: string;
  expectedRevision: number;
  mutationId: string;
  lines: ReadonlyArray<UpdateQuotationLineInput>;
  noteZh: string;
  noteEn: string;
  signature?: {
    rawStrokes: DiscountApprovalEvidence["rawStrokes"];
  };
}

export interface UpdateQuotationResult {
  quotationId: string;
  lineIds: string[];
  revision: number;
  contentRevision: number;
  contentChanged: boolean;
  signatureEventId: string | null;
}

export interface GenerateInspectionReportFilesInput {
  readonly reportId: string;
  readonly expectedRevision: number;
  readonly mutationId: string;
}

export interface GenerateInspectionReportFilesResult {
  readonly revision: number;
  readonly bundle: GeneratedCustomerFileBundleMetadata;
  readonly replayed: boolean;
}

export interface GeneratedInspectionReportFileResult {
  readonly metadata: GeneratedCustomerFileBundleMetadata["attachments"][number];
  readonly bytes: Uint8Array;
}

export type SendInspectionReportNotificationInput = {
  readonly reportId: string;
  readonly expectedRevision: number;
  readonly mutationId: string;
  readonly language: IrPdfLanguage;
  readonly message: string;
} & (
  | { readonly channel: "sms" }
  | { readonly channel: "email"; readonly subject: string }
  | { readonly channel: "whatsapp"; readonly confirmedSent: true }
);

export interface RecordInspectionCustomerResponseInput {
  readonly reportId: string;
  readonly expectedRevision: number;
  readonly mutationId: string;
  readonly result: "interested" | "not_interested";
  readonly note: string;
}

export interface InspectionNotificationProvider {
  sendSms(input: {
    readonly idempotencyKey: string;
    readonly target: string;
    readonly message: string;
    readonly demoReportUrl: string;
  }): Promise<{ readonly providerReference: string }>;
  sendEmail(input: {
    readonly idempotencyKey: string;
    readonly target: string;
    readonly subject: string;
    readonly message: string;
    readonly fileName: string;
    readonly bytes: Uint8Array;
  }): Promise<{ readonly providerReference: string }>;
}

export interface SendInspectionReportNotificationResult {
  readonly revision: number;
  readonly event: LinkedFormalReportNotificationEvent;
  readonly replayed: boolean;
}

export interface RecordInspectionCustomerResponseResult {
  readonly revision: number;
  readonly event: LinkedClassifiedCustomerResponseEvent;
  readonly replayed: boolean;
}

export type IrPdfRenderer = (
  source: IrPdfSource,
  language: IrPdfLanguage,
) => Promise<{ readonly bytes: Uint8Array; readonly fileName: string }>;

export interface QuotationMutationActor {
  id: string;
  name: string;
  role: "superadmin" | "frontdesk_admin";
}

export interface CreateQuickOrderFromInspectionQuotationInput {
  readonly reportId: string;
  readonly expectedRevision: number;
  readonly quotationMutationId?: string;
  readonly quickOrderMutationId: string;
  readonly selectedLineIds: ReadonlyArray<string>;
  readonly quickOrderSignature?: {
    readonly rawStrokes: DiscountApprovalEvidence["rawStrokes"];
  };
}

interface LegacyDraftQuotationItemInput {
  id?: string;
  descZh: string;
  descEn?: string;
  remarkZh?: string;
  remarkEn?: string;
  unit?: string;
  unitEn?: string;
  quantity?: number;
  unitPriceJmd: number;
  pendingQuote?: boolean;
  category: "labor" | "parts";
}

const QUOTATION_UNIT_BY_CATEGORY: Record<string, string> = { labor: "工时", parts: "个" };

function legacyQuotationLines(items: ReadonlyArray<LegacyDraftQuotationItemInput>): UpdateQuotationLineInput[] {
  return items.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    category: item.category,
    pricingMode: "unit" as const,
    descZh: item.descZh,
    descEn: item.descEn ?? "",
    remarkZh: item.remarkZh ?? "",
    remarkEn: item.remarkEn ?? "",
    unit: item.unit ?? QUOTATION_UNIT_BY_CATEGORY[item.category],
    unitEn: item.unitEn ?? "",
    quantity: item.quantity ?? 1,
    unitPriceJmd: item.unitPriceJmd,
    unitDiscountJmd: 0,
    pendingQuote: item.pendingQuote === true,
  }));
}

const UPDATE_QUOTATION_FIELDS = new Set(["reportId", "expectedRevision", "mutationId", "lines", "noteZh", "noteEn", "signature"]);
const UPDATE_UNIT_FIELDS = new Set(["id", "category", "pricingMode", "descZh", "descEn", "remarkZh", "remarkEn", "unit", "unitEn", "quantity", "unitPriceJmd", "unitDiscountJmd", "pendingQuote"]);
const UPDATE_FIXED_FIELDS = new Set(["id", "category", "pricingMode", "code", "descZh", "descEn", "remarkZh", "remarkEn", "amountJmd"]);
const UPDATE_SIGNATURE_FIELDS = new Set(["rawStrokes"]);

function assertClosedInput(value: unknown, fields: ReadonlySet<string>, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LinkedApiDomainError(`${label}无效`, 400);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !fields.has(key)) {
      throw new LinkedApiDomainError(`${label}包含不允许的字段：${String(key)}`, 400);
    }
  }
}

function normalizeQuotationLine(line: UpdateQuotationLineInput): UpdateQuotationLineInput {
  assertClosedInput(
    line,
    line.pricingMode === "unit" ? UPDATE_UNIT_FIELDS : UPDATE_FIXED_FIELDS,
    "报价收费行",
  );
  if (Object.prototype.hasOwnProperty.call(line, "id") && (typeof line.id !== "string" || !line.id.trim())) {
    throw new LinkedApiDomainError("报价收费行 ID 无效", 400);
  }
  const requestedId = line.id?.trim();
  if (line.pricingMode === "unit") {
    const candidate: UnitPricedChargeLine = {
      id: requestedId ?? "new-line-validation-placeholder",
      category: line.category,
      pricingMode: "unit",
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      unit: line.unit,
      unitEn: line.unitEn,
      quantity: line.quantity,
      unitPriceJmd: line.unitPriceJmd,
      unitDiscountJmd: line.unitDiscountJmd,
      pendingQuote: line.pendingQuote,
    };
    try {
      validateQuotedChargeLine(candidate);
    } catch (error) {
      throw new LinkedApiDomainError(error instanceof Error ? error.message : "报价收费行无效", 400);
    }
    if (candidate.category === "labor" && candidate.pendingQuote) {
      throw new LinkedApiDomainError("只有配件可以标记待报价", 400);
    }
    if (candidate.pendingQuote && candidate.unitPriceJmd !== 0) {
      throw new LinkedApiDomainError("待报价配件不能携带未确认价格", 400);
    }
    const normalized: Omit<UnitPricedChargeLine, "id" | "sourceId"> = {
      category: candidate.category,
      pricingMode: "unit",
      descZh: candidate.descZh.trim(),
      descEn: candidate.descEn.trim(),
      remarkZh: candidate.remarkZh.trim(),
      remarkEn: candidate.remarkEn.trim(),
      unit: candidate.unit.trim(),
      unitEn: candidate.unitEn.trim(),
      quantity: candidate.quantity,
      unitPriceJmd: candidate.unitPriceJmd,
      unitDiscountJmd: candidate.unitDiscountJmd,
      pendingQuote: candidate.pendingQuote,
    };
    return requestedId ? { ...normalized, id: requestedId } : normalized;
  }
  if (line.pricingMode !== "fixed_total") {
    throw new LinkedApiDomainError("IR Quotation 不允许停车或未知计价模式", 400);
  }
  const candidate: FixedTotalChargeLine = {
    id: requestedId ?? "new-line-validation-placeholder",
    category: line.category,
    pricingMode: "fixed_total",
    code: line.code,
    descZh: line.descZh,
    descEn: line.descEn,
    remarkZh: line.remarkZh,
    remarkEn: line.remarkEn,
    amountJmd: line.amountJmd,
  };
  try {
    validateQuotedChargeLine(candidate);
  } catch (error) {
    throw new LinkedApiDomainError(error instanceof Error ? error.message : "其他费用收费行无效", 400);
  }
  const normalized: Omit<FixedTotalChargeLine, "id" | "sourceId"> = {
    category: "other_service",
    pricingMode: "fixed_total",
    code: candidate.code,
    descZh: candidate.descZh.trim(),
    descEn: candidate.descEn.trim(),
    remarkZh: candidate.remarkZh.trim(),
    remarkEn: candidate.remarkEn.trim(),
    amountJmd: candidate.amountJmd,
  };
  return requestedId ? { ...normalized, id: requestedId } : normalized;
}

function normalizeUpdateQuotationInput(input: UpdateQuotationInput): UpdateQuotationInput {
  assertClosedInput(input, UPDATE_QUOTATION_FIELDS, "报价保存请求");
  if (typeof input.reportId !== "string" || !input.reportId.trim()) throw new LinkedApiDomainError("Inspection Report ID 无效", 400);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new LinkedApiDomainError("Inspection Report revision 无效", 400);
  if (typeof input.mutationId !== "string" || !input.mutationId.trim()) throw new LinkedApiDomainError("mutationId 无效", 400);
  if (!Array.isArray(input.lines)) throw new LinkedApiDomainError("报价收费行无效", 400);
  if (typeof input.noteZh !== "string") throw new LinkedApiDomainError("报价中文总备注无效", 400);
  if (typeof input.noteEn !== "string") throw new LinkedApiDomainError("Quotation overall note is invalid", 400);
  const lines = input.lines.map(normalizeQuotationLine);
  const submittedIds = lines.flatMap((line) => line.id ? [line.id] : []);
  if (new Set(submittedIds).size !== submittedIds.length) throw new LinkedApiDomainError("报价收费行 ID 重复", 400);
  if (input.signature !== undefined) {
    assertClosedInput(input.signature, UPDATE_SIGNATURE_FIELDS, "优惠签字");
    if (!Array.isArray(input.signature.rawStrokes)) throw new LinkedApiDomainError("优惠签字笔迹无效", 400);
  }
  return {
    reportId: input.reportId.trim(),
    expectedRevision: input.expectedRevision,
    mutationId: input.mutationId.trim(),
    lines,
    noteZh: input.noteZh.trim(),
    noteEn: input.noteEn.trim(),
    ...(input.signature ? { signature: { rawStrokes: structuredClone(input.signature.rawStrokes) } } : {}),
  };
}

function jamaicaInstant(nowMs: number): string {
  const localClock = new Date(nowMs - 5 * 60 * 60 * 1_000).toISOString();
  return `${localClock.slice(0, -1)}-05:00`;
}

function thresholdMoneyChanged(previous: ReadonlyArray<QuotedChargeLine>, next: ReadonlyArray<QuotedChargeLine>): boolean {
  const left = calculateQuotedChargeTotals(previous);
  const right = calculateQuotedChargeTotals(next);
  return left.laborGrossJmd !== right.laborGrossJmd
    || left.laborDiscountJmd !== right.laborDiscountJmd
    || left.partsGrossJmd !== right.partsGrossJmd
    || left.partsDiscountJmd !== right.partsDiscountJmd;
}

function newQuotationLineId(quotationId: string, mutationId: string, sequence: number): string {
  return `${quotationId}-line-${encodeURIComponent(mutationId)}-${sequence}`;
}

function normalizeQuotationActor(actor: QuotationMutationActor): QuotationMutationActor {
  if (
    actor === null
    || typeof actor !== "object"
    || typeof actor.id !== "string"
    || !actor.id.trim()
    || typeof actor.name !== "string"
    || !actor.name.trim()
    || (actor.role !== "superadmin" && actor.role !== "frontdesk_admin")
  ) {
    throw new LinkedApiDomainError("报价操作账号无效", 403);
  }
  return { id: actor.id.trim(), name: actor.name.trim(), role: actor.role };
}

function quotationLineValue(
  line: QuotedChargeLine | UpdateQuotationLineInput,
  includeInternalCode: boolean,
): Record<string, unknown> {
  if (line.pricingMode === "unit") {
    return {
      pricingMode: "unit",
      category: line.category,
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      unit: line.unit,
      unitEn: line.unitEn,
      quantity: line.quantity,
      unitPriceJmd: line.unitPriceJmd,
      unitDiscountJmd: line.unitDiscountJmd,
      pendingQuote: line.pendingQuote,
    };
  }
  if (line.pricingMode === "fixed_total") {
    return {
      pricingMode: "fixed_total",
      category: "other_service",
      ...(includeInternalCode ? { code: line.code } : {}),
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      amountJmd: line.amountJmd,
    };
  }
  throw new LinkedApiDomainError("IR Quotation 不允许停车投影收费行", 400);
}

function sameQuotationContent(
  previousLines: ReadonlyArray<QuotedChargeLine>,
  nextLines: ReadonlyArray<QuotedChargeLine>,
  previousNoteZh: string,
  previousNoteEn: string,
  nextNoteZh: string,
  nextNoteEn: string,
  includeInternalCode: boolean,
): boolean {
  return previousNoteZh === nextNoteZh
    && previousNoteEn === nextNoteEn
    && JSON.stringify(previousLines.map((line) => quotationLineValue(line, includeInternalCode)))
      === JSON.stringify(nextLines.map((line) => quotationLineValue(line, includeInternalCode)));
}

function applyQuotationMutationToState(
  state: LinkedOperationsState,
  input: UpdateQuotationInput,
  actor: QuotationMutationActor,
  recordedAt: string,
): Omit<UpdateQuotationResult, "revision"> {
  const report = state.inspectionReports.find((item) => item.id === input.reportId);
  if (!report) throw new LinkedApiDomainError("Inspection Report 不存在", 404);
  if (input.expectedRevision !== state.revision) throw new LinkedApiDomainError("Inspection Report 版本已变化，请刷新", 409);
  const quotation = state.currentQuotations.find((item) => item.id === report.quotationId);
  if (!quotation) throw new LinkedApiDomainError("Inspection Report 当前 Quotation 不存在", 500);
  const previousLines = quotation.lineIds.map((lineId) => {
    const line = state.quotedChargeLines.find((candidate) => candidate.id === lineId);
    if (!line) throw new LinkedApiDomainError("Quotation 当前收费行引用不完整", 500);
    return line;
  });
  const previousById = new Map(previousLines.map((line) => [line.id, line] as const));
  let newSequence = 0;
  const nextLines = input.lines.map((submitted): QuotedChargeLine => {
    const previous = submitted.id ? previousById.get(submitted.id) : undefined;
    if (submitted.id && !previous) throw new LinkedApiDomainError("报价收费行不属于当前 Quotation", 400);
    if (
      previous?.pricingMode === "unit"
      && previous.unitDiscountJmd !== 0
      && submitted.pricingMode === "fixed_total"
    ) {
      throw new LinkedApiDomainError("转为其他费用前必须先清除项目优惠", 400);
    }
    const id = submitted.id ?? newQuotationLineId(quotation.id, input.mutationId, ++newSequence);
    const line = {
      ...submitted,
      id,
      ...(previous?.sourceId ? { sourceId: previous.sourceId } : {}),
    } as QuotedChargeLine;
    try {
      validateQuotedChargeLine(line);
    } catch (error) {
      throw new LinkedApiDomainError(error instanceof Error ? error.message : "报价收费行无效", 400);
    }
    return line;
  });

  const requirement = discountApprovalRequirement(nextLines);
  const canonicalChanged = !sameQuotationContent(
    previousLines,
    nextLines,
    quotation.noteZh,
    quotation.noteEn,
    input.noteZh,
    input.noteEn,
    true,
  );
  const customerFileChanged = !sameQuotationContent(
    previousLines,
    nextLines,
    quotation.noteZh,
    quotation.noteEn,
    input.noteZh,
    input.noteEn,
    false,
  );
  const needsSignature = canonicalChanged && thresholdMoneyChanged(previousLines, nextLines) && requirement.required;
  if (!needsSignature && input.signature) {
    throw new LinkedApiDomainError("当前报价写入不需要优惠签字，不得提交或保留未消费笔迹", 400);
  }
  let signatureEvidence: DiscountApprovalEvidence | null = null;
  if (input.signature) {
    signatureEvidence = {
      document: { kind: "quotation", id: quotation.id },
      operationAccount: { id: actor.id, name: actor.name },
      rawStrokes: input.signature.rawStrokes,
      signedAt: recordedAt,
      mutationId: input.mutationId,
      categoryRatios: { labor: requirement.labor, parts: requirement.parts },
    };
    try {
      validateDiscountApprovalEvidence(signatureEvidence);
    } catch (error) {
      throw new LinkedApiDomainError(error instanceof Error ? error.message : "优惠签字笔迹无效", 400);
    }
  }
  if (needsSignature && !signatureEvidence) {
    throw new LinkedApiDomainError("当前工时或配件优惠超过门槛，需要一份非空原始笔迹签字", 400);
  }
  if (needsSignature && signatureEvidence) {
    const strokeDigest = discountSignatureStrokeDigest(signatureEvidence.rawStrokes);
    if (state.discountSignatureEvents.some((event) => discountSignatureStrokeDigest(event.rawStrokes) === strokeDigest)) {
      throw new LinkedApiDomainError("该原始笔迹已被另一笔收费写入消费，请重新签字", 409);
    }
  }

  const quotationIndex = state.currentQuotations.indexOf(quotation);
  if (canonicalChanged) {
    const previousIds = new Set(previousLines.map((line) => line.id));
    state.quotedChargeLines = state.quotedChargeLines.filter((line) => !previousIds.has(line.id));
    state.quotedChargeLines.push(...nextLines);
    state.currentQuotations[quotationIndex] = {
      ...quotation,
      lineIds: nextLines.map((line) => line.id),
      noteZh: input.noteZh,
      noteEn: input.noteEn,
      contentRevision: quotation.contentRevision + (customerFileChanged ? 1 : 0),
    };
  }
  if (needsSignature && signatureEvidence) state.discountSignatureEvents.push(signatureEvidence);
  return {
    quotationId: quotation.id,
    lineIds: canonicalChanged ? nextLines.map((line) => line.id) : previousLines.map((line) => line.id),
    contentRevision: quotation.contentRevision + (customerFileChanged ? 1 : 0),
    contentChanged: canonicalChanged,
    signatureEventId: needsSignature && signatureEvidence ? signatureEvidence.mutationId : null,
  };
}

/** One locked, idempotent write over the continuously editable current Quotation. */
export async function updateMockQuotation(
  rawInput: UpdateQuotationInput,
  actor: QuotationMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<UpdateQuotationResult> {
  const input = normalizeUpdateQuotationInput(rawInput);
  const normalizedActor = normalizeQuotationActor(actor);
  const recordedAt = jamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<UpdateQuotationResult>({
    mutationId: input.mutationId,
    operation: "inspection.quotation.update",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, (state) => {
    const result = applyQuotationMutationToState(state, input, normalizedActor, recordedAt);
    state.revision += 1;
    return { ...result, revision: state.revision };
  }, { action: "inspection.quotation.update.write" });
  store.read(() => null, "inspection.quotation.update.response");
  return committed.result;
}

const GENERATE_FILE_FIELDS = new Set(["reportId", "expectedRevision", "mutationId"]);
const GENERATED_FILE_LANGUAGES: ReadonlyArray<IrPdfLanguage> = ["zh", "en", "bilingual"];

function normalizeGenerateInspectionReportFilesInput(
  input: GenerateInspectionReportFilesInput,
): GenerateInspectionReportFilesInput {
  assertClosedInput(input, GENERATE_FILE_FIELDS, "客户文件生成请求");
  if (typeof input.reportId !== "string" || !input.reportId.trim()) throw new LinkedApiDomainError("reportId 无效", 400);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new LinkedApiDomainError("expectedRevision 无效", 400);
  if (typeof input.mutationId !== "string" || !input.mutationId.trim()) throw new LinkedApiDomainError("mutationId 无效", 400);
  return {
    reportId: input.reportId.trim(),
    expectedRevision: input.expectedRevision,
    mutationId: input.mutationId.trim(),
  };
}

function narrowPdfSourceFromState(
  state: LinkedOperationsState,
  reportId: string,
  version: number,
  generatedAt: string,
): { source: IrPdfSource; quotationIndex: number } {
  const report = state.inspectionReports.find((item) => item.id === reportId);
  if (!report) throw new LinkedApiDomainError("Inspection Report 不存在", 404);
  const customer = state.customers.find((item) => item.id === report.customerId);
  const vehicle = state.vehicles.find((item) => item.id === report.vehicleId);
  const quotationIndex = state.currentQuotations.findIndex((item) => item.id === report.quotationId);
  const quotation = state.currentQuotations[quotationIndex];
  if (!customer || !vehicle || !quotation) throw new LinkedApiDomainError("Inspection Report 客户文件来源引用不完整", 500);
  const lines = quotation.lineIds.map((lineId): IrPdfSource["quotation"]["lines"][number] => {
    const line = state.quotedChargeLines.find((candidate) => candidate.id === lineId);
    if (!line) throw new LinkedApiDomainError("Quotation 当前收费行引用不完整", 500);
    if (line.pricingMode === "parking_projection") throw new LinkedApiDomainError("IR Quotation 不允许停车投影收费行", 400);
    if (line.pricingMode === "fixed_total") {
      return {
        id: line.id,
        category: "other_service",
        pricingMode: "fixed_total",
        code: line.code,
        descZh: line.descZh,
        descEn: line.descEn,
        remarkZh: line.remarkZh,
        remarkEn: line.remarkEn,
        amountJmd: line.amountJmd,
      };
    }
    return {
      id: line.id,
      category: line.category,
      pricingMode: "unit",
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      unit: line.unit,
      unitEn: line.unitEn,
      quantity: line.quantity,
      unitPriceJmd: line.unitPriceJmd,
      unitDiscountJmd: line.unitDiscountJmd,
      pendingQuote: line.pendingQuote,
    };
  });
  return {
    quotationIndex,
    source: {
      company: WHOLE_HEARTED_COMPANY_IDENTITY,
      reportNo: report.inspectionReportNo,
      quotationNo: quotation.quotationNo,
      generation: { version, generatedAt },
      customer: { nameZh: customer.nameZh, nameEn: customer.nameEn ?? null, phone: customer.phone },
      vehicle: {
        plate: vehicle.plate,
        ...(vehicle.modelZh ? { modelZh: vehicle.modelZh } : {}),
        ...(vehicle.modelEn ? { modelEn: vehicle.modelEn } : {}),
        ...("vin" in vehicle && typeof vehicle.vin === "string" && vehicle.vin.trim() ? { vin: vehicle.vin.trim() } : {}),
      },
      quotation: { noteZh: quotation.noteZh, noteEn: quotation.noteEn, lines },
    },
  };
}

let customerFileLogoBytes: Uint8Array | null = null;
let customerFileLogoRequest: Promise<Uint8Array> | null = null;

async function loadCustomerFileLogo(): Promise<Uint8Array> {
  if (customerFileLogoBytes) return customerFileLogoBytes;
  const request = customerFileLogoRequest ??= (async () => {
    const response = await fetch(WHOLE_HEARTED_COMPANY_IDENTITY.logoUrl);
    if (!response.ok) throw new Error(`Logo resource failed (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  })();
  try {
    const bytes = await request;
    customerFileLogoBytes = bytes;
    return bytes;
  } catch (error) {
    if (customerFileLogoRequest === request) customerFileLogoRequest = null;
    throw error;
  } finally {
    if (customerFileLogoBytes && customerFileLogoRequest === request) customerFileLogoRequest = null;
  }
}

const defaultIrPdfRenderer: IrPdfRenderer = async (source, language) => {
  const [{ buildInspectionReportPdf }, logoBytes] = await Promise.all([
    import("../orders/ir-pdf"),
    loadCustomerFileLogo(),
  ]);
  return buildInspectionReportPdf(source, language, { logoBytes });
};

function generatedBundleId(mutationId: string): string {
  return `ir-generated-bundle-${encodeURIComponent(mutationId)}`;
}

function generatedAttachmentId(mutationId: string, language: IrPdfLanguage): string {
  return `ir-generated-file-${encodeURIComponent(mutationId)}-${language}`;
}

/**
 * One locked generation intent: validate/read one saved source, render all
 * languages, durably write the new bundle, then commit only lightweight
 * canonical metadata and the idempotency receipt.
 */
export async function generateMockInspectionReportFiles(
  rawInput: GenerateInspectionReportFilesInput,
  actor: QuotationMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  repository: IrGeneratedFileRepository = getIrGeneratedFileRepository(),
  renderer: IrPdfRenderer = defaultIrPdfRenderer,
): Promise<GenerateInspectionReportFilesResult> {
  const input = normalizeGenerateInspectionReportFilesInput(rawInput);
  const normalizedActor = normalizeQuotationActor(actor);
  const recordedAt = jamaicaInstant(store.nowMs());
  const cleanup = { supersededBundleId: null as string | null };
  const committed = await store.mutateIdempotently<Omit<GenerateInspectionReportFilesResult, "replayed">>({
    mutationId: input.mutationId,
    operation: "inspection.files.generate",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, async (state) => {
    if (input.expectedRevision !== state.revision) throw new LinkedApiDomainError("Inspection Report 版本已变化，请刷新", 409);
    const report = state.inspectionReports.find((item) => item.id === input.reportId);
    if (!report) throw new LinkedApiDomainError("Inspection Report 不存在", 404);
    const quotation = state.currentQuotations.find((item) => item.id === report.quotationId);
    if (!quotation) throw new LinkedApiDomainError("Inspection Report 当前 Quotation 不存在", 500);
    // Cleanup is safe only while this canonical mutation lock is held and
    // before this intent writes its new bytes. Preserve every report's active
    // bundle, not merely the report currently being generated. Failure is
    // maintenance-only and must never block the customer-file intent.
    try {
      await repository.cleanupExceptBundleIds(state.currentQuotations.flatMap((candidate) => (
        candidate.activeGeneratedBundle ? [candidate.activeGeneratedBundle.id] : []
      )));
    } catch {
      // A later locked generation intent retries unreachable-bundle cleanup.
    }
    const generation = quotation.generationCounter + 1;
    const { source, quotationIndex } = narrowPdfSourceFromState(state, report.id, generation, recordedAt);

    const rendered = await Promise.all(GENERATED_FILE_LANGUAGES.map(async (language) => ({
      language,
      output: await renderer(source, language),
    })));
    const bundleId = generatedBundleId(input.mutationId);
    const records: IrGeneratedFileRecord[] = rendered.map(({ language, output }) => ({
      id: generatedAttachmentId(input.mutationId, language),
      bundleId,
      reportId: report.id,
      quotationId: quotation.id,
      language,
      fileName: output.fileName,
      mediaType: "application/pdf",
      bytes: output.bytes.slice(),
    }));
    // Retains the old active files. A partial bundle is rejected atomically by
    // the repository before canonical metadata can change.
    await repository.writeBundle(records);
    const bundle: GeneratedCustomerFileBundleMetadata = {
      id: bundleId,
      reportId: report.id,
      quotationId: quotation.id,
      generation,
      generatedAt: recordedAt,
      contentRevision: quotation.contentRevision,
      rendererVersion: IR_PDF_RENDERER_VERSION,
      attachments: records.map((record) => ({
        id: record.id,
        language: record.language,
        fileName: record.fileName,
        byteLength: record.bytes.byteLength,
        mediaType: "application/pdf",
      })),
    };
    cleanup.supersededBundleId = quotation.activeGeneratedBundle?.id ?? null;
    state.currentQuotations[quotationIndex] = {
      ...quotation,
      generationCounter: generation,
      lastGeneratedAt: recordedAt,
      generatedFromRevision: quotation.contentRevision,
      activeGeneratedBundle: bundle,
    };
    state.generationEvents.push({
      id: `ir-generation-${encodeURIComponent(input.mutationId)}`,
      reportId: report.id,
      quotationId: quotation.id,
      generation,
      contentRevision: quotation.contentRevision,
      actorId: normalizedActor.id,
      generatedAt: recordedAt,
      rendererVersion: IR_PDF_RENDERER_VERSION,
      attachmentIds: bundle.attachments.map((attachment) => attachment.id),
    });
    state.revision += 1;
    return { revision: state.revision, bundle };
  }, { action: "inspection.files.generate.write" });

  // Canonical is already durable. Cleanup is best effort: an abandoned old or
  // orphan bundle is never active because resolution starts from canonical IDs.
  if (!committed.replayed && cleanup.supersededBundleId && cleanup.supersededBundleId !== committed.result.bundle.id) {
    try {
      await repository.deleteBundle(cleanup.supersededBundleId);
    } catch {
      // A later maintenance pass may remove the unreachable bytes.
    }
  }
  store.read(() => null, "inspection.files.generate.response");
  return { ...committed.result, replayed: committed.replayed };
}

export async function getMockInspectionReportGeneratedFile(
  reportId: string,
  language: IrPdfLanguage,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  repository: IrGeneratedFileRepository = getIrGeneratedFileRepository(),
): Promise<GeneratedInspectionReportFileResult> {
  if (!GENERATED_FILE_LANGUAGES.includes(language)) throw new LinkedApiDomainError("客户文件语言无效", 400);
  const bundle = store.read((state) => {
    const report = state.inspectionReports.find((item) => item.id === reportId);
    if (!report) throw new LinkedApiDomainError("Inspection Report 不存在", 404);
    const quotation = state.currentQuotations.find((item) => item.id === report.quotationId);
    if (!quotation?.activeGeneratedBundle) throw new LinkedApiDomainError("尚未生成客户文件", 409);
    return quotation.activeGeneratedBundle;
  }, "inspection.files.read");
  const records = await repository.readBundle(bundle.attachments.map((attachment) => attachment.id));
  if (!records) throw new LinkedApiDomainError("客户文件缓存缺失或损坏，请重新生成", 409);
  const recordsMatchCanonicalBundle = bundle.reportId === reportId
    && records.length === bundle.attachments.length
    && bundle.attachments.every((attachment) => {
      const record = records.find((candidate) => candidate.id === attachment.id);
      return record?.bundleId === bundle.id
        && record.reportId === bundle.reportId
        && record.quotationId === bundle.quotationId
        && record.id === attachment.id
        && record.language === attachment.language
        && record.fileName === attachment.fileName
        && record.mediaType === attachment.mediaType
        && record.bytes.byteLength === attachment.byteLength;
    });
  if (!recordsMatchCanonicalBundle) {
    throw new LinkedApiDomainError("客户文件缓存缺失或损坏，请重新生成", 409);
  }
  const metadata = bundle.attachments.find((attachment) => attachment.language === language);
  const record = metadata ? records.find((candidate) => candidate.id === metadata.id) : undefined;
  if (!metadata || !record || record.bytes.byteLength !== metadata.byteLength || record.language !== language) {
    throw new LinkedApiDomainError("客户文件缓存缺失或损坏，请重新生成", 409);
  }
  return { metadata, bytes: record.bytes.slice() };
}

const NOTIFICATION_COMMON_FIELDS = new Set([
  "reportId", "expectedRevision", "mutationId", "channel", "language", "message",
]);
const NOTIFICATION_EMAIL_FIELDS = new Set([...NOTIFICATION_COMMON_FIELDS, "subject"]);
const NOTIFICATION_WHATSAPP_FIELDS = new Set([...NOTIFICATION_COMMON_FIELDS, "confirmedSent"]);
const RESPONSE_FIELDS = new Set([
  "reportId", "expectedRevision", "mutationId", "result", "note",
]);

function normalizeNotificationInput(rawInput: SendInspectionReportNotificationInput): SendInspectionReportNotificationInput {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw new LinkedApiDomainError("客户通知请求无效", 400);
  }
  const fields = rawInput.channel === "email"
    ? NOTIFICATION_EMAIL_FIELDS
    : rawInput.channel === "whatsapp"
      ? NOTIFICATION_WHATSAPP_FIELDS
      : NOTIFICATION_COMMON_FIELDS;
  assertClosedInput(rawInput, fields, "客户通知请求");
  if (typeof rawInput.reportId !== "string" || !rawInput.reportId.trim()) throw new LinkedApiDomainError("reportId 无效", 400);
  if (!Number.isSafeInteger(rawInput.expectedRevision) || rawInput.expectedRevision < 1) throw new LinkedApiDomainError("expectedRevision 无效", 400);
  if (typeof rawInput.mutationId !== "string" || !rawInput.mutationId.trim()) throw new LinkedApiDomainError("mutationId 无效", 400);
  if (!GENERATED_FILE_LANGUAGES.includes(rawInput.language)) throw new LinkedApiDomainError("客户文件语言无效", 400);
  if (!(["sms", "email", "whatsapp"] as string[]).includes(rawInput.channel)) throw new LinkedApiDomainError("客户通知渠道无效", 400);
  const message = requiredText(rawInput.message, "通知内容");
  const common = {
    reportId: rawInput.reportId.trim(),
    expectedRevision: rawInput.expectedRevision,
    mutationId: rawInput.mutationId.trim(),
    language: rawInput.language,
    message,
  };
  if (rawInput.channel === "email") {
    return { ...common, channel: "email", subject: requiredText(rawInput.subject, "Email 主题") };
  }
  if (rawInput.channel === "whatsapp") {
    if (rawInput.confirmedSent !== true) throw new LinkedApiDomainError("打开 WhatsApp 不会记录发送，必须由前台明确确认", 400);
    return { ...common, channel: "whatsapp", confirmedSent: true };
  }
  return { ...common, channel: "sms" };
}

function normalizeResponseInput(rawInput: RecordInspectionCustomerResponseInput): RecordInspectionCustomerResponseInput {
  assertClosedInput(rawInput, RESPONSE_FIELDS, "客户回应请求");
  if (typeof rawInput.reportId !== "string" || !rawInput.reportId.trim()) throw new LinkedApiDomainError("reportId 无效", 400);
  if (!Number.isSafeInteger(rawInput.expectedRevision) || rawInput.expectedRevision < 1) throw new LinkedApiDomainError("expectedRevision 无效", 400);
  if (typeof rawInput.mutationId !== "string" || !rawInput.mutationId.trim()) throw new LinkedApiDomainError("mutationId 无效", 400);
  if (rawInput.result !== "interested" && rawInput.result !== "not_interested") throw new LinkedApiDomainError("客户回应分类无效", 400);
  if (typeof rawInput.note !== "string") throw new LinkedApiDomainError("客户回应备注无效", 400);
  return {
    reportId: rawInput.reportId.trim(),
    expectedRevision: rawInput.expectedRevision,
    mutationId: rawInput.mutationId.trim(),
    result: rawInput.result,
    note: rawInput.note.trim(),
  };
}

const acceptedNotificationProviderReferences = new Map<string, string>();
const defaultInspectionNotificationProvider: InspectionNotificationProvider = {
  sendSms: async ({ idempotencyKey }) => {
    const providerReference = acceptedNotificationProviderReferences.get(idempotencyKey)
      ?? `mock-sms-accepted-${encodeURIComponent(idempotencyKey)}`;
    acceptedNotificationProviderReferences.set(idempotencyKey, providerReference);
    return { providerReference };
  },
  sendEmail: async ({ idempotencyKey }) => {
    const providerReference = acceptedNotificationProviderReferences.get(idempotencyKey)
      ?? `mock-email-accepted-${encodeURIComponent(idempotencyKey)}`;
    acceptedNotificationProviderReferences.set(idempotencyKey, providerReference);
    return { providerReference };
  },
};

function demoInspectionReportUrl(reportId: string, language: IrPdfLanguage): string {
  return `https://demo.wholehearted.example/inspection-reports/${encodeURIComponent(reportId)}/${language}`;
}

async function resolveCurrentGeneratedFileInsideMutation(
  state: LinkedOperationsState,
  reportId: string,
  language: IrPdfLanguage,
  repository: IrGeneratedFileRepository,
): Promise<GeneratedInspectionReportFileResult> {
  const report = state.inspectionReports.find((candidate) => candidate.id === reportId);
  if (!report) throw new LinkedApiDomainError("Inspection Report 不存在", 404);
  const quotation = state.currentQuotations.find((candidate) => candidate.id === report.quotationId);
  const bundle = quotation?.activeGeneratedBundle;
  if (!quotation || !bundle || bundle.contentRevision !== quotation.contentRevision) {
    throw new LinkedApiDomainError("当前客户文件缺失或已过期，请重新生成", 409);
  }
  const records = await repository.readBundle(bundle.attachments.map((attachment) => attachment.id));
  if (!records || records.length !== bundle.attachments.length) {
    throw new LinkedApiDomainError("客户文件缓存缺失或损坏，请重新生成", 409);
  }
  const coherent = bundle.attachments.every((attachment) => {
    const record = records.find((candidate) => candidate.id === attachment.id);
    return record?.bundleId === bundle.id
      && record.reportId === report.id
      && record.quotationId === quotation.id
      && record.language === attachment.language
      && record.fileName === attachment.fileName
      && record.mediaType === "application/pdf"
      && record.bytes.byteLength === attachment.byteLength;
  });
  const metadata = bundle.attachments.find((attachment) => attachment.language === language);
  const record = metadata ? records.find((candidate) => candidate.id === metadata.id) : undefined;
  if (!coherent || !metadata || !record) throw new LinkedApiDomainError("客户文件缓存缺失或损坏，请重新生成", 409);
  return { metadata, bytes: record.bytes.slice() };
}

export async function sendMockInspectionReportNotification(
  rawInput: SendInspectionReportNotificationInput,
  actor: QuotationMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  repository: IrGeneratedFileRepository = getIrGeneratedFileRepository(),
  provider: InspectionNotificationProvider = defaultInspectionNotificationProvider,
  assertRequestIdentity: () => void = () => {},
): Promise<SendInspectionReportNotificationResult> {
  const input = normalizeNotificationInput(rawInput);
  const normalizedActor = normalizeQuotationActor(actor);
  const recordedAt = jamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<Omit<SendInspectionReportNotificationResult, "replayed">>({
    mutationId: input.mutationId,
    operation: "inspection.notification.send",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, async (state) => {
    if (input.expectedRevision !== state.revision) throw inspectionCommunicationStaleError(state, input.reportId);
    const report = state.inspectionReports.find((candidate) => candidate.id === input.reportId);
    if (!report) throw new LinkedApiDomainError("Inspection Report 不存在", 404);
    const customer = state.customers.find((candidate) => candidate.id === report.customerId);
    if (!customer) throw new LinkedApiDomainError("Inspection Report 客户引用不完整", 500);
    const generated = await resolveCurrentGeneratedFileInsideMutation(state, report.id, input.language, repository);
    assertRequestIdentity();
    const target = input.channel === "email" ? customer.email : customer.phone;
    if (!target || !target.trim()) throw new LinkedApiDomainError(input.channel === "email" ? "客户 Email 待补，无法发送" : "客户电话待补，无法发送", 409);
    // Task 7 mock-only provider fault boundary. It runs after all current-file
    // validation and before any provider acceptance or canonical append.
    store.read(() => null, "inspection.notification.provider");
    const providerFact = input.channel === "email"
      ? await provider.sendEmail({
        idempotencyKey: input.mutationId,
        target,
        subject: input.subject,
        message: input.message,
        fileName: generated.metadata.fileName,
        bytes: generated.bytes.slice(),
      })
      : input.channel === "sms"
        ? await provider.sendSms({
          idempotencyKey: input.mutationId,
          target,
          message: input.message,
          demoReportUrl: demoInspectionReportUrl(report.id, input.language),
        })
        : { providerReference: `manual-whatsapp-${encodeURIComponent(input.mutationId)}` };
    assertRequestIdentity();
    if (!providerFact || typeof providerFact.providerReference !== "string" || !providerFact.providerReference.trim()) {
      throw new LinkedApiDomainError("Mock provider 未接受通知", 503);
    }
    const event: LinkedFormalReportNotificationEvent = {
      id: `ir-notification-${encodeURIComponent(input.mutationId)}`,
      reportId: report.id,
      eventKind: "formal_report_notification",
      channel: input.channel,
      language: input.language,
      target,
      message: input.message,
      ...(input.channel === "email" ? { subject: input.subject } : {}),
      providerMode: input.channel === "email" ? "mock_email" : input.channel === "sms" ? "mock_sms" : "manual_whatsapp",
      providerResult: input.channel === "whatsapp" ? "confirmed_sent" : "accepted",
      providerReference: providerFact.providerReference.trim(),
      actorId: normalizedActor.id,
      actorName: normalizedActor.name,
      recordedAt,
      mutationId: input.mutationId,
      ...(input.channel === "email"
        ? { fileName: generated.metadata.fileName }
        : { demoReportUrl: demoInspectionReportUrl(report.id, input.language) }),
    };
    state.communicationEvents.push(event);
    state.revision += 1;
    return { revision: state.revision, event };
  }, { action: "inspection.notification.send.write" });
  store.read(() => null, "inspection.notification.send.response");
  return { ...committed.result, replayed: committed.replayed };
}

export async function recordMockInspectionCustomerResponse(
  rawInput: RecordInspectionCustomerResponseInput,
  actor: QuotationMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  assertRequestIdentity: () => void = () => {},
): Promise<RecordInspectionCustomerResponseResult> {
  const input = normalizeResponseInput(rawInput);
  const normalizedActor = normalizeQuotationActor(actor);
  const recordedAt = jamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<Omit<RecordInspectionCustomerResponseResult, "replayed">>({
    mutationId: input.mutationId,
    operation: "inspection.response.record",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, (state) => {
    if (input.expectedRevision !== state.revision) throw inspectionCommunicationStaleError(state, input.reportId);
    if (!state.inspectionReports.some((candidate) => candidate.id === input.reportId)) {
      throw new LinkedApiDomainError("Inspection Report 不存在", 404);
    }
    assertRequestIdentity();
    const summary = deriveInspectionCommunicationSummary(state, input.reportId);
    const previousCurrentId = [...state.responseEvents].reverse().find((event) => (
      event.reportId === input.reportId
      && !isImportedCommunication(event)
    ))?.id;
    const previous = (previousCurrentId
      ? summary.responseHistory.find((event) => event.id === previousCurrentId) ?? null
      : null) ?? latestByTime(summary.responseHistory.filter((event) => (
      event.source !== "current" && event.result !== "legacy_unclassified"
    )));
    const event: LinkedClassifiedCustomerResponseEvent = {
      id: `ir-response-${encodeURIComponent(input.mutationId)}`,
      reportId: input.reportId,
      eventKind: "customer_response",
      result: input.result,
      note: input.note,
      actorId: normalizedActor.id,
      actorName: normalizedActor.name,
      recordedAt,
      mutationId: input.mutationId,
      ...(previous ? { supersedesEventId: previous.id } : {}),
    };
    state.responseEvents.push(event);
    state.revision += 1;
    return { revision: state.revision, event };
  }, { action: "inspection.response.record.write" });
  store.read(() => null, "inspection.response.record.response");
  return { ...committed.result, replayed: committed.replayed };
}

const CREATE_QUICK_BO_FIELDS = new Set([
  "reportId",
  "expectedRevision",
  "quotationMutationId",
  "quickOrderMutationId",
  "selectedLineIds",
  "quickOrderSignature",
]);
const CREATE_QUICK_BO_SIGNATURE_FIELDS = new Set(["rawStrokes"]);

function normalizeCreateQuickOrderFromQuotationInput(
  input: CreateQuickOrderFromInspectionQuotationInput,
): CreateQuickOrderFromInspectionQuotationInput {
  assertClosedInput(input, CREATE_QUICK_BO_FIELDS, "检查结果创建业务单请求");
  if (typeof input.reportId !== "string" || !input.reportId.trim()) throw new LinkedApiDomainError("reportId 无效", 400);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new LinkedApiDomainError("expectedRevision 无效", 400);
  if (typeof input.quickOrderMutationId !== "string" || !input.quickOrderMutationId.trim()) {
    throw new LinkedApiDomainError("quickOrderMutationId 无效", 400);
  }
  if (input.quotationMutationId !== undefined && (typeof input.quotationMutationId !== "string" || !input.quotationMutationId.trim())) {
    throw new LinkedApiDomainError("quotationMutationId 无效", 400);
  }
  if (input.quotationMutationId?.trim() === input.quickOrderMutationId.trim()) {
    throw new LinkedApiDomainError("Quotation 与业务单必须使用不同 mutationId", 400);
  }
  if (!Array.isArray(input.selectedLineIds)) throw new LinkedApiDomainError("selectedLineIds 无效", 400);
  if (input.selectedLineIds.length === 0) throw new LinkedApiDomainError("至少勾选一条报价收费行", 400);
  if (input.selectedLineIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new LinkedApiDomainError("selectedLineIds 包含无效 ID", 400);
  }
  const selectedLineIds = input.selectedLineIds.map((id) => id.trim());
  if (new Set(selectedLineIds).size !== selectedLineIds.length) throw new LinkedApiDomainError("selectedLineIds 不得重复", 400);
  if (input.quickOrderSignature !== undefined) {
    assertClosedInput(input.quickOrderSignature, CREATE_QUICK_BO_SIGNATURE_FIELDS, "业务单优惠签字");
    if (!Array.isArray(input.quickOrderSignature.rawStrokes)) throw new LinkedApiDomainError("业务单优惠签字笔迹无效", 400);
  }
  return {
    reportId: input.reportId.trim(),
    expectedRevision: input.expectedRevision,
    ...(input.quotationMutationId ? { quotationMutationId: input.quotationMutationId.trim() } : {}),
    quickOrderMutationId: input.quickOrderMutationId.trim(),
    selectedLineIds,
    ...(input.quickOrderSignature
      ? { quickOrderSignature: { rawStrokes: structuredClone(input.quickOrderSignature.rawStrokes) } }
      : {}),
  };
}

/** Locked, idempotent copy of ordered current Quotation rows into one Quick BO. */
export async function createMockQuickOrderFromInspectionQuotation(
  rawInput: CreateQuickOrderFromInspectionQuotationInput,
  actor: QuotationMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<QuickOrder> {
  const input = normalizeCreateQuickOrderFromQuotationInput(rawInput);
  const normalizedActor = normalizeQuotationActor(actor);
  const recordedAt = jamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<QuickOrder>({
    mutationId: input.quickOrderMutationId,
    operation: "quickOrders.createFromInspection",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, (state) => {
    if (input.expectedRevision !== state.revision) {
      throw new LinkedApiDomainError("Inspection Report 版本已变化，请刷新", 409);
    }
    const report = state.inspectionReports.find((candidate) => candidate.id === input.reportId);
    if (!report) throw new LinkedApiDomainError("Inspection Report 不存在", 404);
    const quotation = state.currentQuotations.find((candidate) => candidate.id === report.quotationId);
    if (!quotation) throw new LinkedApiDomainError("Inspection Report 当前 Quotation 不存在", 500);
    if (input.quotationMutationId) {
      const prerequisite = state.mutationReceipts.find((receipt) => receipt.mutationId === input.quotationMutationId);
      const prerequisiteResult = prerequisite?.result as Partial<UpdateQuotationResult> | undefined;
      if (
        !prerequisite
        || prerequisite.operation !== "inspection.quotation.update"
        || prerequisite.actorId !== normalizedActor.id
        || prerequisite.committedRevision !== input.expectedRevision
        || prerequisiteResult?.quotationId !== quotation.id
        || prerequisiteResult.revision !== input.expectedRevision
      ) {
        throw new LinkedApiDomainError("Quotation 前置写入凭据无效", 409);
      }
    }
    const currentLineIds = new Set(quotation.lineIds);
    const selectedLines = input.selectedLineIds.map((lineId): QuickOrderChargeLine => {
      if (!currentLineIds.has(lineId)) throw new LinkedApiDomainError("所选收费行不属于当前 Inspection Report Quotation", 400);
      const line = state.quotedChargeLines.find((candidate) => candidate.id === lineId);
      if (!line || line.pricingMode === "parking_projection") {
        throw new LinkedApiDomainError("所选收费行不是可创建业务单的当前报价行", 400);
      }
      return line;
    });
    if (!discountApprovalRequirement(selectedLines).required && input.quickOrderSignature) {
      throw new LinkedApiDomainError("当前所选收费行未超过优惠门槛，不应提交业务单签字", 400);
    }
    const order = appendSharedQuickOrderToState(
      state,
      {
        customerId: report.customerId,
        vehicleId: report.vehicleId,
        rawInput: "",
        noteZh: `来自检查结果：${report.inspectionReportNo}`,
        chargeLines: selectedLines,
        mutationId: input.quickOrderMutationId,
        ...(input.quickOrderSignature ? { signature: input.quickOrderSignature } : {}),
      },
      normalizedActor satisfies SharedQuickOrderMutationActor,
      recordedAt,
    );
    state.revision += 1;
    return order;
  }, { action: "quickOrders.createFromInspection.write" });
  // A transport can fail after the canonical commit. The idempotency receipt
  // lets the caller retry the same intent without creating a second BO.
  store.read(() => null, "quickOrders.createFromInspection.response");
  return committed.result;
}

// 报价不记录逐项客户决定（8/18 老板：同意与否以业务单 Invoice 签字为准），决定 API 已删除。

export function recordMockInspectionCommunication(
  _input: RecordCommunicationInput,
  _actorId: string,
  _store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<LinkedCommunicationFact> {
  return Promise.reject(new LinkedApiDomainError("旧客户沟通写入已停用，请使用 canonical 通知或回应事件", 410));
}

// ---------------------------------------------------------------------------
// 检查结果创建（2026-08-18 老板定）：选车 → 自然语言回交 → AI 整理 → 生成详情 → 人工发客户
// ---------------------------------------------------------------------------

export interface CreateInspectionReportInput {
  vehicleId: string;
  sourceBusinessOrderId?: string;
  rawText: string;
  aiDraft: string;
  items: ReadonlyArray<{
    findingZh: string;
    findingEn?: string;
    recommendationZh: string;
    recommendationEn?: string;
    remarkZh?: string;
    remarkEn?: string;
    nextStepZh?: string;
    nextStepEn?: string;
  }>;
  quotationLines?: ReadonlyArray<UpdateQuotationLineInput>;
  /** @deprecated Compatibility input; normalized through the canonical charge-line validator. */
  quotationItems?: ReadonlyArray<{
    descZh: string;
    descEn?: string;
    remarkZh?: string;
    remarkEn?: string;
    unit?: string;
    unitEn?: string;
    quantity?: number;
    unitPriceJmd: number;
    pendingQuote?: boolean;
    category: "labor" | "parts";
  }>;
  inspectorName?: string;
  teamId?: OrderTeamId;
}

export function createMockInspectionReportFromInput(
  input: CreateInspectionReportInput,
  actorId: string,
  actorName: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<InspectionReportDetailResponse> {
  return store.mutate((state) => {
    const vehicle = state.vehicles.find((item) => item.id === input.vehicleId);
    if (!vehicle) throw new LinkedApiDomainError("车辆不存在，先登记车辆再回交检查结果", 400);
    if (!input.rawText.trim()) throw new LinkedApiDomainError("自然语言检查结果不能为空", 400);
    if (input.items.length === 0) throw new LinkedApiDomainError("至少整理出一条检查项目", 400);
    for (const item of input.items) {
      if (!item.findingZh.trim() || !item.recommendationZh.trim()) throw new LinkedApiDomainError("检查项目与建议不能为空", 400);
    }

    const sequence = state.inspectionReports.length + 1;
    const reportId = `inspection-report-new-${sequence}`;
    const quotationId = `quotation-new-${sequence}`;
    const now = new Date(store.nowMs()).toISOString();
    const itemIds = input.items.map((_item, index) => `${reportId}-item-${index + 1}`);

    itemIds.forEach((itemId, index) => {
      state.inspectionItems.push({
        id: itemId,
        inspectionReportId: reportId,
        findingZh: input.items[index].findingZh.trim(),
        findingEn: input.items[index].findingEn?.trim() || "",
        recommendationZh: input.items[index].recommendationZh.trim(),
        recommendationEn: input.items[index].recommendationEn?.trim() || "",
        remarkZh: input.items[index].remarkZh?.trim() || undefined,
        remarkEn: input.items[index].remarkEn?.trim() || undefined,
        nextStepZh: input.items[index].nextStepZh?.trim() || undefined,
        nextStepEn: input.items[index].nextStepEn?.trim() || undefined,
      });
    });
    const submittedQuotationLines = input.quotationLines
      ?? legacyQuotationLines(input.quotationItems ?? []);
    const quotationLines = submittedQuotationLines.map(normalizeQuotationLine).map((line, index): QuotedChargeLine => {
      const id = `${quotationId}-line-create-${index + 1}`;
      const withId = {
        ...line,
        id,
        ...(line.pricingMode === "unit" ? { sourceId: itemIds[index % itemIds.length] } : {}),
      } as QuotedChargeLine;
      try {
        validateQuotedChargeLine(withId);
      } catch (error) {
        throw new LinkedApiDomainError(error instanceof Error ? error.message : "报价收费行无效", 400);
      }
      return withId;
    });
    if (discountApprovalRequirement(quotationLines).required) {
      throw new LinkedApiDomainError("新建报告不能绕过高优惠签字，请先创建后在 Quotation 中签字保存", 400);
    }
    state.quotedChargeLines.push(...quotationLines);
    const quotationNo = formatInspectionReportNo({
      branchCode: "KGN",
      brandCode: "WH",
      businessDate: businessDateInJamaica(now),
      sequence: 19_500 + state.inspectionReports.length + 1,
    }).replace("-IR-", "-QT-");
    state.currentQuotations.push({
      id: quotationId,
      quotationNo,
      inspectionReportId: reportId,
      lineIds: quotationLines.map((line) => line.id),
      legacyReceivableAdjustmentIds: [],
      noteZh: DEFAULT_QUOTATION_NOTE_ZH,
      noteEn: DEFAULT_QUOTATION_NOTE_EN,
      contentRevision: 1,
      generationCounter: 0,
      lastGeneratedAt: null,
      generatedFromRevision: null,
      activeGeneratedBundle: null,
    });
    state.inspectionReports.push({
      id: reportId,
      ...(input.sourceBusinessOrderId ? { sourceBusinessOrderId: input.sourceBusinessOrderId } : {}),
      inspectionReportNo: formatInspectionReportNo({
        branchCode: "KGN",
        brandCode: "WH",
        businessDate: businessDateInJamaica(now),
        sequence: 19_500 + state.inspectionReports.length + 1,
      }),
      customerId: vehicle.customerId,
      vehicleId: vehicle.id,
      status: "awaiting_frontdesk",
      submissionId: `${reportId}-submission`,
      submissionSourceVersion: 1,
      inspectorId: `frontdesk-${actorId}`,
      inspectorName: input.inspectorName?.trim() || actorName,
      inspectorTeamId: input.teamId ?? "t1",
      submittedAt: now,
      rawText: input.rawText.trim(),
      aiDraft: input.aiDraft.trim(),
      photoIds: [],
      categoryReviewRequired: false,
      itemIds,
      quotationId,
    });
    state.revision += 1;
    return detailFromState(state, reportId);
  }, { action: "inspection.create.write" });
}


export interface UpdateInspectionReportItemsInput {
  readonly items: ReadonlyArray<{
    readonly id?: string;
    readonly findingZh: string;
    readonly findingEn?: string;
    readonly recommendationZh: string;
    readonly recommendationEn?: string;
    /** 情况描述备注 + 下一步待定说明。 */
    readonly remarkZh?: string;
    readonly remarkEn?: string;
    readonly nextStepZh?: string;
    readonly nextStepEn?: string;
  }>;
}

/** 检查项目内联编辑保存（8/18 老板：检查结果也要像业务单一样直接改）。任何状态都可改（8/20 老板：AI 拆错随时改）。 */
export function updateMockInspectionReportItems(
  reportId: string,
  input: UpdateInspectionReportItemsInput,
  actorName: string,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<InspectionReportDetailResponse> {
  return store.mutate((state) => {
    const report = state.inspectionReports.find((item) => item.id === reportId);
    if (!report) throw new LinkedApiDomainError("Inspection Report 不存在", 404);
    if (input.items.length === 0) throw new LinkedApiDomainError("至少保留一条检查项目", 400);
    for (const item of input.items) {
      if (!item.findingZh.trim() || !item.recommendationZh.trim()) throw new LinkedApiDomainError("检查发现与处理建议不能为空", 400);
    }
    const itemIds = input.items.map((item, index) => item.id ?? `${reportId}-item-${index + 1}`);
    state.inspectionItems = state.inspectionItems.filter((item) => item.inspectionReportId !== reportId);
    itemIds.forEach((itemId, index) => {
      state.inspectionItems.push({
        id: itemId,
        inspectionReportId: reportId,
        findingZh: input.items[index].findingZh.trim(),
        findingEn: input.items[index].findingEn?.trim() || "",
        recommendationZh: input.items[index].recommendationZh.trim(),
        recommendationEn: input.items[index].recommendationEn?.trim() || "",
        remarkZh: input.items[index].remarkZh?.trim() || undefined,
        remarkEn: input.items[index].remarkEn?.trim() || undefined,
        nextStepZh: input.items[index].nextStepZh?.trim() || undefined,
        nextStepEn: input.items[index].nextStepEn?.trim() || undefined,
      });
    });
    (report as LinkedInspectionReportFact & { itemIds: string[] }).itemIds = itemIds;
    state.revision += 1;
    return detailFromState(state, reportId);
  }, { action: "inspection.items.write" });
}

export interface UpdateInspectionReportPhotosInput {
  readonly reportId: string;
  readonly expectedRevision: number;
  readonly mutationId: string;
  readonly deleteIds: ReadonlyArray<string>;
  readonly files: ReadonlyArray<File>;
}

export interface UpdateInspectionReportPhotosResult {
  readonly revision: number;
  readonly photos: InspectionReportPhotoDto[];
  readonly auditEventIds: string[];
}

const UPDATE_PHOTOS_FIELDS = new Set(["reportId", "expectedRevision", "mutationId", "deleteIds", "files"]);

function normalizePhotoActor(actor: SharedQuickOrderMutationActor): SharedQuickOrderMutationActor {
  if (
    actor === null
    || typeof actor !== "object"
    || typeof actor.id !== "string"
    || !actor.id.trim()
    || typeof actor.name !== "string"
    || !actor.name.trim()
    || (actor.role !== "superadmin" && actor.role !== "frontdesk_admin")
  ) throw new LinkedApiDomainError("现场照片操作账号无效", 403);
  return { id: actor.id.trim(), name: actor.name.trim(), role: actor.role };
}

function nextPhotoAttachmentId(
  state: LinkedOperationsState,
  reportId: string,
  mutationId: string,
  occurrence: number,
): string {
  const occupied = new Set(state.reportAttachments.map((attachment) => attachment.id));
  const stem = `${reportId}-photo-${encodeURIComponent(mutationId)}-${occurrence}`;
  if (!occupied.has(stem)) return stem;
  for (let collision = 2; collision <= 10_000; collision += 1) {
    const candidate = `${stem}-${collision}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new LinkedApiDomainError("现场照片 ID 空间已耗尽", 409);
}

/** One locked mutation owns ordered upload/delete metadata and its audit trail. */
export async function updateMockInspectionReportPhotos(
  reportId: string,
  rawInput: UpdateInspectionReportPhotosInput,
  actor: SharedQuickOrderMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
  repository: ReportPhotoRepository = getReportPhotoRepository(),
): Promise<UpdateInspectionReportPhotosResult> {
  assertClosedInput(rawInput, UPDATE_PHOTOS_FIELDS, "现场照片写入请求");
  if (typeof reportId !== "string" || !reportId.trim()) throw new LinkedApiDomainError("Inspection Report ID 无效", 400);
  if (typeof rawInput.reportId !== "string" || rawInput.reportId.trim() !== reportId.trim()) {
    throw new LinkedApiDomainError("路径与现场照片 reportId 不一致", 400);
  }
  if (!Number.isSafeInteger(rawInput.expectedRevision) || rawInput.expectedRevision < 1) {
    throw new LinkedApiDomainError("Inspection Report revision 无效", 400);
  }
  if (typeof rawInput.mutationId !== "string" || !rawInput.mutationId.trim()) {
    throw new LinkedApiDomainError("mutationId 无效", 400);
  }
  if (!Array.isArray(rawInput.deleteIds) || rawInput.deleteIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new LinkedApiDomainError("待删除照片 ID 无效", 400);
  }
  const normalizedDeleteIds = rawInput.deleteIds.map((id) => id.trim());
  if (new Set(normalizedDeleteIds).size !== normalizedDeleteIds.length) {
    throw new LinkedApiDomainError("待删除照片 ID 重复", 400);
  }
  if (!Array.isArray(rawInput.files) || rawInput.files.some((file) => !(file instanceof File))) {
    throw new LinkedApiDomainError("待上传照片无效", 400);
  }
  if (rawInput.deleteIds.length === 0 && rawInput.files.length === 0) {
    throw new LinkedApiDomainError("现场照片写入意图为空", 400);
  }
  const normalizedActor = normalizePhotoActor(actor);
  let inspectedFiles;
  try {
    inspectedFiles = await Promise.all(rawInput.files.map(inspectReportPhotoFile));
  } catch (error) {
    throw new LinkedApiDomainError(error instanceof Error ? error.message : "现场照片无效", 400);
  }
  const input = {
    reportId: reportId.trim(),
    expectedRevision: rawInput.expectedRevision,
    mutationId: rawInput.mutationId.trim(),
    deleteIds: normalizedDeleteIds,
    files: inspectedFiles.map(({ blob: _blob, ...file }) => file),
  };
  const recordedAt = jamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<UpdateInspectionReportPhotosResult>({
    mutationId: input.mutationId,
    operation: "inspection.photos.update",
    actorId: normalizedActor.id,
    payload: input,
    recordedAt,
  }, async (state) => {
    const report = state.inspectionReports.find((item) => item.id === reportId);
    if (!report) throw new LinkedApiDomainError("Inspection Report 不存在", 404);
    if (input.expectedRevision !== state.revision) {
      throw new LinkedApiDomainError("Inspection Report 版本已变化，请刷新", 409);
    }
    const activeAttachments = report.photoIds.map((id) => {
      const attachment = state.reportAttachments.find((candidate) => candidate.id === id);
      if (!attachment || attachment.lifecycle !== "active") {
        throw new LinkedApiDomainError("Inspection Report 照片引用不完整", 500);
      }
      return attachment;
    });
    const deleteSet = new Set(input.deleteIds);
    for (const deleteId of input.deleteIds) {
      const attachment = activeAttachments.find((candidate) => candidate.id === deleteId);
      if (!attachment || attachment.reportId !== report.id || attachment.vehicleId !== report.vehicleId) {
        throw new LinkedApiDomainError("待删除照片不属于当前 Inspection Report", 400);
      }
    }
    const uploadRecords: ReportPhotoBlobRecord[] = inspectedFiles.map((file, index) => ({
      id: nextPhotoAttachmentId(state, report.id, input.mutationId, index + 1),
      reportId: report.id,
      vehicleId: report.vehicleId,
      ...file,
    }));
    try {
      await repository.writeBatch(uploadRecords);
    } catch (error) {
      throw new LinkedApiDomainError(error instanceof Error ? error.message : "现场照片 Blob 写入失败", 503);
    }
    const retainedIds = report.photoIds.filter((id) => !deleteSet.has(id));
    const auditEventIds: string[] = [];
    report.photoIds = [...retainedIds, ...uploadRecords.map((record) => record.id)];
    for (const attachment of activeAttachments) {
      const attachmentIndex = state.reportAttachments.findIndex((candidate) => candidate.id === attachment.id);
      if (deleteSet.has(attachment.id)) {
        state.reportAttachments[attachmentIndex] = {
          ...attachment,
          lifecycle: "deleted",
          activeSequence: null,
          deletedAt: recordedAt,
          deletedByActorId: normalizedActor.id,
          deletedByActorName: normalizedActor.name,
        };
      } else {
        state.reportAttachments[attachmentIndex] = {
          ...attachment,
          activeSequence: retainedIds.indexOf(attachment.id),
        };
      }
    }
    input.deleteIds.forEach((attachmentId) => {
      const auditEventId = `${input.mutationId}:deleted:${attachmentId}`;
      state.reportAttachmentAuditEvents.push({
        id: auditEventId,
        attachmentId,
        reportId: report.id,
        vehicleId: report.vehicleId,
        action: "deleted",
        actorId: normalizedActor.id,
        actorName: normalizedActor.name,
        mutationId: input.mutationId,
        recordedAt,
      });
      auditEventIds.push(auditEventId);
    });
    uploadRecords.forEach((record, index) => {
      state.reportAttachments.push({
        id: record.id,
        reportId: report.id,
        vehicleId: report.vehicleId,
        lifecycle: "active",
        activeSequence: retainedIds.length + index,
        storageKind: "indexeddb_blob",
        originalName: record.originalName,
        detectedMediaType: record.detectedMediaType,
        widthPx: record.widthPx,
        heightPx: record.heightPx,
        byteLength: record.byteLength,
        sha256: record.sha256,
        createdAt: recordedAt,
        uploaderActorId: normalizedActor.id,
        uploaderActorName: normalizedActor.name,
      });
      const auditEventId = `${input.mutationId}:uploaded:${record.id}`;
      state.reportAttachmentAuditEvents.push({
        id: auditEventId,
        attachmentId: record.id,
        reportId: report.id,
        vehicleId: report.vehicleId,
        action: "uploaded",
        actorId: normalizedActor.id,
        actorName: normalizedActor.name,
        mutationId: input.mutationId,
        recordedAt,
      });
      auditEventIds.push(auditEventId);
    });
    state.revision += 1;
    return {
      revision: state.revision,
      photos: detailFromState(state, reportId).photos,
      auditEventIds,
    };
  }, { action: "inspection.photos.write" });
  if (input.deleteIds.length > 0) {
    try {
      await repository.deleteMany(input.deleteIds);
    } catch {
      // Canonical references and tombstones are authoritative. Orphan cleanup is retryable.
    }
  }
  store.read(() => null, "inspection.photos.write.response");
  return committed.result;
}

export interface UpdateInspectionReportDraftInput {
  expectedRevision: number;
  mutationId: string;
  rawText: string;
  aiDraft: string;
  items: ReadonlyArray<{
    findingZh: string;
    findingEn?: string;
    recommendationZh: string;
    recommendationEn?: string;
    remarkZh?: string;
    remarkEn?: string;
    nextStepZh?: string;
    nextStepEn?: string;
  }>;
  quotationLines?: ReadonlyArray<UpdateQuotationLineInput>;
  /** @deprecated Compatibility input; normalized through the same Quotation transaction. */
  quotationItems?: ReadonlyArray<{
    descZh: string;
    descEn?: string;
    remarkZh?: string;
    remarkEn?: string;
    unit?: string;
    unitEn?: string;
    quantity?: number;
    unitPriceJmd: number;
    pendingQuote?: boolean;
    category: "labor" | "parts";
  }>;
  signature?: {
    rawStrokes: DiscountApprovalEvidence["rawStrokes"];
  };
}

/**
 * 前台代录管道（2026-08-20 老板定）：自然语言 → AI 拆分 → AI 组织语言 → 人工审核编辑。
 * 一次保存覆盖原文/AI 草稿/检查项目；只有首次初始化或调用方明确提交
 * quotationLines 时才原位写报价。省略报价字段必须保留人工报价事实与稳定 ID。
 */
export async function updateMockInspectionReportDraft(
  reportId: string,
  input: UpdateInspectionReportDraftInput,
  actor: QuotationMutationActor,
  store: MockLinkedOperationsStore = getMockLinkedOperationsStore(),
): Promise<InspectionReportDetailResponse> {
  const normalizedActor = normalizeQuotationActor(actor);
  const submittedQuotationLines = input.quotationLines
    ?? (input.quotationItems !== undefined ? legacyQuotationLines(input.quotationItems) : undefined);
  const quotationInput = submittedQuotationLines === undefined ? null : normalizeUpdateQuotationInput({
      reportId,
      expectedRevision: input.expectedRevision,
      mutationId: input.mutationId,
      lines: submittedQuotationLines,
      noteZh: "",
      noteEn: "",
      ...(input.signature ? { signature: input.signature } : {}),
    });
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new LinkedApiDomainError("Inspection Report revision 无效", 400);
  }
  if (typeof input.mutationId !== "string" || !input.mutationId.trim()) {
    throw new LinkedApiDomainError("mutationId 无效", 400);
  }
  if (quotationInput === null && input.signature !== undefined) {
    throw new LinkedApiDomainError("未提交报价收费行时不能提交优惠签字", 400);
  }
  const mutationId = input.mutationId.trim();
  const recordedAt = jamaicaInstant(store.nowMs());
  const committed = await store.mutateIdempotently<InspectionReportDetailResponse>({
    mutationId,
    operation: "inspection.draft.update",
    actorId: normalizedActor.id,
    payload: {
      reportId,
      expectedRevision: input.expectedRevision,
      rawText: input.rawText,
      aiDraft: input.aiDraft,
      items: input.items,
      ...(quotationInput ? { quotationLines: quotationInput.lines } : {}),
      ...(quotationInput?.signature ? { signature: quotationInput.signature } : {}),
    },
    recordedAt,
  }, (state) => {
    const report = state.inspectionReports.find((item) => item.id === reportId);
    if (!report) throw new LinkedApiDomainError("Inspection Report 不存在", 404);
    if (input.expectedRevision !== state.revision) {
      throw new LinkedApiDomainError("Inspection Report 版本已变化，请刷新", 409);
    }
    if (!input.rawText.trim()) throw new LinkedApiDomainError("自然语言检查结果不能为空", 400);
    if (input.items.length === 0) throw new LinkedApiDomainError("至少整理出一条检查项目", 400);
    for (const item of input.items) {
      if (!item.findingZh.trim() || !item.recommendationZh.trim()) throw new LinkedApiDomainError("检查发现与处理建议不能为空", 400);
    }
    const currentQuotation = state.currentQuotations.find((item) => item.id === report.quotationId);
    if (!currentQuotation) throw new LinkedApiDomainError("Inspection Report 当前 Quotation 不存在", 500);
    if (quotationInput) {
      applyQuotationMutationToState(state, {
        ...quotationInput,
        noteZh: currentQuotation.noteZh,
        noteEn: currentQuotation.noteEn,
      }, normalizedActor, recordedAt);
    }
    const itemIds = input.items.map((_item, index) => reportId + "-item-" + (index + 1));
    state.inspectionItems = state.inspectionItems.filter((item) => item.inspectionReportId !== reportId);
    itemIds.forEach((itemId, index) => {
      state.inspectionItems.push({
        id: itemId,
        inspectionReportId: reportId,
        findingZh: input.items[index].findingZh.trim(),
        findingEn: input.items[index].findingEn?.trim() || "",
        recommendationZh: input.items[index].recommendationZh.trim(),
        recommendationEn: input.items[index].recommendationEn?.trim() || "",
        remarkZh: input.items[index].remarkZh?.trim() || undefined,
        remarkEn: input.items[index].remarkEn?.trim() || undefined,
        nextStepZh: input.items[index].nextStepZh?.trim() || undefined,
        nextStepEn: input.items[index].nextStepEn?.trim() || undefined,
      });
    });
    report.itemIds = itemIds;
    report.rawText = input.rawText.trim();
    report.aiDraft = input.aiDraft.trim();
    state.revision += 1;
    return detailFromState(state, reportId);
  }, { action: "inspection.draft.write" });
  return committed.result;
}
