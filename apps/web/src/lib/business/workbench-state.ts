/**
 * 统一业务状态计算层：所有页面（工作台、列表、详情）的派生状态从这里出。
 * 不允许组件自行拼数据或写死数字。
 *
 * 规则来源：2026-08-11 老板口述规格书 + 2026-08-16 新 BO 状态链 + 2026-08-17 对齐版。
 */
import { quickOrderFinance, quickOrderRepairOverdueDays, type QuickOrder } from "@/lib/orders/quick-order-types";
import type {
  LinkedInspectionReportFact,
  LinkedOperationsState,
  LinkedParkingCaseFact,
  LinkedVehicleFact,
} from "@/lib/api/mock-orders";
import { deriveInspectionCommunicationSummary } from "@/lib/api/mock-inspection-reports";
import type { ParkingFollowUpSnapshot } from "@/lib/api/mock-parking-followup";
import { parkingBillableDays, parkingReminderDue } from "@/lib/api/mock-parking-followup";

// ---------------------------------------------------------------------------
// 新 BO 提醒桶（8/16 口述）：待派单 → 已派单 → 维修中 → 回单待审核 → 已交单；停滞旁路
// ---------------------------------------------------------------------------

export type QuickBoReminderKey = "待派单" | "已派单" | "维修中" | "维修中超时" | "停滞" | "回单待审核";

export function quickBoReminderCounts(orders: QuickOrder[]): Record<QuickBoReminderKey, number> {
  const counts: Record<QuickBoReminderKey, number> = { 待派单: 0, 已派单: 0, 维修中: 0, 维修中超时: 0, 停滞: 0, 回单待审核: 0 };
  for (const order of orders) {
    if (order.status === "pending_assign") counts.待派单 += 1;
    else if (order.status === "assigned") counts.已派单 += 1;
    else if (order.status === "in_repair") {
      counts.维修中 += 1;
      // 超时按单反馈的预计工期算（8/18 老板：大工程工期长、小工程催得紧，不搞固定天数）
      if (quickOrderRepairOverdueDays(order) > 0) counts.维修中超时 += 1;
    } else if (order.status === "stalled") counts.停滞 += 1;
    else if (order.status === "returned") counts.回单待审核 += 1;
  }
  return counts;
}

export interface VehiclePickupReadiness {
  vehicleId: string;
  plate: string;
  ready: boolean;
  reason: string;
}

/** 车辆取车条件（新 BO）：在厂 + 至少一张 BO + 全部已交单。车没离场就没闭环（8/17）。 */
export function quickVehiclePickupReadiness(
  vehicles: LinkedVehicleFact[],
  orders: QuickOrder[],
): { readiness: VehiclePickupReadiness[]; withoutBo: VehiclePickupReadiness[] } {
  const readiness: VehiclePickupReadiness[] = [];
  const withoutBo: VehiclePickupReadiness[] = [];
  for (const vehicle of vehicles) {
    const vehicleOrders = orders.filter((order) => order.vehicleId === vehicle.id);
    if (vehicleOrders.length === 0) {
      withoutBo.push({ vehicleId: vehicle.id, plate: vehicle.plate, ready: false, reason: "在厂车辆没有业务单，请检查" });
      continue;
    }
    const unfinished = vehicleOrders.filter((order) => order.status !== "submitted");
    if (unfinished.length > 0) {
      readiness.push({ vehicleId: vehicle.id, plate: vehicle.plate, ready: false, reason: "有 " + unfinished.length + " 张未交单 Business Order" });
      continue;
    }
    readiness.push({ vehicleId: vehicle.id, plate: vehicle.plate, ready: true, reason: "全部 Business Order 已交单完结" });
  }
  return { readiness, withoutBo };
}

// ---------------------------------------------------------------------------
// 工作台提醒组（BO + Task 7 canonical IR 沟通口径）
// ---------------------------------------------------------------------------

export type QuickInvoiceBucketKey = "未付款" | "未付清" | "已付清";

export interface WorkbenchReminders {
  bo: Record<QuickBoReminderKey, number>;
  ir: { notNotified: number; awaitingReply: number };
  invoice: Record<QuickInvoiceBucketKey, number>;
  outstandingTotalJmd: number;
  outstandingCustomerCount: number;
  vehiclesReadyForPickup: number;
  vehiclesNotifiedNotPickedUp: number;
  vehiclesOvertime: number;
  parkingBillsDueToday: number;
  vehiclesWithoutBo: number;
}

export function computeWorkbenchReminders(
  orders: QuickOrder[],
  inspectionReports: LinkedInspectionReportFact[],
  vehicles: LinkedVehicleFact[],
  parkingCases: LinkedParkingCaseFact[],
  parkingFollowup: ParkingFollowUpSnapshot | null,
  communicationState: Pick<LinkedOperationsState, "communicationEvents" | "responseEvents" | "communications">,
): WorkbenchReminders {
  // 废除单：所有数据无效、不参与任何计算（2026-08-18 老板）
  const activeOrders = orders.filter((order) => order.voidedAt === null);
  const bo = quickBoReminderCounts(activeOrders);

  const ir = { notNotified: 0, awaitingReply: 0 };
  for (const report of inspectionReports) {
    const status = deriveInspectionCommunicationSummary(communicationState, report.id).communicationStatus;
    if (status === "not_notified") ir.notNotified += 1;
    else if (status === "awaiting_reply") ir.awaitingReply += 1;
  }

  // 财务桶（新 BO）：全部有金额的工单按收退款推导；挂账细分待挂账功能接入后补充
  const invoice: Record<QuickInvoiceBucketKey, number> = { 未付款: 0, 未付清: 0, 已付清: 0 };
  for (const order of activeOrders) {
    const finance = quickOrderFinance(order);
    if (finance.receivableJmd <= 0) continue;
    if (finance.status === "paid") invoice.已付清 += 1;
    else if (finance.status === "partially_paid") invoice.未付清 += 1;
    else invoice.未付款 += 1;
  }

  // 欠账（8/11+8/16 口径）：已交单 BO 的未结余额归客户
  const outstanding = new Map<string, number>();
  let outstandingTotalJmd = 0;
  for (const order of activeOrders) {
    if (order.status !== "submitted") continue;
    const finance = quickOrderFinance(order);
    if (finance.balanceJmd <= 0) continue;
    outstanding.set(order.customerId, (outstanding.get(order.customerId) ?? 0) + finance.balanceJmd);
    outstandingTotalJmd += finance.balanceJmd;
  }

  const { readiness, withoutBo } = quickVehiclePickupReadiness(vehicles, activeOrders);
  const readyVehicles = readiness.filter((r) => r.ready);

  // 已通知未取车 / 待通知取车：全部 BO 已交单；按 pickupNotice 区分
  let vehiclesNotifiedNotPickedUp = 0;
  const readyNotNotified = readyVehicles.filter((r) => {
    const vehicleOrders = activeOrders.filter((o) => o.vehicleId === r.vehicleId);
    const unnotified = vehicleOrders.filter((o) => !o.pickupNotice);
    if (unnotified.length > 0) return true;
    vehiclesNotifiedNotPickedUp += 1;
    return false;
  });

  const vehiclesOvertime = parkingCases.filter((c) => !c.pickupDate && parkingBillableDays(c.notificationDate) > 0).length;
  const parkingBillsDueToday = parkingCases.filter((c) => !c.pickupDate && parkingReminderDue(c.notificationDate)).length;

  return {
    bo,
    ir,
    invoice,
    outstandingTotalJmd,
    outstandingCustomerCount: outstanding.size,
    vehiclesReadyForPickup: readyNotNotified.length,
    vehiclesNotifiedNotPickedUp,
    vehiclesOvertime,
    parkingBillsDueToday,
    vehiclesWithoutBo: withoutBo.length,
  };
}
