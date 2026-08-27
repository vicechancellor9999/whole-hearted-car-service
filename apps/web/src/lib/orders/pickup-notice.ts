/**
 * 取车通知文案起草（Mock AI，§9.1）。
 * 永远产出中英两版；前台自选发送版本并可自由编辑。
 * 内容包括：车辆状态、已完成服务概述、未付账单金额、最迟取车日期。
 * 最迟取车日期默认 = 通知次日（宽限期最后一天 D+1），D+2 起收停车费。
 */
import { businessDateInJamaica } from "./document-number";
import { quickOrderCanonicalChargeLines, quickOrderFinance, type QuickOrder } from "./quick-order-types";
import { formatJMDFull } from "../utils";
import type { CustomerVehicleWorkspaceResponse } from "../customers/types";

export interface PickupNoticeDraftInput {
  readonly customer: CustomerVehicleWorkspaceResponse["customers"][number] | null;
  readonly vehicle: CustomerVehicleWorkspaceResponse["vehicles"][number] | null;
  readonly order: Pick<QuickOrder, "businessOrderNo" | "items" | "chargeContract" | "chargeLines" | "payments" | "refunds" | "laborDiscountJmd" | "partsDiscountJmd">;
  readonly now: Date;
}

/** 通知日 D（今天，Jamaica 业务日）与最迟取车日 D+1。 */
export function pickupDeadline(now: Date): { businessDate: string; deadlineDate: string } {
  const businessDate = businessDateInJamaica(now);
  const year = Number(businessDate.slice(0, 4));
  const month = Number(businessDate.slice(4, 6));
  const day = Number(businessDate.slice(6, 8));
  const deadline = new Date(Date.UTC(year, month - 1, day + 1));
  const deadlineParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(deadline);
  const part = (type: Intl.DateTimeFormatPartTypes) => deadlineParts.find((p) => p.type === type)?.value ?? "";
  return { businessDate, deadlineDate: `${part("year")}${part("month")}${part("day")}` };
}

export interface PickupNoticeDrafts {
  readonly zh: string;
  readonly en: string;
  readonly deadlineDate: string;
}

export function draftPickupNoticeTexts(input: PickupNoticeDraftInput): PickupNoticeDrafts {
  const { deadlineDate } = pickupDeadline(input.now);
  const finance = quickOrderFinance(input.order);
  const vehicleLabel = input.vehicle
    ? `${input.vehicle.makeZh ?? input.vehicle.make} ${input.vehicle.modelZh ?? input.vehicle.model} · 车牌 ${input.vehicle.plate}`
    : input.order.businessOrderNo;
  const customerNameZh = input.customer
    ? (input.customer.nameZh ?? input.customer.organizationName ?? input.customer.nameEn ?? "客户")
    : "客户";
  const customerNameEn = input.customer
    ? (input.customer.nameEn ?? input.customer.organizationName ?? input.customer.nameZh ?? "customer")
    : "customer";
  const vehicleLabelEn = input.vehicle
    ? `${input.vehicle.make} ${input.vehicle.model} · Plate ${input.vehicle.plate}`
    : input.order.businessOrderNo;
  const completedLines = quickOrderCanonicalChargeLines(input.order)
    .filter((line) => line.pricingMode === "fixed_total" || !line.pendingQuote);
  const servicesZh = completedLines.map((line) => line.descZh).join("、") || "已完成服务";
  const servicesEn = completedLines.map((line) => line.descEn).filter(Boolean).join(", ") || "Completed services";
  const balanceZh = finance.balanceJmd > 0 ? `，未付账单金额 ${formatJMDFull(finance.balanceJmd)}` : "，账单已结清";
  const balanceEn = finance.balanceJmd > 0 ? `, outstanding balance ${formatJMDFull(finance.balanceJmd)}` : ", your bill is fully settled";
  const deadlineZh = `${deadlineDate.slice(0, 4)}年${Number(deadlineDate.slice(4, 6))}月${Number(deadlineDate.slice(6, 8))}日`;
  const deadlineEn = deadlineDate;
  const zh = [
    `${customerNameZh} 您好，`,
    `您的爱车（${vehicleLabel}）已维修完成，可以取车。`,
    `已完成服务：${servicesZh}${balanceZh}。`,
    `请最迟于 ${deadlineZh} 到店取车；逾期未取将按每天 JMD 2,500 收取停车费。`,
    "Whole Hearted Car Service Ltd. · Kingston",
  ].join("\n");
  const en = [
    `Dear ${customerNameEn},`,
    `Your vehicle (${vehicleLabelEn}) is ready for collection. We have completed: ${servicesEn}${balanceEn}.`,
    `Please collect your vehicle by ${deadlineEn}; a parking fee of JMD 2,500 per day applies after that date.`,
    "Whole Hearted Car Service Ltd. · Kingston",
  ].join("\n");
  return { zh, en, deadlineDate };
}
