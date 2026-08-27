/**
 * 客户欠账归并（2026-08-17 新 BO 口径）：欠账权威来源 = 已交单快速工单的未结余额。
 * 客户档案（v3）不存财务字段。快速工单的 customerId 即 canonical 档案客户 id（直配）；
 * 手机号精确匹配兜底（linked 库客户才有手机号字段）。
 * 原则：讨债对人不对车——账单挂在客户档案详情里，债务主体是客户；车辆档案也展示自己的账单。
 */
import type { LinkedOperationsState } from "@/lib/api/mock-orders";
import { quickOrderFinance } from "@/lib/orders/quick-order-types";
import type { CustomerRecord } from "./types";

/** 快速工单 customerId → 未结余额（仅已交单）。 */
function quickDebtById(state: LinkedOperationsState): Map<string, number> {
  const byId = new Map<string, number>();
  for (const order of state.quickOrders) {
    if (order.voidedAt !== null) continue; // 废除单不参与计算（2026-08-18 老板）
    if (order.status !== "submitted") continue;
    const finance = quickOrderFinance(order);
    if (finance.balanceJmd <= 0) continue;
    byId.set(order.customerId, (byId.get(order.customerId) ?? 0) + finance.balanceJmd);
  }
  return byId;
}

/** linked 库客户手机号 → 客户 id（兜底匹配用）。 */
function phoneOwners(state: LinkedOperationsState): Map<string, string> {
  const owners = new Map<string, string>();
  for (const linked of state.customers) {
    if (linked.phone) owners.set(linked.phone, linked.id);
  }
  return owners;
}

/** 计算每个档案客户的未结清金额（客户档案 id → JMD）。 */
export function debtByArchiveCustomer(
  state: LinkedOperationsState,
  archiveCustomers: readonly CustomerRecord[],
): Map<string, number> {
  const byId = quickDebtById(state);
  const owners = phoneOwners(state);
  const result = new Map<string, number>();
  for (const customer of archiveCustomers) {
    let total = byId.get(customer.id) ?? 0;
    for (const phone of [customer.phone, customer.whatsapp]) {
      if (!phone) continue;
      const ownerId = owners.get(phone);
      if (ownerId && ownerId !== customer.id) total += byId.get(ownerId) ?? 0;
    }
    if (total > 0) result.set(customer.id, total);
  }
  return result;
}

/** 单个客户的财务汇总：当前欠账 + 累计消费（已交单 BO 应收合计）+ 账单数。 */
export function customerFinanceSummary(
  state: LinkedOperationsState,
  customer: CustomerRecord,
): { debtJmd: number; totalSpendJmd: number; invoiceCount: number } {
  const byId = quickDebtById(state);
  const owners = phoneOwners(state);
  const linkedIds = new Set<string>([customer.id]);
  for (const phone of [customer.phone, customer.whatsapp]) {
    const ownerId = phone ? owners.get(phone) : undefined;
    if (ownerId) linkedIds.add(ownerId);
  }

  const orders = state.quickOrders.filter(
    (order) => linkedIds.has(order.customerId) && order.status === "submitted" && order.voidedAt === null,
  );

  let totalSpendJmd = 0;
  let debtJmd = 0;
  for (const order of orders) {
    const finance = quickOrderFinance(order);
    totalSpendJmd += finance.receivableJmd;
    debtJmd += Math.max(finance.balanceJmd, 0);
  }
  return { debtJmd, totalSpendJmd, invoiceCount: orders.length };
}
