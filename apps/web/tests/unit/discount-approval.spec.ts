import { expect, test } from "@playwright/test";
import {
  discountApprovalRequirement,
  validateDiscountApprovalEvidence,
  type DiscountApprovalEvidence,
} from "../../src/lib/billing/discount-approval";
import type { QuotedChargeLine } from "../../src/lib/billing/quoted-charges";

const text = { descZh: "收费", descEn: "Charge", remarkZh: "", remarkEn: "" } as const;

function line(
  id: string,
  category: "labor" | "parts",
  unitPriceJmd: number,
  unitDiscountJmd: number,
  pendingQuote = false,
): QuotedChargeLine {
  return {
    id,
    category,
    pricingMode: "unit",
    unit: category === "labor" ? "工时" : "个",
    unitEn: category === "labor" ? "labor hour" : "piece",
    quantity: 1,
    unitPriceJmd,
    unitDiscountJmd,
    pendingQuote,
    ...text,
  };
}

for (const { label, lines, expected } of [
  {
    label: "equal labor and parts thresholds do not require evidence",
    lines: [line("labor", "labor", 10_000, 2_000), line("parts", "parts", 8_000, 1_000)],
    expected: { required: false, labor: { ratio: 0.2, exceedsThreshold: false }, parts: { ratio: 0.125, exceedsThreshold: false } },
  },
  {
    label: "labor strictly above 20 percent requires evidence",
    lines: [line("labor", "labor", 10_000, 2_001)],
    expected: { required: true, labor: { ratio: 0.2001, exceedsThreshold: true }, parts: { ratio: 0, exceedsThreshold: false } },
  },
  {
    label: "parts strictly above 12.5 percent requires evidence",
    lines: [line("parts", "parts", 8_000, 1_001)],
    expected: { required: true, labor: { ratio: 0, exceedsThreshold: false }, parts: { ratio: 0.125125, exceedsThreshold: true } },
  },
  {
    label: "pending parts and fixed totals do not affect either ratio",
    lines: [
      line("pending", "parts", 8_000, 0, true),
      { id: "other", category: "other_service", pricingMode: "fixed_total", code: "other", amountJmd: 50_000, ...text } satisfies QuotedChargeLine,
    ],
    expected: { required: false, labor: { ratio: 0, grossJmd: 0, discountJmd: 0 }, parts: { ratio: 0, grossJmd: 0, discountJmd: 0 } },
  },
] as const) {
  test(label, () => {
    expect(discountApprovalRequirement(lines)).toMatchObject(expected);
  });
}

const evidence: DiscountApprovalEvidence = {
  document: { kind: "quotation", id: "quotation-1" },
  operationAccount: { id: "employee-1", name: "Front Desk" },
  rawStrokes: [[{ x: 10, y: 20, time: 1 }]],
  signedAt: "2026-08-21T10:00:00-05:00",
  mutationId: "mutation-1",
  categoryRatios: {
    labor: { grossJmd: 10_000, discountJmd: 2_001, ratio: 0.2001, exceedsThreshold: true },
    parts: { grossJmd: 0, discountJmd: 0, ratio: 0, exceedsThreshold: false },
  },
};

test("accepts one raw ordered stroke and records only the operation account", () => {
  expect(() => validateDiscountApprovalEvidence(evidence)).not.toThrow();
});

test("rejects empty scribbles, invalid Jamaica instants, and approver identity claims", () => {
  expect(() => validateDiscountApprovalEvidence({ ...evidence, rawStrokes: [] })).toThrow(/stroke|笔迹/i);
  expect(() => validateDiscountApprovalEvidence({ ...evidence, rawStrokes: [[]] })).toThrow(/stroke|笔迹/i);
  expect(() => validateDiscountApprovalEvidence({ ...evidence, signedAt: "not-a-date" })).toThrow(/time|Jamaica|时间/i);
  expect(() => validateDiscountApprovalEvidence({ ...evidence, signedAt: "2026-08-21T15:00:00.000Z" })).toThrow(/Jamaica|-05:00/i);
  expect(() => validateDiscountApprovalEvidence({ ...evidence, approverId: "manager-1" } as never)).toThrow(/approver|审批人/i);
  expect(() => validateDiscountApprovalEvidence({ ...evidence, approverName: "Manager" } as never)).toThrow(/approver|审批人/i);
});

test("rejects approver or administrator identity claims at every nested schema boundary", () => {
  const nestedClaims: ReadonlyArray<DiscountApprovalEvidence> = [
    { ...evidence, document: { ...evidence.document, approverId: "manager-1" } } as never,
    { ...evidence, operationAccount: { ...evidence.operationAccount, administratorName: "Manager" } } as never,
    { ...evidence, rawStrokes: [[{ ...evidence.rawStrokes[0][0], approverName: "Manager" }]] } as never,
    { ...evidence, categoryRatios: { ...evidence.categoryRatios, labor: { ...evidence.categoryRatios.labor, administratorId: "manager-1" } } } as never,
  ];

  for (const claim of nestedClaims) {
    expect(() => validateDiscountApprovalEvidence(claim)).toThrow(/field|schema|approver|administrator|字段|审批人/i);
  }
});

test("rejects a custom own-property on the outer raw-strokes array", () => {
  const outerStrokes = evidence.rawStrokes.map((stroke) => stroke.map((point) => ({ ...point })));
  Object.defineProperty(outerStrokes, "customAudit", { value: "not allowed", enumerable: true });

  expect(() => validateDiscountApprovalEvidence({ ...evidence, rawStrokes: outerStrokes })).toThrow(/raw strokes schema.*customAudit|unexpected field/i);
});

test("rejects a Symbol own-property on an individual raw-stroke array", () => {
  const strokeWithSymbol = evidence.rawStrokes[0].map((point) => ({ ...point }));
  Object.defineProperty(strokeWithSymbol, Symbol("approver"), { value: "not allowed", enumerable: true });

  expect(() => validateDiscountApprovalEvidence({ ...evidence, rawStrokes: [strokeWithSymbol] })).toThrow(/raw stroke schema.*Symbol|unexpected field/i);
});

test("rejects a custom own-property on the category-ratios wrapper", () => {
  const ratiosWithCustomField = { ...evidence.categoryRatios };
  Object.defineProperty(ratiosWithCustomField, "customIdentity", { value: "not allowed", enumerable: true });

  expect(() => validateDiscountApprovalEvidence({ ...evidence, categoryRatios: ratiosWithCustomField })).toThrow(/category ratios schema.*customIdentity|unexpected field/i);
});

test("rejects threshold flags that disagree with exact category money facts", () => {
  expect(() => validateDiscountApprovalEvidence({
    ...evidence,
    categoryRatios: {
      ...evidence.categoryRatios,
      labor: { ...evidence.categoryRatios.labor, exceedsThreshold: false },
    },
  })).toThrow(/threshold|门槛/i);
  expect(() => validateDiscountApprovalEvidence({
    ...evidence,
    categoryRatios: {
      ...evidence.categoryRatios,
      parts: { grossJmd: 8_000, discountJmd: 1_000, ratio: 0.125, exceedsThreshold: true },
    },
  })).toThrow(/threshold|门槛/i);
});
