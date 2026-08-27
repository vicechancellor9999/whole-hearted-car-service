import { NextResponse } from "next/server";
import { apiActionContext, businessApiError } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";

type Session = { account: { id: number } };
type Context = ReturnType<typeof apiActionContext>;

type Dependencies = {
  readSession(): Promise<Session | null>;
  getCurrentRound(input: { businessOrderId: number; viewerAccountId: number }): Promise<unknown>;
  listRepairRounds(input: { businessOrderId: number; viewerAccountId: number }): Promise<unknown>;
  listAuditTrail?(input: { businessOrderId: number; viewerAccountId: number }): Promise<unknown>;
  assignRound(input: { businessOrderId: number; expectedBusinessOrderVersion: number; teamId: number; customerConfirmedWithoutPayment: boolean; context: Context }): Promise<unknown>;
  withdrawAssignment(input: { businessOrderId: number; expectedRepairRoundVersion: number; context: Context }): Promise<unknown>;
  cancelAfterSalesRound(input: { businessOrderId: number; expectedRepairRoundVersion: number; context: Context }): Promise<unknown>;
  recordAcceptanceOnBehalf(input: { businessOrderId: number; expectedRepairRoundVersion: number; actualStaffMemberId: number; context: Context }): Promise<unknown>;
  startAfterSalesRound(input: { businessOrderId: number; expectedBusinessOrderVersion: number; issue: string; context: Context }): Promise<unknown>;
  recordIntakeMileage(input: { businessOrderId: number; expectedRepairRoundVersion: number; odometerKm: number; context: Context }): Promise<unknown>;
  submitWorkReturn(input: { businessOrderId: number; expectedRepairRoundVersion: number; workSummary?: string; actualStaffMemberId?: number; context: Context }): Promise<unknown>;
  approveWorkReturn(input: { businessOrderId: number; expectedRepairRoundVersion: number; workReturnId: number; context: Context }): Promise<unknown>;
  returnWorkReturn(input: { businessOrderId: number; expectedRepairRoundVersion: number; workReturnId: number; reason: string; context: Context }): Promise<unknown>;
  formallyHandOffRound(input: { businessOrderId: number; expectedRepairRoundVersion: number; performanceValue: string; context: Context }): Promise<unknown>;
  cancelFormalHandoffInSameMonth(input: { businessOrderId: number; formalHandoffId: number; reason: string; context: Context }): Promise<unknown>;
};

type ActionBody = Record<string, unknown> & { action?: unknown };

export function createBusinessOrderRoundsApiHandler(dependencies: Dependencies) {
  return async function handler(request: Request, params: { businessOrderId: number }): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const businessOrderId = Number(params.businessOrderId);
    try {
      if (request.method === "GET") {
        const [current, history, auditTrail] = await Promise.all([
          dependencies.getCurrentRound({ businessOrderId, viewerAccountId: session.account.id }),
          dependencies.listRepairRounds({ businessOrderId, viewerAccountId: session.account.id }),
          dependencies.listAuditTrail?.({ businessOrderId, viewerAccountId: session.account.id }) ?? Promise.resolve([]),
        ]);
        return NextResponse.json({ current, history, auditTrail });
      }
      const body = await request.json() as ActionBody;
      const context = apiActionContext(request, session.account.id);
      let result: unknown;
      switch (body.action) {
        case "assign": result = await dependencies.assignRound({ businessOrderId, expectedBusinessOrderVersion: Number(body.businessOrderVersion), teamId: Number(body.teamId), customerConfirmedWithoutPayment: body.customerConfirmed === true, context }); break;
        case "withdraw_assignment": result = await dependencies.withdrawAssignment({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), context }); break;
        case "cancel_after_sales": result = await dependencies.cancelAfterSalesRound({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), context }); break;
        case "record_paper_acceptance": result = await dependencies.recordAcceptanceOnBehalf({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), actualStaffMemberId: Number(body.actualStaffMemberId), context }); break;
        case "start_after_sales": result = await dependencies.startAfterSalesRound({ businessOrderId, expectedBusinessOrderVersion: Number(body.businessOrderVersion), issue: String(body.issue ?? ""), context }); break;
        case "record_mileage": result = await dependencies.recordIntakeMileage({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), odometerKm: Number(body.odometerKm), context }); break;
        case "submit_return": {
          const workSummary = typeof body.workSummary === "string" && body.workSummary.trim()
            ? body.workSummary.trim()
            : undefined;
          const parsedStaffMemberId = Number(body.actualStaffMemberId);
          const actualStaffMemberId = Number.isSafeInteger(parsedStaffMemberId) && parsedStaffMemberId > 0
            ? parsedStaffMemberId
            : undefined;
          result = await dependencies.submitWorkReturn({
            businessOrderId,
            expectedRepairRoundVersion: Number(body.repairRoundVersion),
            workSummary,
            actualStaffMemberId,
            context,
          });
          break;
        }
        case "approve_return": result = await dependencies.approveWorkReturn({ businessOrderId, expectedRepairRoundVersion: Number(body.repairRoundVersion), workReturnId: Number(body.workReturnId), context }); break;
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
        default: return NextResponse.json({ error: "不支持的维修轮次操作" }, { status: 400 });
      }
      const [current, history, auditTrail] = await Promise.all([
        dependencies.getCurrentRound({ businessOrderId, viewerAccountId: session.account.id }),
        dependencies.listRepairRounds({ businessOrderId, viewerAccountId: session.account.id }),
        dependencies.listAuditTrail?.({ businessOrderId, viewerAccountId: session.account.id }) ?? Promise.resolve([]),
      ]);
      return NextResponse.json({ result, current, history, auditTrail });
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
      assignRound: (input) => runtime.repairRounds.assignRound(input),
      withdrawAssignment: (input) => runtime.repairRounds.withdrawAssignment(input),
      cancelAfterSalesRound: (input) => runtime.repairRounds.cancelAfterSalesRound(input),
      recordAcceptanceOnBehalf: (input) => runtime.repairRounds.recordAcceptanceOnBehalf(input),
      startAfterSalesRound: (input) => runtime.repairRounds.startAfterSalesRound(input),
      recordIntakeMileage: (input) => runtime.repairRounds.recordIntakeMileage(input),
      submitWorkReturn: (input) => runtime.repairRounds.submitWorkReturn(input),
      approveWorkReturn: (input) => runtime.repairRounds.approveWorkReturn(input),
      returnWorkReturn: (input) => runtime.repairRounds.returnWorkReturn(input),
      formallyHandOffRound: (input) => runtime.formalHandoffs.formallyHandOffRound(input),
      cancelFormalHandoffInSameMonth: (input) => runtime.formalHandoffs.cancelFormalHandoffInSameMonth(input),
    })(request, { businessOrderId: Number(businessOrderId) });
  } finally { await runtime.close(); }
}

export async function GET(request: Request, context: { params: Promise<{ businessOrderId: string }> }) { return run(request, context.params); }
export async function POST(request: Request, context: { params: Promise<{ businessOrderId: string }> }) { return run(request, context.params); }
