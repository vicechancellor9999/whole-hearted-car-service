import { expect, test } from "@playwright/test";
import { api } from "../../src/lib/api/client";
import { previewOrdinaryLineRefund } from "../../src/lib/billing/refunds";

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function installBrowser(session: unknown): () => void {
  const values = new Map<string, string>();
  if (session !== null) values.set("wh_session", JSON.stringify(session));
  const storage: MemoryStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  };
}

const superadmin = { identity: { id: "emp-001", role: "superadmin", name: "LiJian" } };

test("收费项目单位：缺省按类别补默认，显式单位保留", async () => {
  const restore = installBrowser(superadmin);
  try {
    const created = await api.quickOrders.create({
      customerId: "CUST-UAT-001",
      vehicleId: "VEH-UAT-001",
      rawInput: "单位测试",
      items: [
        { descZh: "工时项", descEn: "Labor", category: "labor", unitPriceJmd: 1_000, quantity: 1, pendingQuote: false },
        { descZh: "清洗剂", descEn: "Cleaner", category: "parts", unitPriceJmd: 500, quantity: 8, pendingQuote: false, unit: "瓶" },
      ],
    });
    expect(created.items[0].unit).toBe("工时");
    expect(created.items[1].unit).toBe("瓶");
  } finally {
    restore();
  }
});


test("打折：减免只减应收（净额口径），绩效默认按打折前工时；超额减免被拒（8/18 老板）", async () => {
  const restore = installBrowser(superadmin);
  try {
    const created = await api.quickOrders.create({
      customerId: "CUST-UAT-001",
      vehicleId: "VEH-UAT-001",
      rawInput: "打折测试",
      items: [
        { descZh: "发动机大修工时", descEn: "Engine overhaul labor", category: "labor", unitPriceJmd: 300_000, quantity: 1, pendingQuote: false },
      ],
      laborDiscountJmd: 100_000,
    });
    const detail = await api.quickOrders.detail(created.id);
    expect(detail.laborDiscountJmd).toBe(100_000);
    expect(detail.performanceValueJmd).toBe(300_000); // 绩效按打折前工时
    const { quickOrderFinance } = await import("../../src/lib/orders/quick-order-types");
    const finance = quickOrderFinance(detail);
    expect(finance.receivableJmd).toBe(200_000); // 应收 = 30万 − 10万
    expect(finance.laborDiscountJmd).toBe(100_000); // 工时优惠独立口径
    expect(finance.partsDiscountJmd).toBe(0); // 配件优惠独立口径

    // 超额减免被拒
    await expect(api.quickOrders.update(created.id, {
      rawInput: "超额减免",
      items: [
        { descZh: "发动机大修工时", descEn: "Engine overhaul labor", category: "labor", unitPriceJmd: 100, quantity: 1, pendingQuote: false },
      ],
      laborDiscountJmd: 200,
    })).rejects.toThrow(/工时优惠不能超过工时合计/);
  } finally {
    restore();
  }
});

test("ordinary unit refund separates receivable reduction from cash for unpaid/partial/paid/overpaid", () => {
  const preview = (netPaidBeforeJmd: number) => previewOrdinaryLineRefund({
    line: {
      pricingMode: "unit",
      chargeLineId: "labor-refund-1",
      category: "labor",
      descZh: "工时",
      descEn: "Labor",
      remarkZh: "",
      remarkEn: "",
      unit: "工时",
      unitEn: "labor hour",
      quantity: 1,
      unitPriceJmd: 10_000,
      unitDiscountJmd: 6_000,
      finalUnitPriceJmd: 4_000,
      finalLineJmd: 4_000,
    },
    refundQuantity: 1,
    receivableBeforeRefundJmd: 10_000,
    netPaidBeforeJmd,
    remainingInvoiceCreditJmd: 10_000,
    priorRefunds: [],
    legacyOccupancies: [],
  });

  expect(preview(0)).toMatchObject({ requestedLineCreditJmd: 4_000, receivableReductionJmd: 4_000, cashRefundJmd: 0 });
  expect(preview(3_000)).toMatchObject({ receivableReductionJmd: 4_000, cashRefundJmd: 0 });
  expect(preview(8_000)).toMatchObject({ receivableReductionJmd: 4_000, cashRefundJmd: 2_000 });
  expect(preview(10_000)).toMatchObject({ receivableReductionJmd: 4_000, cashRefundJmd: 4_000 });
  expect(preview(12_000)).toMatchObject({ receivableReductionJmd: 4_000, cashRefundJmd: 4_000 });
});

test("unit refund applies each approved line/Invoice/receivable ceiling without exceeding it", () => {
  const line = {
    pricingMode: "unit" as const,
    chargeLineId: "labor-ceilings",
    category: "labor" as const,
    descZh: "工时",
    descEn: "Labor",
    remarkZh: "",
    remarkEn: "",
    unit: "工时",
    unitEn: "labor hour",
    quantity: 2,
    unitPriceJmd: 10_000,
    unitDiscountJmd: 6_000,
    finalUnitPriceJmd: 4_000,
    finalLineJmd: 8_000,
  };
  const base = {
    line,
    refundQuantity: 1,
    receivableBeforeRefundJmd: 10_000,
    netPaidBeforeJmd: 10_000,
    remainingInvoiceCreditJmd: 10_000,
    priorRefunds: [],
    legacyOccupancies: [],
  };
  expect(previewOrdinaryLineRefund({ ...base, remainingInvoiceCreditJmd: 2_500 }))
    .toMatchObject({ receivableReductionJmd: 2_500, cashRefundJmd: 2_500 });
  expect(previewOrdinaryLineRefund({ ...base, receivableBeforeRefundJmd: 1_500 }))
    .toMatchObject({ receivableReductionJmd: 1_500, cashRefundJmd: 1_500 });
  expect(previewOrdinaryLineRefund({
    ...base,
    remainingLineCreditJmd: 1_000,
  })).toMatchObject({ receivableReductionJmd: 1_000, cashRefundJmd: 1_000 });
});

test("ordinary fixed refund is whole-line only and any prior one-JMD occupancy freezes it", () => {
  const base = {
    line: {
      pricingMode: "fixed_total" as const,
      chargeLineId: "fixed-refund-1",
      category: "other_service" as const,
      code: "towing" as const,
      descZh: "拖车",
      descEn: "Towing",
      remarkZh: "",
      remarkEn: "",
      amountJmd: 7_500,
    },
    wholeLine: true as const,
    receivableBeforeRefundJmd: 17_500,
    netPaidBeforeJmd: 12_000,
    remainingInvoiceCreditJmd: 17_500,
    remainingLineCreditJmd: 7_500,
    priorRefunds: [],
    legacyOccupancies: [],
  };
  expect(previewOrdinaryLineRefund(base)).toEqual(expect.objectContaining({
    requestedLineCreditJmd: 7_500,
    receivableReductionJmd: 7_500,
    cashRefundJmd: 2_000,
  }));
  expect(() => previewOrdinaryLineRefund({ ...base, wholeLine: false as never })).toThrow(/whole|整行/i);
  expect(() => previewOrdinaryLineRefund({
    ...base,
    legacyOccupancies: [{ chargeLineId: "fixed-refund-1", amountJmd: 1, quantityUnknown: true }],
  })).toThrow(/occupancy|occupied|占用|冻结/i);
  expect(() => previewOrdinaryLineRefund({ ...base, remainingInvoiceCreditJmd: 7_499 })).toThrow(/full|完整|ceiling|上限/i);
  expect(() => previewOrdinaryLineRefund({ ...base, receivableBeforeRefundJmd: 7_499 })).toThrow(/full|完整|receivable|应收/i);
});

test("unassigned legacy occupancy blocks every ordinary line refund and parking is never eligible", () => {
  const unitLine = {
    pricingMode: "unit" as const,
    chargeLineId: "labor-refund-2",
    category: "labor" as const,
    descZh: "工时",
    descEn: "Labor",
    remarkZh: "",
    remarkEn: "",
    unit: "工时",
    unitEn: "labor hour",
    quantity: 2,
    unitPriceJmd: 10_000,
    unitDiscountJmd: 0,
    finalUnitPriceJmd: 10_000,
    finalLineJmd: 20_000,
  };
  const base = {
    line: unitLine,
    refundQuantity: 1,
    receivableBeforeRefundJmd: 20_000,
    netPaidBeforeJmd: 20_000,
    remainingInvoiceCreditJmd: 20_000,
    priorRefunds: [],
    legacyOccupancies: [],
  };
  expect(() => previewOrdinaryLineRefund({ ...base, legacyUnassignedOccupancyJmd: 1 }))
    .toThrow(/unassigned|未归属|reconciliation|核对/i);
  expect(() => previewOrdinaryLineRefund({ ...base, refundQuantity: 0 })).toThrow(/positive|正整数/i);
  expect(() => previewOrdinaryLineRefund({ ...base, refundQuantity: 1.5 })).toThrow(/positive|正整数/i);
  expect(() => previewOrdinaryLineRefund({ ...base, refundQuantity: 3 })).toThrow(/quantity|数量|exceed|超过/i);

  expect(() => previewOrdinaryLineRefund({
    ...base,
    line: {
      pricingMode: "parking_projection",
      chargeLineId: "parking-refund-1",
      category: "other_service",
      code: "parking_overtime",
      descZh: "停车超时费",
      descEn: "Parking overtime",
      remarkZh: "",
      remarkEn: "",
      parkingCaseId: "PARK-REFUND",
      sourceRevision: 1,
      asOf: "2026-08-21T12:00:00-05:00",
      amountJmd: 2_500,
    },
  })).toThrow(/parking|停车/i);
});

test("unit refund occupancy is cumulative across versions and uses stored final unit price", () => {
  const line = {
    pricingMode: "unit" as const,
    chargeLineId: "parts-stable",
    category: "parts" as const,
    descZh: "配件",
    descEn: "Part",
    remarkZh: "",
    remarkEn: "",
    unit: "个",
    unitEn: "piece",
    quantity: 3,
    unitPriceJmd: 10_000,
    unitDiscountJmd: 2_000,
    finalUnitPriceJmd: 8_000,
    finalLineJmd: 24_000,
  };
  const base = {
    line,
    refundQuantity: 1,
    receivableBeforeRefundJmd: 24_000,
    netPaidBeforeJmd: 24_000,
    remainingInvoiceCreditJmd: 24_000,
    priorRefunds: [{ chargeLineId: "parts-stable", quantity: 2, receivableReductionJmd: 16_000 }],
    legacyOccupancies: [],
  };
  expect(previewOrdinaryLineRefund(base)).toMatchObject({ requestedLineCreditJmd: 8_000, cashRefundJmd: 8_000 });
  expect(() => previewOrdinaryLineRefund({ ...base, refundQuantity: 2 })).toThrow(/quantity|数量|exceed|超过/i);
  expect(() => previewOrdinaryLineRefund({
    ...base,
    priorRefunds: [],
    legacyOccupancies: [{ chargeLineId: "parts-stable", amountJmd: 8_000, quantityUnknown: true }],
  })).toThrow(/quantity|unknown|未知|reconciliation|核对/i);

  expect(previewOrdinaryLineRefund({
    ...base,
    priorRefunds: [],
    legacyOccupancies: [{
      chargeLineId: "parts-stable",
      amountJmd: 8_000,
      quantityUnknown: false,
      quantity: 1,
    }],
    refundQuantity: 2,
  })).toMatchObject({ requestedLineCreditJmd: 16_000, receivableReductionJmd: 16_000 });
});

test("V1 legacy occupancy keeps its original amount while V2 computes only the remaining current value", () => {
  const line = {
    pricingMode: "unit" as const,
    chargeLineId: "parts-stable",
    category: "parts" as const,
    descZh: "配件",
    descEn: "Part",
    remarkZh: "",
    remarkEn: "",
    unit: "个",
    unitEn: "piece",
    quantity: 2,
    unitPriceJmd: 5_000,
    unitDiscountJmd: 0,
    finalUnitPriceJmd: 5_000,
    finalLineJmd: 10_000,
  };
  const base = {
    line,
    refundQuantity: 1,
    receivableBeforeRefundJmd: 10_000,
    netPaidBeforeJmd: 10_000,
    remainingInvoiceCreditJmd: 10_000,
    priorRefunds: [],
    legacyOccupancies: [],
  };
  expect(previewOrdinaryLineRefund({
    ...base,
    legacyOccupancies: [{
      chargeLineId: "parts-stable",
      amountJmd: 8_000,
      quantityUnknown: false,
      quantity: 1,
    }],
  })).toMatchObject({
    requestedLineCreditJmd: 5_000,
    receivableReductionJmd: 2_000,
    cashRefundJmd: 2_000,
  });
});

test("V1 modern refund keeps its original amount while V2 computes only the remaining current value", () => {
  const line = {
    pricingMode: "unit" as const,
    chargeLineId: "parts-stable",
    category: "parts" as const,
    descZh: "配件",
    descEn: "Part",
    remarkZh: "",
    remarkEn: "",
    unit: "个",
    unitEn: "piece",
    quantity: 2,
    unitPriceJmd: 5_000,
    unitDiscountJmd: 0,
    finalUnitPriceJmd: 5_000,
    finalLineJmd: 10_000,
  };
  const base = {
    line,
    refundQuantity: 1,
    receivableBeforeRefundJmd: 10_000,
    netPaidBeforeJmd: 10_000,
    remainingInvoiceCreditJmd: 10_000,
    priorRefunds: [],
    legacyOccupancies: [],
  };
  expect(previewOrdinaryLineRefund({
    ...base,
    priorRefunds: [{ chargeLineId: "parts-stable", quantity: 1, receivableReductionJmd: 8_000 }],
  })).toMatchObject({
    requestedLineCreditJmd: 5_000,
    receivableReductionJmd: 2_000,
    cashRefundJmd: 2_000,
  });
});

test("fixed-total modern one-JMD reduction and every full-line ceiling reject instead of partial refund", () => {
  const base = {
    line: {
      pricingMode: "fixed_total" as const,
      chargeLineId: "fixed-hard-ceiling",
      category: "other_service" as const,
      code: "other" as const,
      descZh: "特殊服务",
      descEn: "Special service",
      remarkZh: "",
      remarkEn: "",
      amountJmd: 7_500,
    },
    wholeLine: true as const,
    receivableBeforeRefundJmd: 17_500,
    netPaidBeforeJmd: 12_000,
    remainingInvoiceCreditJmd: 17_500,
    remainingLineCreditJmd: 7_500,
    priorRefunds: [],
    legacyOccupancies: [],
  };
  expect(() => previewOrdinaryLineRefund({
    ...base,
    priorRefunds: [{ chargeLineId: "fixed-hard-ceiling", receivableReductionJmd: 1 }],
  })).toThrow(/frozen|existing|既有|退款/i);
  expect(() => previewOrdinaryLineRefund({ ...base, remainingInvoiceCreditJmd: 7_499 }))
    .toThrow(/full|完整|ceiling|上限/i);
  expect(() => previewOrdinaryLineRefund({ ...base, receivableBeforeRefundJmd: 7_499 }))
    .toThrow(/full|完整|ceiling|应收/i);
});

test("fixed-total lineage freezes when a matching modern refund fact exists even at zero JMD", () => {
  const base = {
    line: {
      pricingMode: "fixed_total" as const,
      chargeLineId: "fixed-zero-modern",
      category: "other_service" as const,
      code: "other" as const,
      descZh: "特殊服务",
      descEn: "Special service",
      remarkZh: "",
      remarkEn: "",
      amountJmd: 7_500,
    },
    wholeLine: true as const,
    receivableBeforeRefundJmd: 17_500,
    netPaidBeforeJmd: 12_000,
    remainingInvoiceCreditJmd: 17_500,
    remainingLineCreditJmd: 7_500,
    priorRefunds: [{ chargeLineId: "fixed-zero-modern", receivableReductionJmd: 0 }],
    legacyOccupancies: [],
  };
  expect(() => previewOrdinaryLineRefund(base)).toThrow(/frozen|existing|fact|既有|退款/i);
});

test("fixed-total lineage freezes when a matching legacy occupancy fact exists even at zero JMD", () => {
  const base = {
    line: {
      pricingMode: "fixed_total" as const,
      chargeLineId: "fixed-zero-legacy",
      category: "other_service" as const,
      code: "other" as const,
      descZh: "特殊服务",
      descEn: "Special service",
      remarkZh: "",
      remarkEn: "",
      amountJmd: 7_500,
    },
    wholeLine: true as const,
    receivableBeforeRefundJmd: 17_500,
    netPaidBeforeJmd: 12_000,
    remainingInvoiceCreditJmd: 17_500,
    remainingLineCreditJmd: 7_500,
    priorRefunds: [],
    legacyOccupancies: [{
      chargeLineId: "fixed-zero-legacy",
      amountJmd: 0,
      quantityUnknown: true,
    }],
  };
  expect(() => previewOrdinaryLineRefund(base)).toThrow(/frozen|occupancy|fact|占用|冻结/i);
});

test("fixed-total refund requires its explicit remaining-line ceiling in addition to Invoice ceilings", () => {
  const base = {
    line: {
      pricingMode: "fixed_total" as const,
      chargeLineId: "fixed-line-ceiling",
      category: "other_service" as const,
      code: "other" as const,
      descZh: "特殊服务",
      descEn: "Special service",
      remarkZh: "",
      remarkEn: "",
      amountJmd: 7_500,
    },
    wholeLine: true as const,
    receivableBeforeRefundJmd: 17_500,
    netPaidBeforeJmd: 12_000,
    remainingLineCreditJmd: 7_499,
    remainingInvoiceCreditJmd: 17_500,
    priorRefunds: [],
    legacyOccupancies: [],
  };
  expect(() => previewOrdinaryLineRefund(base)).toThrow(/line|ceiling|full|收费行|上限/i);
});
