import { NextResponse } from "next/server";
import { apiActionContext, businessApiError } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";
import type { WorkReturnItemResult } from "@formal/modules/business-order/repair-round-service";

type Session = { account: { id: number } };
type Context = ReturnType<typeof apiActionContext>;
type AfterSalesRoundDeletionReasonCode = "duplicate" | "input_error" | "test_data" | "other";

type Dependencies = {
  readSession(): Promise<Session | null>;
  getCurrentRound(input: { businessOrderId: number; viewerAccountId: number }): Promise<unknown>;
  listRepairRounds(input: { businessOrderId: number; viewerAccountId: number }): Promise<unknown>;
  listAuditTrail?(input: { businessOrderId: number; viewerAccountId: number }): Promise<unknown>;
  getAfterSalesRoundDeletionPreview?(input: { businessOrderId: number; viewerAccountId: number }): Promise<unknown>;
  assignRound(input: { businessOrderId: number; expectedBusinessOrderVersion: number; teamId: number; customerConfirmedWithoutPayment: boolean; context: Context }): Promise<unknown>;
  withdrawAssignment(input: { businessOrderId: number; expectedRepairRoundVersion: number; context: Context }): Promise<unknown>;
  cancelAfterSalesRound(input: { businessOrderId: number; expectedRepairRoundVersion: number; context: Context }): Promise<unknown>;
  deleteInvalidAfterSalesRound?(input: {
    businessOrderId: number;
    expectedRepairRoundVersion: number;
    previewFingerprint: string;
    reasonCode: AfterSalesRoundDeletionReasonCode;
    reasonNote: string;
    confirmationRecordNo: string;
    context: Context;
  }): Promise<unknown>;
  setPerformanceDraft?(input: { businessOrderId: number; expectedRepairRoundId: number; expectedRepairRoundVersion: number; performanceValue: string; context: Context }): Promise<unknown>;
  recordAcceptanceOnBehalf(input: { businessOrderId: number; expectedRepairRoundVersion: number; actualStaffMemberId: number; context: Context }): Promise<unknown>;
  acceptRound?(input: { businessOrderId: number; expectedRepairRoundVersion: number; context: Context }): Promise<unknown>;
  startAfterSalesRound(input: { businessOrderId: number; expectedBusinessOrderVersion: number; issue: string; context: Context }): Promise<unknown>;
  recordIntakeMileage(input: { businessOrderId: number; expectedRepairRoundVersion: number; odometerKm: number; context: Context }): Promise<unknown>;
  attachIntakePhoto?(input: { businessOrderId: number; expectedRepairRoundVersion: number; fileId: number; context: Context }): Promise<unknown>;
  submitWorkReturn(input: { businessOrderId: number; expectedRepairRoundVersion: number; workSummary?: string; exceptionSummary?: string; itemResults?: WorkReturnItemResult[]; attachmentIds?: number[]; actualStaffMemberId?: number; context: Context }): Promise<unknown>;
  recordPaperWorkReturn?(input: { businessOrderId: number; expectedRepairRoundVersion: number; workSummary?: string; exceptionSummary?: string; itemResults?: WorkReturnItemResult[]; attachmentIds: number[]; actualStaffMemberId?: number; context: Context }): Promise<unknown>;
  recordPaperWorkReturnAndFormallyHandOff?(input: { businessOrderId: number; expectedRepairRoundVersion: number; workSummary?: string; exceptionSummary?: string; itemResults?: WorkReturnItemResult[]; attachmentIds: number[]; actualStaffMemberId?: number; performanceValue: string; context: Context }): Promise<unknown>;
  approveWorkReturn(input: { businessOrderId: number; expectedRepairRoundVersion: number; workReturnId: number; context: Context }): Promise<unknown>;
  approveAndFormallyHandOff?(input: { businessOrderId: number; expectedRepairRoundVersion: number; workReturnId: number; performanceValue: string; context: Context }): Promise<unknown>;
  returnWorkReturn(input: { businessOrderId: number; expectedRepairRoundVersion: number; workReturnId: number; reason: string; context: Context }): Promise<unknown>;
  formallyHandOffRound(input: { businessOrderId: number; expectedRepairRoundVersion: number; performanceValue: string; context: Context }): Promise<unknown>;
  cancelFormalHandoffInSameMonth(input: { businessOrderId: number; formalHandoffId: number; reason: string; context: Context }): Promise<unknown>;
  adjustFormalHandoffPerformanceInSameMonth?(input: {
    businessOrderId: number;
    formalHandoffId: number;
    expectedRepairRoundVersion: number;
    performanceValue: string;
    reason: string;
    context: Context;
  }): Promise<unknown>;
};

type ActionBody = Record<string, unknown> & { action?: unknown };

export function createBusinessOrderRoundsApiHandler(dependencies: Dependencies) {
  return async function handler(request: Request, params: { businessOrderId: number }): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const businessOrderId = Number(params.businessOrderId);
    try {
      if (request.method === "GET") {
        const [current, history, auditTrail, afterSalesRoundDeletion] = await Promise.all([
          dependencies.getCurrentRound({ businessOrderId, viewerAccountId: session.account.id }),
          dependencies.listRepairRounds({ businessOrderId, viewerAccountId: session.account.id }),
          dependencies.listAuditTrail?.({ businessOrderId, viewerAccountId: session.account.id }) ?? Promise.resolve([]),
          dependencies.getAfterSalesRoundDeletionPreview?.({ businessOrderId, viewerAccountId: session.account.id }) ?? Promise.resolve(null),
        ]);
        return NextResponse.json({ current, history, auditTrail, afterSalesRoundDeletion });
      }
      const body = await request.json() as ActionBody;
      const context = apiActionContext(request, session.account.id);
      let result: unknown;
      switch (body.action) {
        case "assign": result = await dependencies.assignRound({ businessOrderId, expectedBusinessOrderVersion: Number(body.businessOrderVersion), teamId: Number(body.teamId), customerConfirmedWithoutPayment: body.customerConfirmed === true, context }); break;
        case "withdraw_assignment": result = await dependencies.withdrawAssignment({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), context }); break;
        case "cancel_after_sales": result = await dependencies.cancelAfterSalesRound({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), context }); break;
        case "delete_invalid_after_sales": {
          if (!dependencies.deleteInvalidAfterSalesRound) {
            return NextResponse.json({ error: "售后维修轮次删除功能不可用" }, { status: 503 });
          }
          result = await dependencies.deleteInvalidAfterSalesRound({
            businessOrderId,
            expectedRepairRoundVersion: Number(body.repairRoundVersion ?? body.version),
            previewFingerprint: String(body.previewFingerprint ?? ""),
            reasonCode: String(body.reasonCode ?? "") as AfterSalesRoundDeletionReasonCode,
            reasonNote: String(body.reasonNote ?? ""),
            confirmationRecordNo: String(body.confirmationRecordNo ?? ""),
            context,
          });
          break;
        }
        case "set_performance_draft": {
          if (!dependencies.setPerformanceDraft) return NextResponse.json({ error: "绩效草稿功能不可用" }, { status: 503 });
          if (typeof body.repairRoundId !== "number" || !Number.isSafeInteger(body.repairRoundId) || body.repairRoundId <= 0) {
            return NextResponse.json({ error: "绩效草稿缺少有效的目标维修轮次，请刷新后重新核对。" }, { status: 400 });
          }
          result = await dependencies.setPerformanceDraft({
            businessOrderId,
            expectedRepairRoundId: body.repairRoundId,
            expectedRepairRoundVersion: Number(body.repairRoundVersion),
            performanceValue: String(body.performanceValue ?? ""),
            context,
          });
          break;
        }
        case "record_paper_acceptance": result = await dependencies.recordAcceptanceOnBehalf({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), actualStaffMemberId: Number(body.actualStaffMemberId), context }); break;
        case "accept": {
          if (!dependencies.acceptRound) return NextResponse.json({ error: "接车功能不可用" }, { status: 503 });
          result = await dependencies.acceptRound({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), context });
          break;
        }
        case "start_after_sales": result = await dependencies.startAfterSalesRound({ businessOrderId, expectedBusinessOrderVersion: Number(body.businessOrderVersion), issue: String(body.issue ?? ""), context }); break;
        case "record_mileage": result = await dependencies.recordIntakeMileage({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), odometerKm: Number(body.odometerKm), context }); break;
        case "attach_intake_photo": {
          if (!dependencies.attachIntakePhoto) return NextResponse.json({ error: "接车照片功能不可用" }, { status: 503 });
          result = await dependencies.attachIntakePhoto({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), fileId: Number(body.fileId), context });
          break;
        }
        case "submit_return": {
          const workSummary = typeof body.workSummary === "string" && body.workSummary.trim()
            ? body.workSummary.trim()
            : undefined;
          const parsedStaffMemberId = Number(body.actualStaffMemberId);
          const actualStaffMemberId = Number.isSafeInteger(parsedStaffMemberId) && parsedStaffMemberId > 0
            ? parsedStaffMemberId
            : undefined;
          const parsed = parseReturnDetails(body);
          if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
          result = await dependencies.submitWorkReturn({
            businessOrderId,
            expectedRepairRoundVersion: Number(body.repairRoundVersion),
            workSummary,
            exceptionSummary: parsed.exceptionSummary,
            itemResults: parsed.itemResults,
            attachmentIds: parsed.attachmentIds,
            actualStaffMemberId,
            context,
          });
          break;
        }
        case "record_paper_return": {
          if (!dependencies.recordPaperWorkReturn) return NextResponse.json({ error: "纸质回单功能不可用" }, { status: 503 });
          const parsedStaffMemberId = Number(body.actualStaffMemberId);
          const actualStaffMemberId = Number.isSafeInteger(parsedStaffMemberId) && parsedStaffMemberId > 0
            ? parsedStaffMemberId
            : undefined;
          const parsed = parseReturnDetails(body);
          if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
          const workSummary = typeof body.workSummary === "string" && body.workSummary.trim()
            ? body.workSummary.trim()
            : undefined;
          result = await dependencies.recordPaperWorkReturn({
            businessOrderId,
            expectedRepairRoundVersion: Number(body.repairRoundVersion),
            actualStaffMemberId,
            attachmentIds: parsed.attachmentIds,
            workSummary,
            exceptionSummary: parsed.exceptionSummary,
            itemResults: parsed.itemResults,
            context,
          });
          break;
        }
        case "record_paper_return_and_formal_handoff": {
          if (!dependencies.recordPaperWorkReturnAndFormallyHandOff) {
            return NextResponse.json({ error: "纸质回单交单功能不可用" }, { status: 503 });
          }
          const parsedStaffMemberId = Number(body.actualStaffMemberId);
          const actualStaffMemberId = Number.isSafeInteger(parsedStaffMemberId) && parsedStaffMemberId > 0
            ? parsedStaffMemberId
            : undefined;
          const parsed = parseReturnDetails(body);
          if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
          result = await dependencies.recordPaperWorkReturnAndFormallyHandOff({
            businessOrderId,
            expectedRepairRoundVersion: Number(body.repairRoundVersion),
            actualStaffMemberId,
            attachmentIds: parsed.attachmentIds,
            workSummary: typeof body.workSummary === "string" && body.workSummary.trim() ? body.workSummary.trim() : undefined,
            exceptionSummary: parsed.exceptionSummary,
            itemResults: parsed.itemResults,
            performanceValue: String(body.performanceValue ?? ""),
            context,
          });
          break;
        }
        case "approve_return": result = await dependencies.approveWorkReturn({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), workReturnId: Number(body.workReturnId), context }); break;
        case "approve_and_formal_handoff": {
          if (!dependencies.approveAndFormallyHandOff) {
            return NextResponse.json({ error: "回单审核交单功能不可用" }, { status: 503 });
          }
          result = await dependencies.approveAndFormallyHandOff({
            businessOrderId,
            expectedRepairRoundVersion: Number(body.repairRoundVersion),
            workReturnId: Number(body.workReturnId),
            performanceValue: String(body.performanceValue ?? ""),
            context,
          });
          break;
        }
        case "reject_return": result = await dependencies.returnWorkReturn({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), workReturnId: Number(body.workReturnId), reason: String(body.reason ?? ""), context }); break;
        case "formal_handoff": result = await dependencies.formallyHandOffRound({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), performanceValue: String(body.performanceValue ?? ""), context }); break;
        case "cancel_formal_handoff": {
          const formalHandoffId = body.formalHandoffId;
          const reason = typeof body.reason === "string" ? body.reason.trim() : "";
          if (typeof formalHandoffId !== "number" || !Number.isSafeInteger(formalHandoffId) || formalHandoffId < 1 || !reason) {
            return NextResponse.json({ error: "取消正式交单内容无效" }, { status: 400 });
          }
          result = await dependencies.cancelFormalHandoffInSameMonth({
            businessOrderId,
            formalHandoffId,
            reason,
            context,
          });
          break;
        }
        case "adjust_formal_handoff_performance": {
          if (!dependencies.adjustFormalHandoffPerformanceInSameMonth) {
            return NextResponse.json({ error: "正式交单绩效调整功能不可用" }, { status: 503 });
          }
          const formalHandoffId = body.formalHandoffId;
          const repairRoundVersion = body.repairRoundVersion;
          const performanceValue = typeof body.performanceValue === "string" ? body.performanceValue.trim() : "";
          const reason = typeof body.reason === "string" ? body.reason.trim() : "";
          if (
            typeof formalHandoffId !== "number"
            || !Number.isSafeInteger(formalHandoffId)
            || formalHandoffId < 1
            || typeof repairRoundVersion !== "number"
            || !Number.isSafeInteger(repairRoundVersion)
            || repairRoundVersion < 1
            || !performanceValue
            || !reason
          ) {
            return NextResponse.json({ error: "绩效调整内容无效" }, { status: 400 });
          }
          result = await dependencies.adjustFormalHandoffPerformanceInSameMonth({
            businessOrderId,
            formalHandoffId,
            expectedRepairRoundVersion: repairRoundVersion,
            performanceValue,
            reason,
            context,
          });
          break;
        }
        default: return NextResponse.json({ error: "不支持的维修轮次操作" }, { status: 400 });
      }
      const [current, history, auditTrail, afterSalesRoundDeletion] = await Promise.all([
        dependencies.getCurrentRound({ businessOrderId, viewerAccountId: session.account.id }),
        dependencies.listRepairRounds({ businessOrderId, viewerAccountId: session.account.id }),
        dependencies.listAuditTrail?.({ businessOrderId, viewerAccountId: session.account.id }) ?? Promise.resolve([]),
        dependencies.getAfterSalesRoundDeletionPreview?.({ businessOrderId, viewerAccountId: session.account.id }) ?? Promise.resolve(null),
      ]);
      return NextResponse.json({ result, current, history, auditTrail, afterSalesRoundDeletion });
    } catch (error) {
      return businessApiError(error, "维修轮次操作失败");
    }
  };
}

async function run(request: Request, params: Promise<{ businessOrderId: string }>): Promise<Response> {
  const { businessOrderId } = await params;
  const runtime = createBusinessOrderRuntime();
  try {
    return await createBusinessOrderRoundsApiHandler({
      readSession: currentSession,
      getCurrentRound: (input) => runtime.repairRounds.getCurrentRound(input),
      listRepairRounds: (input) => runtime.repairRounds.listRepairRounds(input),
      listAuditTrail: (input) => runtime.repairRounds.listAuditTrail(input),
      getAfterSalesRoundDeletionPreview: (input) => runtime.repairRounds.getAfterSalesRoundDeletionPreview(input),
      assignRound: (input) => runtime.repairRounds.assignRound(input),
      withdrawAssignment: (input) => runtime.repairRounds.withdrawAssignment(input),
      cancelAfterSalesRound: (input) => runtime.repairRounds.cancelAfterSalesRound(input),
      deleteInvalidAfterSalesRound: (input) => runtime.repairRounds.deleteInvalidAfterSalesRound(input),
      setPerformanceDraft: (input) => runtime.repairRounds.setPerformanceDraft(input),
      recordAcceptanceOnBehalf: (input) => runtime.repairRounds.recordAcceptanceOnBehalf(input),
      acceptRound: (input) => runtime.repairRounds.acceptRound(input),
      startAfterSalesRound: (input) => runtime.repairRounds.startAfterSalesRound(input),
      recordIntakeMileage: (input) => runtime.repairRounds.recordIntakeMileage(input),
      attachIntakePhoto: (input) => runtime.repairRounds.attachIntakePhoto(input),
      submitWorkReturn: (input) => runtime.repairRounds.submitWorkReturn(input),
      recordPaperWorkReturn: (input) => runtime.repairRounds.recordPaperWorkReturn(input),
      recordPaperWorkReturnAndFormallyHandOff: (input) => runtime.repairRounds.recordPaperWorkReturnAndFormallyHandOff(input),
      approveWorkReturn: (input) => runtime.repairRounds.approveWorkReturn(input),
      approveAndFormallyHandOff: (input) => runtime.repairRounds.approveAndFormallyHandOff(input),
      returnWorkReturn: (input) => runtime.repairRounds.returnWorkReturn(input),
      formallyHandOffRound: (input) => runtime.formalHandoffs.formallyHandOffRound(input),
      cancelFormalHandoffInSameMonth: (input) => runtime.formalHandoffs.cancelFormalHandoffInSameMonth(input),
      adjustFormalHandoffPerformanceInSameMonth: (input) => runtime.formalHandoffs.adjustFormalHandoffPerformanceInSameMonth(input),
    })(request, { businessOrderId: Number(businessOrderId) });
  } finally { await runtime.close(); }
}

export async function GET(request: Request, context: { params: Promise<{ businessOrderId: string }> }) { return run(request, context.params); }
export async function POST(request: Request, context: { params: Promise<{ businessOrderId: string }> }) { return run(request, context.params); }

function parseReturnDetails(body: ActionBody):
  | { ok: true; exceptionSummary?: string; itemResults?: WorkReturnItemResult[]; attachmentIds: number[] }
  | { ok: false; error: string } {
  const attachmentValues = body.attachmentIds === undefined ? [] : body.attachmentIds;
  if (!Array.isArray(attachmentValues)) return { ok: false, error: "回单附件无效" };
  const attachmentIds = attachmentValues.map(Number);
  if (attachmentIds.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(attachmentIds).size !== attachmentIds.length) {
    return { ok: false, error: "回单附件无效" };
  }
  const exceptionSummary = typeof body.exceptionSummary === "string" && body.exceptionSummary.trim()
    ? body.exceptionSummary.trim()
    : undefined;
  if (body.itemResults !== undefined && !Array.isArray(body.itemResults)) {
    return { ok: false, error: "施工项目结果无效" };
  }
  return {
    ok: true,
    exceptionSummary,
    itemResults: body.itemResults as WorkReturnItemResult[] | undefined,
    attachmentIds,
  };
}
