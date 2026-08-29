export type FormalInspectionReport = {
  id: number;
  reportNo: string;
  vehicleId: number;
  sourceBusinessOrderId: number | null;
  sourceRepairRoundId: number | null;
  correctionOfReportId: number | null;
  correctionReason: string | null;
  inspectionTeamId: number;
  summaryZh: string;
  summaryEn: string | null;
  specialCaseNotesZh: string | null;
  actualInspectorStaffMemberId: number | null;
  paperPhotoFileId: number | null;
  status: "draft" | "submitted";
  createdAt: string;
  submittedAt: string | null;
  version: number;
  findings: Array<{
    id: number;
    findingZh: string;
    findingEn: string | null;
    recommendationZh: string | null;
    recommendationEn: string | null;
    sortOrder: number;
  }>;
};

export type FormalInspectionListItem = {
  report: FormalInspectionReport;
  vehicle: { id: number; plate: string; description: string };
  customer: { name: string | null; phone: string | null; whatsapp: string | null; email: string | null };
  inspectorName: string | null;
  teamName: string;
  sourceBusinessOrder: { id: number; orderNo: string } | null;
};

export type FormalInspectionReportList = {
  items: FormalInspectionListItem[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
};

export type FormalInspectionCommunication = {
  id: number;
  inspectionReportId: number;
  vehicleId: number;
  sourceBusinessOrderId: number | null;
  channel: "sms" | "email" | "whatsapp";
  targetContact: string;
  initiatedAt: string;
  initiatedBy: number;
  status: "initiated" | "confirmed" | "not_delivered";
  noteOrReply: string | null;
};

export type FormalInspectionReportDetail = FormalInspectionListItem & {
  communications: FormalInspectionCommunication[];
};

async function formalInspectionJson<T>(input: RequestInfo | URL): Promise<T> {
  const response = await fetch(input, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Inspection Report 读取失败");
  return payload;
}

export function fetchFormalInspectionReports(input: {
  page?: number;
  search?: string;
  sourceBusinessOrderId?: number;
} = {}): Promise<FormalInspectionReportList> {
  const query = new URLSearchParams();
  query.set("page", String(input.page ?? 1));
  if (input.search) query.set("search", input.search);
  if (input.sourceBusinessOrderId) query.set("sourceBusinessOrderId", String(input.sourceBusinessOrderId));
  return formalInspectionJson(`/api/formal/inspection-reports?${query.toString()}`);
}

export function fetchFormalInspectionReport(id: number): Promise<FormalInspectionReportDetail> {
  return formalInspectionJson(`/api/formal/inspection-reports/${id}`);
}

export async function createFormalInspectionReport(input: {
  vehicleId: number;
  sourceBusinessOrderId?: number;
  inspectionTeamId: number;
  actualInspectorStaffMemberId?: number | null;
  summaryZh: string;
  specialCaseNotesZh?: string | null;
  findings?: Array<{ findingZh: string; recommendationZh?: string }>;
}): Promise<FormalInspectionReport> {
  const response = await fetch("/api/formal/inspection-reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as FormalInspectionReport & { error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Inspection Report 创建失败");
  return payload;
}

export async function recordFormalInspectionNotification(input: {
  inspectionReportId: number;
  channel: "sms" | "email" | "whatsapp";
  targetContact: string;
  noteOrReply?: string;
}): Promise<FormalInspectionCommunication> {
  const response = await fetch(`/api/formal/inspection-reports/${input.inspectionReportId}/communications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as FormalInspectionCommunication & { error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "通知记录失败");
  return payload;
}
