import { NextResponse } from "next/server";
import { businessApiError, positiveRouteId } from "@formal/app/api/business-orders/api-helpers";
import { currentSession } from "@formal/modules/auth/current-session";
import type { AccountRole } from "@formal/modules/auth/auth-service";
import { createBusinessOrderRuntime } from "@formal/modules/business-order/business-order-runtime";
import { createMasterDataRuntime } from "@formal/modules/master-data/master-data-runtime";
import { hasPermission, type Permission } from "@formal/modules/permissions/permissions";

type BusinessOrderSession = {
  account: {
    id: number;
    role: AccountRole;
    delegatedPermissions: Permission[];
  };
};
type RouteContext = { params: Promise<{ businessOrderId: string }> };
type ReadInput = { businessOrderId: number; viewerAccountId: number };

type BusinessOrderDetailApiDependencies = {
  readSession(): Promise<BusinessOrderSession | null>;
  getOrder(input: ReadInput): Promise<unknown>;
  getCharges(input: ReadInput): Promise<unknown>;
  getLedger(input: ReadInput): Promise<unknown>;
  listDocuments(input: ReadInput): Promise<unknown>;
  listPaymentMethods(input: { viewerAccountId: number }): Promise<unknown>;
  listChargeUnits(input: { viewerAccountId: number }): Promise<unknown>;
  getRefund(input: { refundId: number; viewerAccountId: number }): Promise<unknown>;
  countUnreadMentions(input: { accountId: number }): Promise<number>;
};

export function createBusinessOrderDetailApiHandler(
  dependencies: BusinessOrderDetailApiDependencies,
) {
  return async function businessOrderDetailApiHandler(context: RouteContext): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const businessOrderId = positiveRouteId((await context.params).businessOrderId);
    if (!businessOrderId) {
      return NextResponse.json({ error: "Business Order 编号无效" }, { status: 400 });
    }
    const input = { businessOrderId, viewerAccountId: session.account.id };
    try {
      const [order, charges, ledger, documents, paymentMethods, chargeUnits, unreadMentionCount] = await Promise.all([
        dependencies.getOrder(input),
        dependencies.getCharges(input),
        dependencies.getLedger(input),
        dependencies.listDocuments(input),
        dependencies.listPaymentMethods({ viewerAccountId: session.account.id }),
        dependencies.listChargeUnits({ viewerAccountId: session.account.id }),
        dependencies.countUnreadMentions({ accountId: session.account.id }),
      ]);
      const refundTransactions = (ledger as {
        transactions?: Array<{ type: string; id: number }>;
      }).transactions?.filter((transaction) => transaction.type === "refund") ?? [];
      const refunds = await Promise.all(refundTransactions.map((transaction) => (
        dependencies.getRefund({
          refundId: transaction.id,
          viewerAccountId: session.account.id,
        })
      )));
      const delegated = session.account.delegatedPermissions;
      return NextResponse.json({
        order,
        charges,
        ledger,
        refunds,
        documents,
        paymentMethods,
        chargeUnits,
        currentAccountId: session.account.id,
        unreadMentionCount,
        capabilities: {
          canWrite: hasPermission(session.account.role, "business_order.write", delegated),
          canRecordPayment: hasPermission(session.account.role, "business_order.write", delegated),
          canRefund: hasPermission(session.account.role, "sensitive_operations.execute", delegated),
          canCollaborate: hasPermission(session.account.role, "business_order.collaborate", delegated),
        },
      });
    } catch (error) {
      return businessApiError(error, "Business Order 详情读取失败");
    }
  };
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const runtime = createBusinessOrderRuntime();
  const masterRuntime = createMasterDataRuntime();
  try {
    return await createBusinessOrderDetailApiHandler({
      readSession: currentSession,
      getOrder: (input) => runtime.service.getBusinessOrder(input),
      getCharges: (input) => runtime.service.getCurrentCharges(input),
      getLedger: (input) => runtime.payments.getBusinessOrderLedger(input),
      listDocuments: (input) => runtime.documents.listForBusinessOrder(input),
      countUnreadMentions: (input) => runtime.collaboration.countUnreadMentions(input),
      getRefund: (input) => runtime.payments.getRefund(input),
      listPaymentMethods: ({ viewerAccountId }) => masterRuntime.service.listDictionaryItems({
        viewerAccountId,
        category: "payment_method",
        activeOnly: true,
      }),
      listChargeUnits: ({ viewerAccountId }) => masterRuntime.service.listDictionaryItems({
        viewerAccountId,
        category: "charge_unit",
        activeOnly: true,
      }),
    })(context);
  } finally {
    await Promise.all([runtime.close(), masterRuntime.close()]);
  }
}
