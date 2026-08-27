/** 干净的 BO 演示种子：只保留当前收费、Invoice、独立收退款与停车闭环。 */
import type { QuickOrder, QuickOrderChargeLine } from "./quick-order-types";


export function seedQuickOrders(): QuickOrder[] {
  const unit = (
    id: string,
    category: "labor" | "parts",
    descZh: string,
    descEn: string,
    quantity: number,
    unitPriceJmd: number,
    pendingQuote = false,
    unitDiscountJmd = 0,
  ): QuickOrderChargeLine => ({
    id,
    category,
    pricingMode: "unit",
    descZh,
    descEn,
    remarkZh: "",
    remarkEn: "",
    unit: category === "labor" ? "工时" : "个",
    unitEn: category === "labor" ? "hour" : "item",
    quantity,
    unitPriceJmd,
    unitDiscountJmd,
    pendingQuote,
  });
  const fixed = (
    id: string,
    descZh: string,
    descEn: string,
    amountJmd: number,
  ): QuickOrderChargeLine => ({
    id,
    category: "other_service",
    pricingMode: "fixed_total",
    code: "other",
    descZh,
    descEn,
    remarkZh: "",
    remarkEn: "",
    amountJmd,
  });
  const cleanSpecs: ReadonlyArray<Readonly<{
    id: string;
    businessOrderNo: string;
    customerId: string;
    vehicleId: string;
    rawInput: string;
    createdAt: string;
    lines: ReadonlyArray<QuickOrderChargeLine>;
  }>> = [
    {
      id: "demo-v2-provisional",
      businessOrderNo: "KGN-WH-2026072000001",
      customerId: "CUST-BULK-003",
      vehicleId: "VEH-BULK-003",
      rawInput: "新收费结构演示：工时、配件待报价和固定一口价服务",
      createdAt: "2026-07-20T09:00:00-05:00",
      lines: [
        unit("demo-v2-provisional-labor", "labor", "发动机诊断工时", "Engine diagnosis labor", 2, 10_000),
        unit("demo-v2-provisional-parts", "parts", "待确认发动机脚", "Pending engine mount", 1, 0, true),
        fixed("demo-v2-provisional-fixed", "拖车服务一口价", "Fixed towing service", 7_500),
      ],
    },
    {
      id: "demo-v2-partial",
      businessOrderNo: "KGN-WH-2026072000002",
      customerId: "CUST-UAT-001",
      vehicleId: "VEH-UAT-001",
      rawInput: "正式 Invoice 分两笔独立收款演示",
      createdAt: "2026-07-20T09:10:00-05:00",
      lines: [
        unit("demo-v2-partial-labor", "labor", "刹车检修工时", "Brake service labor", 1, 10_000),
        unit("demo-v2-partial-parts", "parts", "前刹车片", "Front brake pads", 1, 7_500),
      ],
    },
    {
      id: "demo-v2-refunds",
      businessOrderNo: "KGN-WH-2026072000003",
      customerId: "CUST-UAT-001",
      vehicleId: "VEH-UAT-001",
      rawInput: "两笔独立退款演示：一笔只冲减应收，一笔退回现金；随后重开 Invoice V2",
      createdAt: "2026-07-20T09:20:00-05:00",
      lines: [
        unit("demo-v2-refunds-labor", "labor", "电路诊断工时", "Electrical diagnosis labor", 2, 10_000, false, 2_000),
        fixed("demo-v2-refunds-fixed", "外出救援服务", "Off-site assistance", 5_000),
      ],
    },
    {
      id: "demo-v2-parking",
      businessOrderNo: "KGN-WH-2026072000004",
      customerId: "CUST-UAT-001",
      vehicleId: "VEH-UAT-001",
      rawInput: "停车 claim、Invoice 投影与停车更正演示",
      createdAt: "2026-07-20T09:30:00-05:00",
      lines: [
        unit("demo-v2-parking-labor", "labor", "交车前检查工时", "Pre-release inspection labor", 1, 12_000),
      ],
    },
    {
      id: "demo-v2-parking-unclaimed",
      businessOrderNo: "KGN-WH-2026072000005",
      customerId: "CUST-BULK-002",
      vehicleId: "VEH-BULK-002",
      rawInput: "未认领停车 claim 演示",
      createdAt: "2026-07-20T09:40:00-05:00",
      lines: [
        unit("demo-v2-parking-unclaimed-labor", "labor", "取车前安全检查", "Pre-pickup safety inspection", 1, 9_000),
      ],
    },
  ];
  const cleanOrders = cleanSpecs.map((spec): QuickOrder => {
    return {
      id: spec.id,
      businessOrderNo: spec.businessOrderNo,
      customerId: spec.customerId,
      vehicleId: spec.vehicleId,
      createdAt: spec.createdAt,
      createdBy: "超级管理员",
      rawInput: spec.rawInput,
      noteZh: null,
      noteEn: null,
      editHistory: [],
      orderKind: "normal",
      linkedOrderId: null,
      items: [],
      chargeContract: "shared_v1",
      chargeLines: spec.lines,
      statusHistory: [{
        id: `${spec.id}-ev-1`,
        from: null,
        to: "pending_assign" as const,
        by: "超级管理员",
        byRole: "frontdesk" as const,
        at: spec.createdAt,
      }],
      status: "pending_assign",
      teamId: null,
      assignedAt: null,
      mechanicName: null,
      acceptedAt: null,
      returnedAt: null,
      submittedAt: null,
      submittedBy: null,
      startMileageKm: null,
      startMileageRecordedAt: null,
      startMileageRecordedBy: null,
      stallReason: null,
      performanceValueJmd: spec.lines.reduce((total, line) => (
        line.pricingMode === "unit" && line.category === "labor" && !line.pendingQuote
          ? total + line.quantity * line.unitPriceJmd
          : total
      ), 0),
      performanceAdjusts: [],
      laborDiscountJmd: 0,
      partsDiscountJmd: 0,
      payments: [],
      refunds: [],
      invoiceSignature: null,
      pickupNotice: null,
      pickedUpAt: null,
      pickedUpBy: null,
      paidInFullAt: null,
      paidInFullBy: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      etaDays: null,
    };
  });
  return cleanOrders;
}
