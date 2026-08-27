import {
  ORDER_TEAMS,
  type OrderFinancials,
  type OrderLifecycle,
  type OrderListItem,
  type OrderProcessingStatus,
  type OrderRecord,
} from "./types";

export const SETTLEMENT_TOLERANCE_JMD = 0.005;

export function deriveProcessingStatus(order: OrderRecord): OrderProcessingStatus {
  // 2026-08-11 老板口述：交单即业务单完结；取车归车辆/停车流程，不推进 BO 状态
  if (order.submittedAt) return "submitted_awaiting_collection";
  if (order.returnedAt) return "returned_awaiting_frontdesk";
  if (order.acceptedAt) return "in_progress";
  if (order.teamId) return "awaiting_acceptance";
  return "awaiting_dispatch";
}

export function deriveOrderFinancials(order: OrderRecord): OrderFinancials {
  const laborJmd = order.laborItems.reduce((total, item) => total + item.amountJmd, 0);
  const partsJmd = order.partItems.reduce((total, item) => total + item.amountJmd, 0);
  const paymentJmd = order.payments.reduce((total, payment) => total + payment.amountJmd, 0);
  const refundJmd = order.refunds.reduce((total, refund) => total + refund.amountJmd, 0);
  const receivableJmd = laborJmd + partsJmd + order.parkingFeeJmd;
  const netPaidJmd = paymentJmd - refundJmd;
  const balanceJmd = receivableJmd - netPaidJmd;
  const withinTolerance = Math.abs(balanceJmd) <= SETTLEMENT_TOLERANCE_JMD;

  return {
    receivableJmd,
    netPaidJmd,
    balanceJmd,
    settlementStatus: withinTolerance ? "settled" : balanceJmd > 0 ? "due" : "overpaid",
  };
}

export function deriveOrderLifecycle(order: OrderRecord): OrderLifecycle {
  // 2026-08-11 老板口述：交单即业务单完结；账款是否结清是 Invoice 的事，不影响 BO 生命周期
  return order.submittedAt ? "completed" : "open";
}

export function toOrderListItem(order: OrderRecord): OrderListItem {
  const team = order.teamId
    ? ORDER_TEAMS.find((candidate) => candidate.id === order.teamId)
    : undefined;

  return {
    id: order.id,
    orderNo: order.orderNo,
    customer: {
      nameZh: order.customer.nameZh,
      ...(order.customer.nameEn ? { nameEn: order.customer.nameEn } : {}),
      phone: order.customer.phone,
    },
    vehicle: {
      plate: order.vehicle.plate,
      ...(order.vehicle.modelZh ? { modelZh: order.vehicle.modelZh } : {}),
      ...(order.vehicle.modelEn ? { modelEn: order.vehicle.modelEn } : {}),
    },
    projectNames: [...new Set([
      ...order.laborItems.map((item) => item.name),
      ...order.partItems.map((item) => item.name),
    ])],
    laborItemCount: order.laborItems.length,
    partItemCount: order.partItems.length,
    processingStatus: deriveProcessingStatus(order),
    lifecycle: deriveOrderLifecycle(order),
    ...(order.sourceInspection ? {
      sourceInspection: Object.freeze({
        reportNo: order.sourceInspection.reportNo,
        version: order.sourceInspection.version,
        inspectorTeamId: order.sourceInspection.inspectorTeamId,
      }),
    } : {}),
    ...(team ? { teamId: team.id, teamName: team.name } : {}),
    mechanicNames: order.mechanics.map((mechanic) => mechanic.name),
    ...deriveOrderFinancials(order),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    updatedBy: order.updatedBy,
    contactPhone: order.customer.phone,
  };
}
