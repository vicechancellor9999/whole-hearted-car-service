import { expect, test } from "@playwright/test";
import {
  allocateOrderDiscount,
  calculateQuotedChargeTotals,
  type QuotedChargeLine,
} from "../../src/lib/billing/quoted-charges";
import {
  adaptLegacyQuickOrderItemToChargeLine,
  quickOrderChargeTotals,
  quickOrderTotals,
  type QuickOrderItem,
} from "../../src/lib/orders/quick-order-types";

const text = {
  descZh: "收费项目",
  descEn: "Charge item",
  remarkZh: "",
  remarkEn: "",
} as const;

function unitLine(overrides: Partial<Extract<QuotedChargeLine, { pricingMode: "unit" }>> = {}): Extract<QuotedChargeLine, { pricingMode: "unit" }> {
  return {
    id: "labor-1",
    category: "labor",
    pricingMode: "unit",
    unit: "工时",
    unitEn: "labor hour",
    quantity: 1,
    unitPriceJmd: 1_000,
    unitDiscountJmd: 0,
    pendingQuote: false,
    ...text,
    ...overrides,
  };
}

test("derives the required three-category totals from one shared charge contract", () => {
  expect(calculateQuotedChargeTotals([
    { id: "labor-1", category: "labor", pricingMode: "unit", quantity: 2, unitPriceJmd: 25_000, unitDiscountJmd: 1_250, pendingQuote: false, unit: "工时", unitEn: "labor hour", ...text },
    { id: "parts-1", category: "parts", pricingMode: "unit", quantity: 1, unitPriceJmd: 10_000, unitDiscountJmd: 0, pendingQuote: true, unit: "个", unitEn: "piece", ...text },
    { id: "other-1", category: "other_service", pricingMode: "fixed_total", code: "towing", amountJmd: 7_500, ...text },
  ])).toMatchObject({
    laborGrossJmd: 50_000,
    laborDiscountJmd: 2_500,
    laborNetJmd: 47_500,
    partsNetJmd: 0,
    otherFeeTotalJmd: 7_500,
    grandTotalJmd: 55_000,
  });
});

for (const { label, lines, expected } of [
  {
    label: "zero discount",
    lines: [unitLine()],
    expected: { laborGrossJmd: 1_000, laborDiscountJmd: 0, laborNetJmd: 1_000, grandTotalJmd: 1_000 },
  },
  {
    label: "arbitrary manual per-unit discount and quantity greater than one",
    lines: [unitLine({ quantity: 3, unitPriceJmd: 999, unitDiscountJmd: 123 })],
    expected: { laborGrossJmd: 2_997, laborDiscountJmd: 369, laborNetJmd: 2_628, grandTotalJmd: 2_628 },
  },
  {
    label: "free final unit",
    lines: [unitLine({ unitPriceJmd: 500, unitDiscountJmd: 500 })],
    expected: { laborGrossJmd: 500, laborDiscountJmd: 500, laborNetJmd: 0, grandTotalJmd: 0 },
  },
  {
    label: "pending parts excluded from gross, discount, and net",
    lines: [unitLine({ id: "parts-1", category: "parts", quantity: 4, unitPriceJmd: 2_000, pendingQuote: true })],
    expected: { partsGrossJmd: 0, partsDiscountJmd: 0, partsNetJmd: 0, pendingPartsCount: 1, grandTotalJmd: 0 },
  },
  {
    label: "fixed-total other fee included exactly once",
    lines: [{ id: "other-1", category: "other_service", pricingMode: "fixed_total", code: "offsite_service", amountJmd: 7_501, ...text } satisfies QuotedChargeLine],
    expected: { otherFeeTotalJmd: 7_501, grandTotalJmd: 7_501 },
  },
] as const) {
  test(`calculates ${label}`, () => {
    expect(calculateQuotedChargeTotals(lines)).toMatchObject(expected);
  });
}

test("includes a parking projection only when the Invoice caller explicitly accepts it", () => {
  const parking = {
    id: "parking-1",
    category: "other_service",
    pricingMode: "parking_projection",
    code: "parking_overtime",
    parkingCaseId: "parking-case-1",
    sourceRevision: 3,
    asOf: "2026-08-21T10:00:00-05:00",
    amountJmd: 2_500,
    ...text,
  } satisfies QuotedChargeLine;

  expect(calculateQuotedChargeTotals([parking])).toMatchObject({ parkingTotalJmd: 0, grandTotalJmd: 0 });
  expect(calculateQuotedChargeTotals([parking], { includeParking: true })).toMatchObject({
    parkingTotalJmd: 2_500,
    grandTotalJmd: 2_500,
  });
});

test("rejects invalid money, invalid discriminants, unsafe arithmetic, and duplicate IDs", () => {
  expect(() => calculateQuotedChargeTotals([unitLine({ unitDiscountJmd: -1 })])).toThrow(/discount|discountJmd|优惠/i);
  expect(() => calculateQuotedChargeTotals([unitLine({ quantity: 0 })])).toThrow(/quantity|数量/i);
  expect(() => calculateQuotedChargeTotals([unitLine({ unitDiscountJmd: 1_001 })])).toThrow(/discount|discountJmd|优惠/i);
  expect(() => calculateQuotedChargeTotals([unitLine({ unitPriceJmd: Number.MAX_SAFE_INTEGER, quantity: 2 })])).toThrow(/safe|安全/i);
  expect(() => calculateQuotedChargeTotals([unitLine(), unitLine()])).toThrow(/duplicate|重复/i);
  expect(() => calculateQuotedChargeTotals([
    { id: "parts-1", category: "parts", pricingMode: "unit", quantity: 1, unitPriceJmd: 100, unitDiscountJmd: 1, pendingQuote: true, unit: "个", unitEn: "piece", ...text },
  ])).toThrow(/pending|待报价/i);
  expect(() => calculateQuotedChargeTotals([
    unitLine({ id: "labor-pending", category: "labor", unitPriceJmd: 0, unitDiscountJmd: 0, pendingQuote: true }),
  ])).toThrow(/pending|parts|待报价|配件/i);
  expect(() => calculateQuotedChargeTotals([
    { id: "other-1", category: "other_service", pricingMode: "fixed_total", code: "towing", amountJmd: 100, unitDiscountJmd: 1, ...text } as never,
  ])).toThrow(/discount|优惠/i);
});

test("rejects every forbidden cross-mode own field even when its value is zero", () => {
  const fixed = { id: "fixed", category: "other_service", pricingMode: "fixed_total", code: "towing", amountJmd: 100, ...text } satisfies QuotedChargeLine;
  const parking = { id: "parking", category: "other_service", pricingMode: "parking_projection", code: "parking_overtime", parkingCaseId: "case", sourceRevision: 1, asOf: "2026-08-21T10:00:00-05:00", amountJmd: 100, ...text } satisfies QuotedChargeLine;
  const cases: ReadonlyArray<QuotedChargeLine> = [
    { ...unitLine(), amountJmd: 0 } as never,
    { ...unitLine(), parkingCaseId: "case" } as never,
    { ...fixed, unitDiscountJmd: 0 } as never,
    { ...fixed, quantity: 1 } as never,
    { ...fixed, pendingQuote: false } as never,
    { ...parking, unitDiscountJmd: 0 } as never,
    { ...parking, unitPriceJmd: 0 } as never,
    { ...parking, unit: "项" } as never,
  ];

  for (const line of cases) {
    expect(() => calculateQuotedChargeTotals([line])).toThrow(/field|schema|unexpected|字段/i);
  }
});

test("accepts required English translation fields as empty non-blocking business information", () => {
  const lines: QuotedChargeLine[] = [
    unitLine({ id: "labor-empty-en", descEn: "", remarkEn: "", unitEn: "", unitPriceJmd: 100 }),
    unitLine({ id: "parts-empty-en", category: "parts", descEn: "", remarkEn: "", unitEn: "", unitPriceJmd: 200 }),
    { id: "fixed-empty-en", category: "other_service", pricingMode: "fixed_total", code: "other", amountJmd: 300, descZh: "其他费用", descEn: "", remarkZh: "", remarkEn: "" },
  ];

  expect(calculateQuotedChargeTotals(lines)).toMatchObject({
    laborNetJmd: 100,
    partsNetJmd: 200,
    otherFeeTotalJmd: 300,
    grandTotalJmd: 600,
  });
  expect(() => calculateQuotedChargeTotals([{ ...lines[0], descZh: "" } as QuotedChargeLine])).toThrow(/Chinese|中文/i);
});

test("still requires English translation fields to be present strings", () => {
  const { descEn: _missingDescription, ...missingDescription } = unitLine();
  const fixed = { id: "fixed", category: "other_service", pricingMode: "fixed_total", code: "other", amountJmd: 100, descZh: "其他费用", descEn: "", remarkZh: "", remarkEn: null };

  expect(() => calculateQuotedChargeTotals([missingDescription as never])).toThrow(/descEn|English charge description/i);
  expect(() => calculateQuotedChargeTotals([{ ...unitLine(), unitEn: null } as never])).toThrow(/English charge unit.*text/i);
  expect(() => calculateQuotedChargeTotals([fixed as never])).toThrow(/English charge remark.*text/i);
});

test("allocates the nearest discount without exceeding target and preserves nonparticipants", () => {
  const lines: QuotedChargeLine[] = [
    unitLine({ id: "a", unitPriceJmd: 125, unitDiscountJmd: 5 }),
    unitLine({ id: "b", category: "parts", quantity: 2, unitPriceJmd: 100, unitDiscountJmd: 0 }),
    unitLine({ id: "c", category: "parts", unitPriceJmd: 100, unitDiscountJmd: 10 }),
  ];
  const before = structuredClone(lines);

  const result = allocateOrderDiscount(lines, 105, ["a", "b"]);

  expect(result).toMatchObject({
    applicable: true,
    targetDiscountJmd: 105,
    appliedDiscountJmd: 75,
    unallocatedDiscountJmd: 30,
    wholeOrderDiscountBeforeJmd: 15,
    wholeOrderDiscountAfterJmd: 85,
  });
  expect(result.proposals).toEqual([
    { id: "a", unitDiscountJmd: 75, finalUnitPriceJmd: 50, lineDiscountJmd: 75, finalLineJmd: 50 },
    { id: "b", unitDiscountJmd: 0, finalUnitPriceJmd: 100, lineDiscountJmd: 0, finalLineJmd: 200 },
  ]);
  expect(lines).toEqual(before);
});

test("minimizes exact proportional error after maximizing the applied discount", () => {
  const result = allocateOrderDiscount([
    unitLine({ id: "a", unitPriceJmd: 100 }),
    unitLine({ id: "b", category: "parts", unitPriceJmd: 100, quantity: 2 }),
  ], 100, ["a", "b"]);

  expect(result.appliedDiscountJmd).toBe(100);
  expect(result.proposals).toEqual([
    { id: "a", unitDiscountJmd: 0, finalUnitPriceJmd: 100, lineDiscountJmd: 0, finalLineJmd: 100 },
    { id: "b", unitDiscountJmd: 50, finalUnitPriceJmd: 50, lineDiscountJmd: 100, finalLineJmd: 100 },
  ]);
});

test("uses stable charge-line ID, not input order, to break equal allocation scores", () => {
  const allocate = (lines: QuotedChargeLine[]) => allocateOrderDiscount(lines, 50, lines.map((line) => line.id));
  const a = unitLine({ id: "a", unitPriceJmd: 100 });
  const b = unitLine({ id: "b", category: "parts", unitPriceJmd: 100 });

  expect(allocate([a, b]).proposals.find((proposal) => proposal.id === "a")?.unitDiscountJmd).toBe(50);
  expect(allocate([b, a]).proposals.find((proposal) => proposal.id === "a")?.unitDiscountJmd).toBe(50);
});

test("solves a realistic million-JMD exact allocation without Cartesian candidate expansion", () => {
  const result = allocateOrderDiscount([
    unitLine({ id: "a", unitPriceJmd: 1_000_000 }),
    unitLine({ id: "b", category: "parts", unitPriceJmd: 1_000_000 }),
  ], 1_000_000, ["a", "b"]);

  expect(result).toMatchObject({
    applicable: true,
    appliedDiscountJmd: 1_000_000,
    unallocatedDiscountJmd: 0,
    wholeOrderDiscountAfterJmd: 1_000_000,
  });
  expect(result.proposals).toEqual([
    { id: "a", unitDiscountJmd: 500_000, finalUnitPriceJmd: 500_000, lineDiscountJmd: 500_000, finalLineJmd: 500_000 },
    { id: "b", unitDiscountJmd: 500_000, finalUnitPriceJmd: 500_000, lineDiscountJmd: 500_000, finalLineJmd: 500_000 },
  ]);
});

test("uses exact BigInt scores when Number collapses distinct scores into the wrong stable-ID tie", () => {
  const result = allocateOrderDiscount([
    unitLine({ id: "a", unitPriceJmd: 1_520_683_920_711_525 }),
    unitLine({ id: "b", category: "parts", unitPriceJmd: 1_524_633_066_725_648 }),
    unitLine({ id: "rigid", category: "parts", quantity: 108_840_704_169_006, unitPriceJmd: 49 }),
  ], 5_333_194_504_281_417, ["a", "b", "rigid"]);

  expect(result.appliedDiscountJmd).toBe(5_333_194_504_281_417);
  expect(result.proposals).toEqual([
    { id: "a", unitDiscountJmd: 25, finalUnitPriceJmd: 1_520_683_920_711_500, lineDiscountJmd: 25, finalLineJmd: 1_520_683_920_711_500 },
    { id: "b", unitDiscountJmd: 98, finalUnitPriceJmd: 1_524_633_066_725_550, lineDiscountJmd: 98, finalLineJmd: 1_524_633_066_725_550 },
    { id: "rigid", unitDiscountJmd: 49, finalUnitPriceJmd: 0, lineDiscountJmd: 5_333_194_504_281_294, finalLineJmd: 0 },
  ]);
});

test("fails fast when exact allocation exceeds the bounded solver state space", () => {
  expect(() => allocateOrderDiscount([
    unitLine({ id: "a", unitPriceJmd: 20_000_000 }),
    unitLine({ id: "b", category: "parts", unitPriceJmd: 20_000_000 }),
  ], 20_000_000, ["a", "b"])).toThrow(/complexity|state space|复杂度/i);
});

test("rejects invalid participant IDs and returns a non-applicable grid preview without mutation", () => {
  const pending = unitLine({ id: "pending", category: "parts", pendingQuote: true });
  const fixed = { id: "fixed", category: "other_service", pricingMode: "fixed_total", code: "towing", amountJmd: 100, ...text } satisfies QuotedChargeLine;
  const parking = { id: "parking", category: "other_service", pricingMode: "parking_projection", code: "parking_overtime", parkingCaseId: "case", sourceRevision: 1, asOf: "2026-08-21T10:00:00-05:00", amountJmd: 100, ...text } satisfies QuotedChargeLine;
  const valid = unitLine({ id: "valid", unitPriceJmd: 125, unitDiscountJmd: 5 });
  for (const ids of [["pending"], ["fixed"], ["parking"], ["missing"], ["valid", "valid"]]) {
    expect(() => allocateOrderDiscount([pending, fixed, parking, valid], 25, ids)).toThrow(/participant|duplicate|pending|参与|重复|待报价/i);
  }

  const before = structuredClone([valid]);
  const result = allocateOrderDiscount([valid], 20, ["valid"]);
  expect(result).toMatchObject({
    applicable: false,
    targetDiscountJmd: 20,
    appliedDiscountJmd: 0,
    unallocatedDiscountJmd: 20,
    wholeOrderDiscountBeforeJmd: 5,
    wholeOrderDiscountAfterJmd: 5,
    proposals: [],
  });
  expect([valid]).toEqual(before);
});

test("keeps legacy QuickOrderItem readable while new Quick BO totals use line discounts once", () => {
  const legacyItem: QuickOrderItem = {
    id: "legacy-1",
    descZh: "检查",
    descEn: "Inspection",
    category: "labor",
    unit: "工时",
    unitPriceJmd: 1_000,
    quantity: 2,
    pendingQuote: false,
  };

  expect(quickOrderTotals({ items: [legacyItem] })).toEqual({ laborJmd: 2_000, partsJmd: 0, otherServiceJmd: 0, totalJmd: 2_000 });
  expect(adaptLegacyQuickOrderItemToChargeLine(legacyItem)).toMatchObject({
    id: "legacy-1",
    pricingMode: "unit",
    unitDiscountJmd: 0,
  });
  expect(quickOrderChargeTotals([
    unitLine({ id: "new-1", quantity: 2, unitPriceJmd: 1_000, unitDiscountJmd: 100 }),
  ])).toEqual({ laborJmd: 1_800, partsJmd: 0, otherServiceJmd: 0, totalJmd: 1_800 });
});
