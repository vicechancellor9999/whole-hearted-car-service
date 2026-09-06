import {
  buildInspectionOriginalQuotationText,
  completeInspectionAiProposal,
  inspectionAiProposalIssues,
} from "@/lib/inspection/formal-inspection-ai";
import { inspectionDetailResponse, inspectionListResponse } from "./formal-inspection-response";
import { withRequestDeadline } from "./request-deadline";

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
  currentWorkspaceVersionNo?: number;
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
  vehicle: {
    id: number;
    plate: string;
    description: string;
    descriptionZh: string;
    descriptionEn: string;
  };
  customer: { name: string | null; phone: string | null; whatsapp: string | null; email: string | null };
  inspectorName: string | null;
  teamName: string;
  sourceBusinessOrder: { id: number; orderNo: string } | null;
  followupStage: 0 | 1 | 2 | 3;
};

export type FormalInspectionReportList = {
  currentAccountId?: number;
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
  workspace: FormalInspectionWorkspace;
};

export type FormalInspectionOrganized = {
  summaryZh: string;
  summaryEn: string | null;
  specialCaseNotesZh: string | null;
  specialCaseNotesEn?: string | null;
  findings: Array<{
    findingZh: string;
    findingEn: string | null;
    recommendationZh: string | null;
    recommendationEn: string | null;
  }>;
};

export type FormalInspectionQuotation = {
  status: "pending" | "entered" | "not_quoted";
  noteZh: string | null;
  noteEn: string | null;
  wholeOrderDiscountMinor?: number;
  lines: Array<{
    kind: "labor" | "part" | "other";
    nameZh: string;
    nameEn: string | null;
    descriptionZh: string | null;
    descriptionEn: string | null;
    quantity: string;
    unitPriceMinor: number | null;
    itemDiscountMinor?: number;
    subtotalMinor: number | null;
  }>;
};

export type FormalInspectionWorkspace = {
  versionNo: number;
  source: "original" | "manual" | "ai";
  changeReason: string;
  createdAt: string;
  createdBy: number;
  organized: FormalInspectionOrganized;
  quotation: FormalInspectionQuotation;
};

async function formalInspectionJson<T>(input: RequestInfo | URL): Promise<T> {
  const response = await fetch(input, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Inspection Report 读取失败");
  return payload;
}

export async function fetchFormalInspectionReports(input: {
  page?: number;
  search?: string;
  sourceBusinessOrderId?: number;
} = {}): Promise<FormalInspectionReportList> {
  const query = new URLSearchParams();
  query.set("page", String(input.page ?? 1));
  if (input.search) query.set("search", input.search);
  if (input.sourceBusinessOrderId) query.set("sourceBusinessOrderId", String(input.sourceBusinessOrderId));
  const payload = await formalInspectionJson<unknown>(`/api/formal/inspection-reports?${query.toString()}`);
  const parsed = inspectionListResponse.safeParse(payload);
  if (!parsed.success) throw new Error("检查结果列表响应不完整，请重新读取。");
  return parsed.data;
}

export async function fetchFormalInspectionReport(id: number): Promise<FormalInspectionReportDetail> {
  const payload = await formalInspectionJson<unknown>(`/api/formal/inspection-reports/${id}`);
  const parsed = inspectionDetailResponse.safeParse(payload);
  if (!parsed.success || parsed.data.report.id !== id) throw new Error("检查报告响应不完整，请重新读取；当前草稿不会被替换。");
  return parsed.data;
}

export async function saveFormalInspectionWorkspace(id: number, input: {
  expectedVersion: number;
  organized: FormalInspectionOrganized;
  quotation: FormalInspectionQuotation;
  source: "manual" | "ai";
  changeReason: string;
}): Promise<FormalInspectionReportDetail> {
  const unconfirmed = "无法确认报告是否已保存。当前草稿仍保留，请先核对最新版本，再决定是否重新保存。";
  let response: Response;
  try {
    response = await fetch(`/api/formal/inspection-reports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch { throw new Error(unconfirmed); }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
    throw new Error(response.status >= 500 ? unconfirmed : typeof error === "string" ? error : "检查报告草稿保存失败");
  }
  const parsed = inspectionDetailResponse.safeParse(payload);
  if (!parsed.success || parsed.data.report.id !== id
    || parsed.data.report.version !== input.expectedVersion + 1
    || parsed.data.workspace.source !== input.source
    || parsed.data.workspace.versionNo < 1) throw new Error(unconfirmed);
  return parsed.data;
}

export async function organizeFormalInspectionReport(
  detail: FormalInspectionReportDetail,
  options: {
    currentDraft?: { organized: FormalInspectionOrganized; quotation: FormalInspectionQuotation };
    instruction?: string;
    signal?: AbortSignal;
  } = {},
): Promise<{ organized: FormalInspectionOrganized; quotation: FormalInspectionQuotation }> {
  const originalText = buildInspectionOriginalQuotationText({
    summaryZh: detail.report.summaryZh,
    summaryEn: detail.report.summaryEn,
    specialCaseNotesZh: detail.report.specialCaseNotesZh,
    findings: detail.report.findings,
  });
  const system = "你是汽车维修检查报告与报价整理助手。把维修工零散表达整理成客户能理解的专业报告，并忠实生成完整中文和英文。只可重组、补全语法、润色和翻译用户提供的事实，不得新增故障、维修建议、价格、数量、折扣或结论。检查结论用于概括问题和建议，不要把报价明细整句复制进结论。原文明确出现的每个价格都必须拆成 quotation.lines；金额使用 JMD 最小货币单位整数。每条报价必须把字段分开：nameZh/nameEn 只填简短、可结算的项目名称，不得填整句工作过程，不得携带数量或金额；descriptionZh/descriptionEn 填完整的工作说明、先后关系和数量说明；quantity 只填数量。只有原文明确标注工时/人工/Labor 时才可 kind='labor'；只有原文明确指向配件、材料或具体物料时才可 kind='part'；无法确定时必须 kind='other'，且中英文报价说明必须提醒前台确认分类和项目名称。没有明确价格时保持 pending，不得猜价；原文没有折扣时 itemDiscountMinor 和 wholeOrderDiscountMinor 必须为 0。输出严格 JSON，顶层只能有 organized 和 quotation。organized={summaryZh:string,summaryEn:string,specialCaseNotesZh:string|null,specialCaseNotesEn:string|null,findings:Array<{findingZh:string,findingEn:string,recommendationZh:string|null,recommendationEn:string|null}>}。quotation={status:'pending'|'entered'|'not_quoted',noteZh:string|null,noteEn:string|null,wholeOrderDiscountMinor:number,lines:Array<{kind:'labor'|'part'|'other',nameZh:string,nameEn:string,descriptionZh:string|null,descriptionEn:string|null,quantity:string,unitPriceMinor:number|null,itemDiscountMinor:number,subtotalMinor:number|null}>}。所有客户可见的中英文字段必须成对完成。";
  const user = JSON.stringify({
    vehicle: detail.vehicle,
    original: {
      summaryZh: detail.report.summaryZh,
      summaryEn: detail.report.summaryEn,
      specialCaseNotesZh: detail.report.specialCaseNotesZh,
      findings: detail.report.findings,
    },
    currentDraft: options.currentDraft ?? null,
    frontDeskInstruction: options.instruction?.trim() || null,
  });

  let proposal = completeInspectionAiProposal(
    await requestInspectionAi([{ role: "system", content: system }, { role: "user", content: user }], options.signal),
    originalText,
  );
  let issues = inspectionAiProposalIssues(proposal);
  if (issues.length > 0) {
    proposal = completeInspectionAiProposal(await requestInspectionAi([
      { role: "system", content: system },
      { role: "user", content: user },
      { role: "assistant", content: JSON.stringify(proposal) },
      {
        role: "user",
        content: `上一个结果仍不完整：${issues.join(", ")}。请仅依据原始回单修复缺失的中英文翻译与结构，返回完整 JSON。`,
      },
    ], options.signal), originalText);
    issues = inspectionAiProposalIssues(proposal);
  }
  if (issues.length > 0) {
    throw new Error(`AI 返回内容仍不完整（${issues.join(", ")}），未写入工作草稿。`);
  }
  return proposal;
}

async function requestInspectionAi(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, signal?: AbortSignal) {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: true, messages }),
    signal,
  });
  const payload = await response.json().catch(() => ({})) as { content?: unknown; error?: unknown };
  if (!response.ok || typeof payload.content !== "string") {
    throw new Error(typeof payload.error === "string" ? payload.error : "AI 整理失败");
  }
  let parsed: { organized?: FormalInspectionOrganized; quotation?: FormalInspectionQuotation };
  try {
    parsed = JSON.parse(payload.content) as typeof parsed;
  } catch {
    throw new Error("AI 返回的内容不是有效报告结构");
  }
  if (!parsed.organized || !parsed.quotation) throw new Error("AI 返回的报告结构不完整");
  return { organized: parsed.organized, quotation: parsed.quotation };
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
  const unconfirmed = "无法确认检查结果是否已创建，请先到检查结果列表核对，避免重复创建；当前填写内容仍保留。";
  return withRequestDeadline(async (signal) => {
    let response: Response;
    try {
      response = await fetch("/api/formal/inspection-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });
    } catch {
      throw new Error(unconfirmed);
    }
    const payload: unknown = await response.json().catch(() => null);
    signal.throwIfAborted();
    const saved = payload && typeof payload === "object" ? payload as Partial<FormalInspectionReport> & { error?: unknown } : null;
    if (!response.ok) throw new Error(response.status >= 500 ? unconfirmed : typeof saved?.error === "string" ? saved.error : "Inspection Report 创建失败");
    if (!saved || !Number.isSafeInteger(saved.id) || (saved.id ?? 0) <= 0
      || typeof saved.reportNo !== "string" || !saved.reportNo.trim()
      || saved.vehicleId !== input.vehicleId
      || saved.inspectionTeamId !== input.inspectionTeamId
      || (saved.sourceBusinessOrderId ?? null) !== (input.sourceBusinessOrderId ?? null)
      || (saved.actualInspectorStaffMemberId ?? null) !== (input.actualInspectorStaffMemberId ?? null)
      || saved.summaryZh !== input.summaryZh.normalize("NFKC").trim()
      || (saved.specialCaseNotesZh ?? null) !== (input.specialCaseNotesZh?.normalize("NFKC").trim() || null)) {
      throw new Error(unconfirmed);
    }
    return saved as FormalInspectionReport;
  }, 30_000, "检查创建等待超时，结果尚未确认；请先到检查结果列表核对，避免重复创建。当前填写内容仍保留。");
}

export async function recordFormalInspectionNotification(input: {
  inspectionReportId: number;
  channel: "sms" | "email" | "whatsapp";
  targetContact: string;
  noteOrReply?: string;
  status?: "initiated" | "confirmed" | "not_delivered";
  eventKind?: "notification" | "reply" | "status_correction";
}): Promise<FormalInspectionCommunication> {
  const response = await fetch(`/api/formal/inspection-reports/${input.inspectionReportId}/communications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload: unknown = await response.json().catch(() => null);
  const saved = payload && typeof payload === "object" ? payload as Partial<FormalInspectionCommunication> & { error?: unknown } : null;
  if (!response.ok) throw new Error(typeof saved?.error === "string" ? saved.error : "通知记录失败");
  if (!saved || !Number.isSafeInteger(saved.id) || (saved.id ?? 0) <= 0 || saved.inspectionReportId !== input.inspectionReportId) {
    throw new Error("无法确认记录是否已保存，请先核对客户跟进历史，避免重复提交。");
  }
  return saved as FormalInspectionCommunication;
}

export async function sendFormalInspectionSms(input: {
  inspectionReportId: number;
  targetContact: string;
  message: string;
}): Promise<{ communication: FormalInspectionCommunication; providerReference: string | null }> {
  const response = await fetch(`/api/formal/inspection-reports/${input.inspectionReportId}/sms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as {
    communication?: FormalInspectionCommunication;
    providerReference?: string | null;
    error?: unknown;
  };
  if (!response.ok || !payload.communication) {
    throw new Error(typeof payload.error === "string" ? payload.error : "短信发送失败");
  }
  return {
    communication: payload.communication,
    providerReference: payload.providerReference ?? null,
  };
}
