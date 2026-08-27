import { expect, test } from "@playwright/test";
import {
  buildInvoiceChargeSnapshot,
  invoiceSnapshotLineToQuotedCharge,
  invoiceSnapshotApprovalRequirement,
  validateInvoiceChargeSnapshot,
  validateInvoiceLineageTransition,
  type InvoiceChargeSnapshot,
} from "../../src/lib/billing/invoice-snapshots";
import type { LegacyInvoice, QuotedChargeLine, SharedChargeInvoice } from "../../src/lib/billing/types";
import type { QuickOrderChargeLine } from "../../src/lib/orders/quick-order-types";
import {
  activateMockQuickInvoiceSnapshot,
  getMockBillingBusinessOrder,
  getMockBillingWorkspace,
  recordMockInvoicePayment,
  recordMockInvoiceLineRefund,
} from "../../src/lib/api/mock-billing";
import {
  canonicalBillingActorIdentity,
  createMockLinkedOperationsStore,
  validateLinkedOperationsState,
  type LinkedOperationsState,
} from "../../src/lib/api/mock-orders";
import { mockIdentities } from "../../src/lib/api/mock-data";
import { recordMockQuickPayment } from "../../src/lib/api/mock-quick-orders";
import type { DiscountApprovalEvidence } from "../../src/lib/billing/discount-approval";

function memoryStorage(values = new Map<string, string>()): Storage {
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

const frontdeskActor = { id: "emp-001", name: "超级管理员", role: "superadmin" as const };
const financeActor = { id: "test-finance", name: "测试财务", role: "finance" as const };
const INVOICE_STROKES = [[{ x: 10, y: 10, time: 1 }, { x: 20, y: 20, time: 2 }]] as const;
const OTHER_INVOICE_STROKES = [[{ x: 30, y: 30, time: 3 }, { x: 40, y: 40, time: 4 }]] as const;

async function addSharedQuickOrder(
  store: ReturnType<typeof createMockLinkedOperationsStore>,
  orderId: string,
  lines: ReadonlyArray<QuickOrderChargeLine>,
): Promise<void> {
  await store.mutate((state) => {
    const base = state.quickOrders.find((order) => order.id === "demo-v2-parking-unclaimed")
      ?? state.quickOrders.find((order) => order.status === "submitted")
      ?? state.quickOrders[0];
    if (!base) throw new Error("seed Quick BO missing");
    state.quickOrders.push({
      ...structuredClone(base),
      id: orderId,
      businessOrderNo: `KGN-WH-${orderId.toUpperCase()}`,
      status: "submitted",
      teamId: "test-repair-team",
      mechanicName: "测试维修班组",
      assignedAt: "2026-07-01T08:10:00-05:00",
      acceptedAt: "2026-07-01T08:20:00-05:00",
      returnedAt: "2026-07-01T08:50:00-05:00",
      submittedAt: "2026-07-01T09:00:00-05:00",
      submittedBy: "超级管理员",
      statusHistory: [
        { id: `${orderId}-ev-1`, from: null, to: "pending_assign", by: "超级管理员", byRole: "frontdesk", at: "2026-07-01T08:00:00-05:00" },
        { id: `${orderId}-ev-2`, from: "returned", to: "submitted", by: "超级管理员", byRole: "frontdesk", at: "2026-07-01T09:00:00-05:00", roundNumber: 1, teamId: "test-repair-team", performanceValueJmd: base.performanceValueJmd },
      ],
      items: [],
      chargeContract: "shared_v1",
      chargeLines: structuredClone(lines),
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
    });
    state.revision += 1;
  }, { action: "test.shared-order.write", consumeWriteFault: false });
}

function stateSnapshot(store: ReturnType<typeof createMockLinkedOperationsStore>): LinkedOperationsState {
  return store.read((state) => state);
}

function mutationPayloadHash(canonical: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

test("shared Quick BO records each payment as an independent history entry", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-shared-payment-split", [unit("shared-payment-line", "labor", 10_000, 0)]);
  const before = stateSnapshot(store);

  const paid = await recordMockQuickPayment(
    "qbo-shared-payment-split",
    { amountJmd: 4_000, method: "cash" },
    frontdeskActor.name,
    store,
  );
  expect(paid.payments).toHaveLength(1);
  expect(paid.payments[0]).toMatchObject({ amountJmd: 4_000, method: "cash", receivedBy: frontdeskActor.name });
  expect(stateSnapshot(store).revision).toBe(before.revision + 1);
  expect(() => validateLinkedOperationsState(stateSnapshot(store))).not.toThrow();
});

const unit = (
  id: string,
  category: "labor" | "parts",
  unitPriceJmd: number,
  unitDiscountJmd: number,
  quantity = 1,
): Extract<QuickOrderChargeLine, { pricingMode: "unit" }> => ({
  id,
  category,
  pricingMode: "unit",
  descZh: `${category}-${id}`,
  descEn: `${category}-${id}`,
  remarkZh: "",
  remarkEn: "",
  unit: "项",
  unitEn: "item",
  quantity,
  unitPriceJmd,
  unitDiscountJmd,
  pendingQuote: false,
});

const fixed = (id: string, amountJmd: number): Extract<QuickOrderChargeLine, { pricingMode: "fixed_total" }> => ({
  id,
  category: "other_service",
  pricingMode: "fixed_total",
  code: "towing",
  descZh: "拖车",
  descEn: "Towing",
  remarkZh: "",
  remarkEn: "",
  amountJmd,
});

const parking = (id: string, parkingCaseId: string, amountJmd: number): QuotedChargeLine => ({
  id,
  category: "other_service",
  pricingMode: "parking_projection",
  code: "parking_overtime",
  descZh: "停车超时费",
  descEn: "Parking overtime",
  remarkZh: "",
  remarkEn: "",
  parkingCaseId,
  sourceRevision: 7,
  asOf: "2026-08-21T12:00:00-05:00",
  amountJmd,
});

test("Invoice snapshot closes unit/fixed/parking unions and derives exact separated totals", () => {
  const snapshot = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-shared-1",
    sourceBusinessOrderRevision: 17,
    lines: [
      unit("labor-1", "labor", 25_000, 1_250, 2),
      unit("parts-1", "parts", 10_000, 500, 1),
      fixed("other-1", 7_500),
      parking("parking-1", "PARK-Q-1", 2_500),
    ],
  });

  expect(snapshot.sourceBusinessOrderId).toBe("qbo-shared-1");
  expect(snapshot.sourceBusinessOrderRevision).toBe(17);
  expect(snapshot.lines).toEqual([
    expect.objectContaining({
      pricingMode: "unit",
      chargeLineId: "labor-1",
      unitPriceJmd: 25_000,
      unitDiscountJmd: 1_250,
      finalUnitPriceJmd: 23_750,
      finalLineJmd: 47_500,
    }),
    expect.objectContaining({
      pricingMode: "unit",
      chargeLineId: "parts-1",
      finalUnitPriceJmd: 9_500,
      finalLineJmd: 9_500,
    }),
    {
      pricingMode: "fixed_total",
      chargeLineId: "other-1",
      category: "other_service",
      code: "towing",
      descZh: "拖车",
      descEn: "Towing",
      remarkZh: "",
      remarkEn: "",
      amountJmd: 7_500,
    },
    expect.objectContaining({
      pricingMode: "parking_projection",
      chargeLineId: "parking-1",
      parkingCaseId: "PARK-Q-1",
      sourceRevision: 7,
      amountJmd: 2_500,
    }),
  ]);
  expect(snapshot.totals).toEqual({
    laborGrossJmd: 50_000,
    laborDiscountJmd: 2_500,
    laborNetJmd: 47_500,
    partsGrossJmd: 10_000,
    partsDiscountJmd: 500,
    partsNetJmd: 9_500,
    otherFeeTotalJmd: 7_500,
    parkingTotalJmd: 2_500,
    totalDiscountJmd: 3_000,
    chargeSubtotalJmd: 67_000,
    adjustmentsJmd: 0,
    grandTotalJmd: 67_000,
  });

  expect(Object.keys(snapshot.lines[2])).not.toEqual(expect.arrayContaining([
    "quantity", "unit", "unitPriceJmd", "unitDiscountJmd", "pendingQuote", "finalLineJmd",
  ]));
  expect(Object.keys(snapshot.lines[3])).not.toEqual(expect.arrayContaining([
    "quantity", "unit", "unitPriceJmd", "unitDiscountJmd", "pendingQuote",
  ]));
});

test("Invoice repeats strict discount thresholds independently and both categories consume one trace", () => {
  const requirement = (lines: ReadonlyArray<QuotedChargeLine>) => invoiceSnapshotApprovalRequirement(
    buildInvoiceChargeSnapshot({
      sourceBusinessOrderId: "qbo-threshold",
      sourceBusinessOrderRevision: 1,
      lines,
    }),
  );

  expect(requirement([unit("labor-equal", "labor", 10_000, 2_000)]).required).toBe(false);
  expect(requirement([unit("labor-high", "labor", 10_000, 2_001)])).toMatchObject({
    required: true,
    laborExceeds: true,
    partsExceeds: false,
  });
  expect(requirement([unit("parts-equal", "parts", 8_000, 1_000)]).required).toBe(false);
  expect(requirement([unit("parts-high", "parts", 8_000, 1_001)])).toMatchObject({
    required: true,
    laborExceeds: false,
    partsExceeds: true,
  });
  expect(requirement([
    unit("labor-both", "labor", 10_000, 2_001),
    unit("parts-both", "parts", 8_000, 1_001),
    fixed("fixed-does-not-trigger", 999_999),
    parking("parking-does-not-trigger", "PARK-NO-SIGN", 999_999),
  ])).toMatchObject({ required: true, laborExceeds: true, partsExceeds: true, requiredTraceCount: 1 });
});

test("Invoice lineage keeps stable IDs and cannot reset refunded occupancy by delete/recreate", () => {
  const v1 = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-lineage",
    sourceBusinessOrderRevision: 1,
    lines: [unit("labor-stable", "labor", 10_000, 0, 2), fixed("fixed-stable", 7_500)],
  });
  const v2 = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-lineage",
    sourceBusinessOrderRevision: 2,
    lines: [fixed("fixed-stable", 7_500), unit("labor-stable", "labor", 10_000, 0, 2)],
  });

  expect(() => validateInvoiceLineageTransition({
    previousSnapshots: [v1],
    nextSnapshot: v2,
    refundOccupancies: [{ chargeLineId: "labor-stable", quantity: 1, amountJmd: 10_000 }],
  })).not.toThrow();

  const replaced = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-lineage",
    sourceBusinessOrderRevision: 3,
    lines: [unit("labor-fresh-id", "labor", 10_000, 0, 2), fixed("fixed-stable", 7_500)],
  });
  expect(() => validateInvoiceLineageTransition({
    previousSnapshots: [v1],
    nextSnapshot: replaced,
    refundOccupancies: [{ chargeLineId: "labor-stable", quantity: 1, amountJmd: 10_000 }],
  })).toThrow(/lineage|stable|deleted|recreated|收费行/i);

  const rewrittenFixed = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-lineage",
    sourceBusinessOrderRevision: 4,
    lines: [unit("labor-stable", "labor", 10_000, 0, 2), fixed("fixed-stable", 7_499)],
  });
  expect(() => validateInvoiceLineageTransition({
    previousSnapshots: [v1],
    nextSnapshot: rewrittenFixed,
    refundOccupancies: [{ chargeLineId: "fixed-stable", amountJmd: 1 }],
  })).toThrow(/fixed|occupancy|一口价|frozen/i);
});

test("snapshot validator rejects spoofed derived facts and cross-mode own keys", () => {
  const snapshot = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-closed",
    sourceBusinessOrderRevision: 1,
    lines: [unit("labor-closed", "labor", 10_000, 1_000)],
  });
  const spoofed = structuredClone(snapshot) as InvoiceChargeSnapshot;
  (spoofed.lines[0] as { finalUnitPriceJmd: number }).finalUnitPriceJmd = 1;
  expect(() => invoiceSnapshotApprovalRequirement(spoofed)).toThrow(/derived|final|snapshot/i);

  expect(() => buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-closed",
    sourceBusinessOrderRevision: 1,
    lines: [{ ...fixed("fixed-closed", 7_500), quantity: 1 } as never],
  })).toThrow(/unexpected|schema|field/i);
});

test("snapshot validator checks the stored fixed-total category literal", () => {
  const snapshot = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-fixed-literal",
    sourceBusinessOrderRevision: 1,
    lines: [fixed("fixed-literal", 7_500)],
  });
  const spoofed = structuredClone(snapshot) as unknown as {
    lines: Array<{ category: string; code: string }>;
  };
  spoofed.lines[0].category = "parts";
  expect(() => validateInvoiceChargeSnapshot(spoofed as never)).toThrow(/category|other_service|fixed|类别/i);
});

test("snapshot validator checks the stored parking category and code literals", () => {
  const snapshot = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-parking-literal",
    sourceBusinessOrderRevision: 1,
    lines: [parking("parking-literal", "PARK-LITERAL", 2_500)],
  });
  const categorySpoof = structuredClone(snapshot) as unknown as {
    lines: Array<{ category: string; code: string }>;
  };
  categorySpoof.lines[0].category = "labor";
  expect.soft(() => validateInvoiceChargeSnapshot(categorySpoof as never)).toThrow(/category|other_service|parking|类别/i);

  const codeSpoof = structuredClone(snapshot) as unknown as {
    lines: Array<{ category: string; code: string }>;
  };
  codeSpoof.lines[0].code = "towing";
  expect.soft(() => validateInvoiceChargeSnapshot(codeSpoof as never)).toThrow(/code|parking_overtime|parking|代码/i);
});

test("snapshot builder rejects duplicate lineage/case", () => {
  const build = (lines: ReadonlyArray<QuotedChargeLine>) => buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-invalid",
    sourceBusinessOrderRevision: 1,
    lines,
  });
  expect(() => build([unit("duplicate", "labor", 1_000, 0), unit("duplicate", "parts", 1_000, 0)]))
    .toThrow(/duplicate/i);
  expect(() => build([
    parking("parking-a", "PARK-DUPLICATE", 2_500),
    parking("parking-b", "PARK-DUPLICATE", 2_500),
  ])).toThrow(/duplicate.*parking|parking.*duplicate|重复.*停车/i);
});

test("snapshot builder rejects pending money and unsafe money", () => {
  const build = (lines: ReadonlyArray<QuotedChargeLine>) => buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-invalid",
    sourceBusinessOrderRevision: 1,
    lines,
  });
  expect(() => build([{ ...unit("pending", "parts", 0, 0), pendingQuote: true } as QuotedChargeLine]))
    .toThrow(/pending/i);
  expect(() => build([unit("unsafe", "labor", Number.MAX_SAFE_INTEGER, 0, 2)]))
    .toThrow(/safe integer|安全整数/i);
});

test("snapshot builder supports closed legal adjustments and preserves parking V2 exactly", () => {
  const snapshot = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-adjusted",
    sourceBusinessOrderRevision: 2,
    lines: [unit("labor-adjusted", "labor", 10_000, 0), parking("parking-adjusted", "PARK-V2", 2_500)],
    adjustments: [
      { id: "waiver-1", kind: "waiver", amountJmd: -500 },
      { id: "write-off-1", kind: "write_off", amountJmd: -250 },
      { id: "rounding-1", kind: "rounding", amountJmd: 1 },
    ],
  } as never) as InvoiceChargeSnapshot & {
    adjustments: ReadonlyArray<{ id: string; kind: string; amountJmd: number }>;
  };
  expect(snapshot.adjustments).toEqual([
    { id: "waiver-1", kind: "waiver", amountJmd: -500 },
    { id: "write-off-1", kind: "write_off", amountJmd: -250 },
    { id: "rounding-1", kind: "rounding", amountJmd: 1 },
  ]);
  expect(snapshot.lines[1]).toMatchObject({
    pricingMode: "parking_projection",
    parkingCaseId: "PARK-V2",
    amountJmd: 2_500,
  });
  expect(snapshot.totals).toMatchObject({
    chargeSubtotalJmd: 12_500,
    adjustmentsJmd: -749,
    grandTotalJmd: 11_751,
  });
});

test("snapshot builder rejects legacy discount adjustments by kind", () => {
  expect(() => buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-invalid",
    sourceBusinessOrderRevision: 1,
    lines: [unit("labor", "labor", 10_000, 0)],
    adjustments: [{ id: "legacy-discount", kind: "discount", amountJmd: -1_000 }],
  } as never)).toThrow(/legacy|discount/i);
});

test("snapshot derives every money fact without mutating its source BO charge rows", () => {
  const lines: QuotedChargeLine[] = [
    unit("labor-source", "labor", 12_000, 2_000, 2),
    unit("parts-source", "parts", 8_000, 1_000, 3),
    fixed("fixed-source", 7_500),
    parking("parking-source", "PARK-SOURCE", 2_500),
  ];
  const before = structuredClone(lines);
  const snapshot = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-source",
    sourceBusinessOrderRevision: 9,
    lines,
  });
  expect(snapshot.totals).toEqual({
    laborGrossJmd: 24_000,
    laborDiscountJmd: 4_000,
    laborNetJmd: 20_000,
    partsGrossJmd: 24_000,
    partsDiscountJmd: 3_000,
    partsNetJmd: 21_000,
    otherFeeTotalJmd: 7_500,
    parkingTotalJmd: 2_500,
    totalDiscountJmd: 7_000,
    chargeSubtotalJmd: 51_000,
    adjustmentsJmd: 0,
    grandTotalJmd: 51_000,
  });
  expect(lines).toEqual(before);
});

test("lineage rejects category reuse even before refund occupancy", () => {
  const v1 = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-lineage-2",
    sourceBusinessOrderRevision: 1,
    lines: [unit("stable", "labor", 10_000, 0, 2)],
  });
  const categoryChanged = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-lineage-2",
    sourceBusinessOrderRevision: 2,
    lines: [unit("stable", "parts", 10_000, 0, 2)],
  });
  expect(() => validateInvoiceLineageTransition({
    previousSnapshots: [v1], nextSnapshot: categoryChanged, refundOccupancies: [],
  })).toThrow(/lineage|category|stable/i);
});

test("lineage rejects mode reuse even before refund occupancy", () => {
  const v1 = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-lineage-2",
    sourceBusinessOrderRevision: 1,
    lines: [unit("stable", "labor", 10_000, 0, 2)],
  });

  const modeChanged = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-lineage-2",
    sourceBusinessOrderRevision: 2,
    lines: [fixed("stable", 20_000)],
  });
  expect(() => validateInvoiceLineageTransition({
    previousSnapshots: [v1], nextSnapshot: modeChanged, refundOccupancies: [],
  })).toThrow(/lineage|mode|stable/i);
});

test("lineage rejects quantity below known refund while allowing a truly new charge", () => {
  const v1 = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-lineage-2",
    sourceBusinessOrderRevision: 1,
    lines: [unit("stable", "labor", 10_000, 0, 2)],
  });

  const quantityReduced = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-lineage-2",
    sourceBusinessOrderRevision: 2,
    lines: [unit("stable", "labor", 10_000, 0, 1)],
  });
  expect(() => validateInvoiceLineageTransition({
    previousSnapshots: [v1],
    nextSnapshot: quantityReduced,
    refundOccupancies: [{ chargeLineId: "stable", quantity: 2, amountJmd: 20_000 }],
  })).toThrow(/quantity|数量|occupied|refund/i);

  const withNewCharge = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-lineage-2",
    sourceBusinessOrderRevision: 3,
    lines: [unit("stable", "labor", 10_000, 0, 2), fixed("truly-new", 5_000)],
  });
  expect(() => validateInvoiceLineageTransition({
    previousSnapshots: [v1],
    nextSnapshot: withNewCharge,
    refundOccupancies: [{ chargeLineId: "stable", quantity: 1, amountJmd: 10_000 }],
  })).not.toThrow();
});

test("lineage compares the checked aggregate occupied quantity with the next line", () => {
  const v1 = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-aggregate-quantity",
    sourceBusinessOrderRevision: 1,
    lines: [unit("aggregate-stable", "labor", 10_000, 0, 2)],
  });
  const v2 = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-aggregate-quantity",
    sourceBusinessOrderRevision: 2,
    lines: [unit("aggregate-stable", "labor", 10_000, 0, 2)],
  });
  expect(() => validateInvoiceLineageTransition({
    previousSnapshots: [v1],
    nextSnapshot: v2,
    refundOccupancies: [
      { chargeLineId: "aggregate-stable", quantity: 2, amountJmd: 10_000 },
      { chargeLineId: "aggregate-stable", quantity: 2, amountJmd: 10_000 },
    ],
  })).toThrow(/aggregate|cumulative|quantity|occupied|累计|数量/i);
});

test("lineage compares the checked aggregate occupied value with the next line", () => {
  const v1 = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-aggregate-value",
    sourceBusinessOrderRevision: 1,
    lines: [unit("aggregate-stable", "labor", 10_000, 0, 2)],
  });
  const v2 = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: "qbo-aggregate-value",
    sourceBusinessOrderRevision: 2,
    lines: [unit("aggregate-stable", "labor", 10_000, 0, 2)],
  });
  expect(() => validateInvoiceLineageTransition({
    previousSnapshots: [v1],
    nextSnapshot: v2,
    refundOccupancies: [
      { chargeLineId: "aggregate-stable", quantity: 1, amountJmd: 15_000 },
      { chargeLineId: "aggregate-stable", quantity: 1, amountJmd: 15_000 },
    ],
  })).toThrow(/aggregate|cumulative|value|amount|occupied|累计|金额/i);
});

test("canonical activation appends one effective immutable Invoice snapshot and exact replay creates nothing twice", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-invoice-low", [
    unit("invoice-labor-low", "labor", 10_000, 2_000),
    fixed("invoice-fixed-low", 7_500),
  ]);
  const before = stateSnapshot(store);
  const input = {
    orderId: "qbo-invoice-low",
    expectedRevision: before.revision,
    mutationId: "invoice-activate-low-v1",
  };
  const first = await activateMockQuickInvoiceSnapshot(input, frontdeskActor, store);
  const afterFirst = stateSnapshot(store) as LinkedOperationsState & {
    billingSnapshotVersion: number;
    billingAuditEvents: Array<Record<string, unknown>>;
  };
  const invoice = afterFirst.invoices.find((candidate) => candidate.id === first.invoiceId) as unknown as {
    invoiceContract: string;
    financiallyEffectiveVersionId: string;
    versions: Array<{ id: string; chargeContract: string; snapshot: InvoiceChargeSnapshot }>;
  };
  expect(invoice).toMatchObject({
    invoiceContract: "shared_v1",
    financiallyEffectiveVersionId: first.invoiceVersionId,
  });
  expect(invoice.versions).toHaveLength(1);
  expect(invoice.versions[0]).toMatchObject({
    id: first.invoiceVersionId,
    chargeContract: "shared_v1",
    snapshot: {
      sourceBusinessOrderId: "qbo-invoice-low",
      sourceBusinessOrderRevision: before.revision,
      totals: { laborNetJmd: 8_000, otherFeeTotalJmd: 7_500, grandTotalJmd: 15_500 },
    },
  });
  expect(afterFirst.billingSnapshotVersion).toBe(1);
  expect(afterFirst.billingAuditEvents).toContainEqual(expect.objectContaining({
    operation: "invoice_activation",
    mutationId: input.mutationId,
    invoiceId: first.invoiceId,
    invoiceVersionId: first.invoiceVersionId,
  }));
  expect(afterFirst.discountSignatureEvents).toHaveLength(before.discountSignatureEvents.length);
  expect(afterFirst.quickOrders.find((order) => order.id === input.orderId)).toEqual(
    before.quickOrders.find((order) => order.id === input.orderId),
  );

  const replay = await activateMockQuickInvoiceSnapshot(input, frontdeskActor, store);
  expect(replay).toEqual(first);
  const afterReplay = stateSnapshot(store) as typeof afterFirst;
  expect(afterReplay.invoices.find((candidate) => candidate.id === first.invoiceId)).toEqual(
    afterFirst.invoices.find((candidate) => candidate.id === first.invoiceId),
  );
  expect(afterReplay.billingAuditEvents).toEqual(afterFirst.billingAuditEvents);
  expect(afterReplay.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId)).toHaveLength(1);
});

test("Invoice requires its own one-use high-discount trace and rejects missing, reused, or unnecessary strokes atomically", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-invoice-high", [
    unit("invoice-labor-high", "labor", 10_000, 2_001),
    unit("invoice-parts-high", "parts", 8_000, 1_001),
  ]);
  const before = stateSnapshot(store);
  const base = {
    orderId: "qbo-invoice-high",
    expectedRevision: before.revision,
    mutationId: "invoice-high-v1",
  };
  await expect(activateMockQuickInvoiceSnapshot(base, frontdeskActor, store)).rejects.toThrow(/signature|签字|笔迹/i);
  expect(stateSnapshot(store)).toEqual(before);

  await store.mutate((state) => {
    state.discountSignatureEvents.push({
      document: { kind: "business_order", id: "some-other-bo" },
      operationAccount: { id: frontdeskActor.id, name: frontdeskActor.name },
      rawStrokes: INVOICE_STROKES,
      signedAt: "2026-08-21T10:00:00-05:00",
      mutationId: "already-consumed-by-bo",
      categoryRatios: {
        labor: { grossJmd: 10_000, discountJmd: 2_001, ratio: 0.2001, exceedsThreshold: true },
        parts: { grossJmd: 0, discountJmd: 0, ratio: 0, exceedsThreshold: false },
      },
    } satisfies DiscountApprovalEvidence);
    state.revision += 1;
  }, { action: "test.signature.write", consumeWriteFault: false });
  const withConsumed = stateSnapshot(store);
  await expect(activateMockQuickInvoiceSnapshot({
    ...base,
    expectedRevision: withConsumed.revision,
    signature: { rawStrokes: INVOICE_STROKES },
  }, frontdeskActor, store)).rejects.toThrow(/used|consumed|已.*消费|重新签/i);
  expect(stateSnapshot(store)).toEqual(withConsumed);

  const created = await activateMockQuickInvoiceSnapshot({
    ...base,
    expectedRevision: withConsumed.revision,
    signature: { rawStrokes: OTHER_INVOICE_STROKES },
  }, frontdeskActor, store);
  const after = stateSnapshot(store);
  const invoiceSignatures = after.discountSignatureEvents.filter((event) => event.document.kind === "invoice");
  expect(invoiceSignatures).toHaveLength(1);
  expect(invoiceSignatures[0]).toMatchObject({
    document: { kind: "invoice", id: created.invoiceId },
    mutationId: base.mutationId,
  });

  await addSharedQuickOrder(store, "qbo-invoice-no-sign", [unit("low", "labor", 10_000, 2_000)]);
  const lowState = stateSnapshot(store);
  await expect(activateMockQuickInvoiceSnapshot({
    orderId: "qbo-invoice-no-sign",
    expectedRevision: lowState.revision,
    mutationId: "invoice-unnecessary-signature",
    signature: { rawStrokes: [[{ x: 1, y: 1, time: 1 }]] },
  }, frontdeskActor, store)).rejects.toThrow(/not need|unnecessary|不需要|不得提交/i);
  expect(stateSnapshot(store)).toEqual(lowState);
});

test("activation write fault consumes no IDs/signature and response-loss replay returns the original version", async () => {
  const scenario: { failNext: { byAction: Record<string, string> } } = {
    failNext: { byAction: { "billing.invoice.activate.write": "invoice write fault" } },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: memoryStorage(), __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore((globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage);
    await addSharedQuickOrder(store, "qbo-invoice-fault", [unit("fault-line", "labor", 10_000, 2_001)]);
    const before = stateSnapshot(store);
    const input = {
      orderId: "qbo-invoice-fault",
      expectedRevision: before.revision,
      mutationId: "invoice-fault-v1",
      signature: { rawStrokes: INVOICE_STROKES },
    };
    await expect(activateMockQuickInvoiceSnapshot(input, frontdeskActor, store)).rejects.toThrow(/write fault|保存|写入/i);
    expect(stateSnapshot(store)).toEqual(before);
    const success = await activateMockQuickInvoiceSnapshot(input, frontdeskActor, store);
    const committed = stateSnapshot(store);

    scenario.failNext.byAction["billing.invoice.activate.response"] = "invoice response loss";
    await addSharedQuickOrder(store, "qbo-invoice-response", [unit("response-line", "labor", 10_000, 0)]);
    const responseState = stateSnapshot(store);
    const responseInput = {
      orderId: "qbo-invoice-response",
      expectedRevision: responseState.revision,
      mutationId: "invoice-response-v1",
    };
    await expect(activateMockQuickInvoiceSnapshot(responseInput, frontdeskActor, store)).rejects.toThrow(/response loss|响应/i);
    const afterLoss = stateSnapshot(store);
    const replay = await activateMockQuickInvoiceSnapshot(responseInput, frontdeskActor, store);
    expect(replay.invoiceVersionId).toBe(
      (afterLoss.invoices.find((invoice) => invoice.id === replay.invoiceId) as unknown as { financiallyEffectiveVersionId: string })
        .financiallyEffectiveVersionId,
    );
    expect(stateSnapshot(store).invoices).toEqual(afterLoss.invoices);
    expect(committed.invoices.find((invoice) => invoice.id === success.invoiceId)).toBeTruthy();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("activation rejects stale/extra/drift requests before any Invoice fact", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-invoice-closed", [unit("closed-line", "labor", 10_000, 0)]);
  const before = stateSnapshot(store);
  await expect(activateMockQuickInvoiceSnapshot({
    orderId: "qbo-invoice-closed",
    expectedRevision: before.revision - 1,
    mutationId: "invoice-stale",
  }, frontdeskActor, store)).rejects.toThrow(/revision|version|版本|刷新/i);
  expect(stateSnapshot(store)).toEqual(before);
  await expect(activateMockQuickInvoiceSnapshot({
    orderId: "qbo-invoice-closed",
    expectedRevision: before.revision,
    mutationId: "invoice-extra",
    invoiceVersionId: "spoofed",
  } as never, frontdeskActor, store)).rejects.toThrow(/unexpected|field|字段/i);
  expect(stateSnapshot(store)).toEqual(before);
  const input = {
    orderId: "qbo-invoice-closed",
    expectedRevision: before.revision,
    mutationId: "invoice-drift",
  };
  await activateMockQuickInvoiceSnapshot(input, frontdeskActor, store);
  await expect(activateMockQuickInvoiceSnapshot({ ...input, orderId: "other-order" }, frontdeskActor, store))
    .rejects.toThrow(/mutationId|different|不同/i);
});

test("line refund binds the effective version/line across V1→V2 and rejects cross-Invoice coordinates", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-refund-v1-v2", [unit("stable-refund-line", "labor", 10_000, 0, 2)]);
  let state = stateSnapshot(store);
  const v1 = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-refund-v1-v2",
    expectedRevision: state.revision,
    mutationId: "invoice-refund-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoicePayment({
    invoiceId: v1.invoiceId,
    expectedRevision: state.revision,
    mutationId: "payment-refund-v1",
    amountJmd: 20_000,
    method: "cash",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const firstRefund = await recordMockInvoiceLineRefund({
    logicalInvoiceId: v1.invoiceId,
    invoiceVersionId: v1.invoiceVersionId,
    chargeLineId: "stable-refund-line",
    refundQuantity: 1,
    method: "cash",
    reason: "退一项工时",
    expectedRevision: state.revision,
    mutationId: "invoice-line-refund-v1",
  }, frontdeskActor, store);
  expect(firstRefund).toMatchObject({
    logicalInvoiceId: v1.invoiceId,
    invoiceVersionId: v1.invoiceVersionId,
    chargeLineId: "stable-refund-line",
    refundQuantity: 1,
    receivableReductionJmd: 10_000,
    cashRefundJmd: 10_000,
  });

  await store.mutate((draft) => {
    const order = draft.quickOrders.find((candidate) => candidate.id === "qbo-refund-v1-v2")!;
    const index = draft.quickOrders.indexOf(order);
    draft.quickOrders[index] = {
      ...order,
      chargeLines: [unit("stable-refund-line", "labor", 10_000, 0, 2)],
    };
    draft.revision += 1;
  }, { action: "test.shared-order-v2.write", consumeWriteFault: false });
  state = stateSnapshot(store);
  const v2 = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-refund-v1-v2",
    expectedRevision: state.revision,
    mutationId: "invoice-refund-v2",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await expect(recordMockInvoiceLineRefund({
    logicalInvoiceId: v1.invoiceId,
    invoiceVersionId: v1.invoiceVersionId,
    chargeLineId: "stable-refund-line",
    refundQuantity: 1,
    method: "cash",
    reason: "旧版本不允许",
    expectedRevision: state.revision,
    mutationId: "refund-old-version",
  }, frontdeskActor, store)).rejects.toThrow(/effective|current|旧版本|财务生效/i);
  expect(stateSnapshot(store)).toEqual(state);
  await expect(recordMockInvoiceLineRefund({
    logicalInvoiceId: v2.invoiceId,
    invoiceVersionId: v2.invoiceVersionId,
    chargeLineId: "stable-refund-line",
    refundQuantity: 2,
    method: "cash",
    reason: "累计数量超限",
    expectedRevision: state.revision,
    mutationId: "refund-over-quantity-v2",
  }, frontdeskActor, store)).rejects.toThrow(/quantity|数量|超过/i);
  expect(stateSnapshot(store)).toEqual(state);

  await addSharedQuickOrder(store, "qbo-refund-other", [unit("other-line", "labor", 5_000, 0)]);
  state = stateSnapshot(store);
  const other = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-refund-other",
    expectedRevision: state.revision,
    mutationId: "invoice-refund-other-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await expect(recordMockInvoiceLineRefund({
    logicalInvoiceId: other.invoiceId,
    invoiceVersionId: v2.invoiceVersionId,
    chargeLineId: "stable-refund-line",
    refundQuantity: 1,
    method: "cash",
    reason: "跨 Invoice spoof",
    expectedRevision: state.revision,
    mutationId: "refund-cross-invoice",
  }, frontdeskActor, store)).rejects.toThrow(/Invoice|version|line|版本|收费行/i);
  expect(stateSnapshot(store)).toEqual(state);
});

test("shared Invoice owner adapters expose Quick BO workspace/detail/payment and canonical file facts", async () => {
  const storage = memoryStorage();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  try {
    const store = createMockLinkedOperationsStore(storage);
    await addSharedQuickOrder(store, "qbo-billing-owner", [unit("owner-line", "labor", 10_000, 0)]);
    let state = stateSnapshot(store);
    const activated = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-billing-owner",
      expectedRevision: state.revision,
      mutationId: "invoice-owner-v1",
    }, frontdeskActor, store);

    const workspace = getMockBillingWorkspace(store);
    expect(workspace.items).toContainEqual(expect.objectContaining({
      orderId: "qbo-billing-owner",
      invoiceId: activated.invoiceId,
      invoiceVersionId: activated.invoiceVersionId,
      totalJmd: 10_000,
    }));
    const detail = getMockBillingBusinessOrder("qbo-billing-owner", store);
    expect(detail.businessOrder).toMatchObject({ id: "qbo-billing-owner" });
    if (detail.invoice.invoiceContract !== "shared_v1") {
      throw new Error("expected shared canonical Invoice detail");
    }
    expect(detail.invoice.version).toMatchObject({
      id: activated.invoiceVersionId,
      chargeContract: "shared_v1",
      snapshot: { totals: { grandTotalJmd: 10_000 } },
    });
    expect(detail.invoice.version.snapshotCommitment).toMatch(/^sha256-utf16le:/u);
    expect(stateSnapshot(store).invoiceFileHashes[activated.invoiceVersionId]).toBeUndefined();

    state = stateSnapshot(store);
    const payment = await recordMockInvoicePayment({
      invoiceId: activated.invoiceId,
      expectedRevision: state.revision,
      amountJmd: 4_000,
      method: "cash",
      mutationId: "invoice-owner-payment",
    }, frontdeskActor, store);
    expect(payment).toMatchObject({ invoiceId: activated.invoiceId, amountJmd: 4_000 });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("modern payment ledger keeps a same-millisecond post-refund payment out of the earlier refund", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:00:00-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(storage);
    await addSharedQuickOrder(store, "qbo-payment-order", [
      unit("payment-main", "labor", 15_000, 0),
      unit("payment-refund", "parts", 5_000, 0),
    ]);
    let state = stateSnapshot(store);
    const v1 = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-payment-order",
      expectedRevision: state.revision,
      mutationId: "payment-order-v1",
    }, frontdeskActor, store);
    state = stateSnapshot(store);
    const paidBefore = await recordMockInvoicePayment({
      invoiceId: v1.invoiceId,
      expectedRevision: state.revision,
      amountJmd: 10_000,
      method: "cash",
      mutationId: "payment-order-before-refund",
    }, frontdeskActor, store);
    expect(paidBefore).toMatchObject({
      paymentContract: "invoice_payment_v1",
      mutationId: "payment-order-before-refund",
      amountJmd: 10_000,
    });
    state = stateSnapshot(store);
    const refund = await recordMockInvoiceLineRefund({
      logicalInvoiceId: v1.invoiceId,
      invoiceVersionId: v1.invoiceVersionId,
      chargeLineId: "payment-refund",
      refundQuantity: 1,
      method: "cash",
      reason: "same-ms ordering",
      expectedRevision: state.revision,
      mutationId: "payment-order-refund",
    }, frontdeskActor, store);
    expect(refund).toMatchObject({ receivableReductionJmd: 5_000, cashRefundJmd: 0 });
    expect(getMockBillingBusinessOrder("qbo-payment-order", store).payment.balanceJmd).toBe(5_000);

    await store.mutate((draft) => {
      const order = draft.quickOrders.find((candidate) => candidate.id === "qbo-payment-order")!;
      if (order.chargeContract !== "shared_v1" || !Array.isArray(order.chargeLines)) {
        throw new Error("shared payment source missing");
      }
      (order as unknown as { chargeLines: QuickOrderChargeLine[] }).chargeLines = [
        ...structuredClone(order.chargeLines),
        unit("payment-v2-addition", "labor", 10_000, 0),
      ];
      draft.revision += 1;
    }, { action: "test.payment-order-v2-source.write", consumeWriteFault: false });
    state = stateSnapshot(store);
    const v2 = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-payment-order",
      expectedRevision: state.revision,
      mutationId: "payment-order-v2",
    }, frontdeskActor, store);
    state = stateSnapshot(store);
    const paidAfter = await recordMockInvoicePayment({
      invoiceId: v2.invoiceId,
      expectedRevision: state.revision,
      amountJmd: 15_000,
      method: "card",
      mutationId: "payment-order-after-refund",
    }, frontdeskActor, store);
    expect(paidAfter).toMatchObject({
      paymentContract: "invoice_payment_v1",
      mutationId: "payment-order-after-refund",
      amountJmd: 15_000,
    });
    expect(paidAfter.receivedAt).toBe(paidBefore.receivedAt);
    const refundReceipt = stateSnapshot(store).mutationReceipts.find((receipt) => receipt.mutationId === refund.mutationId)!;
    expect(paidAfter.committedRevision).toBeGreaterThan(refundReceipt.committedRevision);
    expect(getMockBillingBusinessOrder("qbo-payment-order", store).payment).toMatchObject({
      paidJmd: 25_000,
      balanceJmd: 0,
      paymentStatus: "paid",
    });

    const fresh = createMockLinkedOperationsStore(storage);
    await fresh.ready();
    expect(getMockBillingBusinessOrder("qbo-payment-order", fresh).payment.balanceJmd).toBe(0);
    expect(stateSnapshot(fresh).refunds.find((candidate) => candidate.id === refund.id)).toMatchObject({ cashRefundJmd: 0 });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("payment committed before a same-time refund counts, while a backdated later payment does not", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:00:00-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(storage);
    await addSharedQuickOrder(store, "qbo-payment-backdated", [unit("payment-backdated", "parts", 10_000, 0)]);
    let state = stateSnapshot(store);
    const v1 = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-payment-backdated",
      expectedRevision: state.revision,
      mutationId: "payment-backdated-v1",
    }, frontdeskActor, store);
    state = stateSnapshot(store);
    await recordMockInvoicePayment({
      invoiceId: v1.invoiceId,
      expectedRevision: state.revision,
      amountJmd: 8_000,
      method: "cash",
      mutationId: "payment-backdated-before",
    }, frontdeskActor, store);
    state = stateSnapshot(store);
    const refund = await recordMockInvoiceLineRefund({
      logicalInvoiceId: v1.invoiceId,
      invoiceVersionId: v1.invoiceVersionId,
      chargeLineId: "payment-backdated",
      refundQuantity: 1,
      method: "cash",
      reason: "same-time prior payment",
      expectedRevision: state.revision,
      mutationId: "payment-backdated-refund",
    }, frontdeskActor, store);
    expect(refund).toMatchObject({ receivableReductionJmd: 10_000, cashRefundJmd: 8_000 });

    await store.mutate((draft) => {
      const order = draft.quickOrders.find((candidate) => candidate.id === "qbo-payment-backdated")!;
      if (order.chargeContract !== "shared_v1" || !Array.isArray(order.chargeLines)) {
        throw new Error("shared payment source missing");
      }
      (order as unknown as { chargeLines: QuickOrderChargeLine[] }).chargeLines = [
        ...structuredClone(order.chargeLines),
        unit("payment-backdated-v2", "labor", 5_000, 0),
      ];
      draft.revision += 1;
    }, { action: "test.payment-backdated-v2-source.write", consumeWriteFault: false });
    state = stateSnapshot(store);
    const v2 = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-payment-backdated",
      expectedRevision: state.revision,
      mutationId: "payment-backdated-v2",
    }, frontdeskActor, store);
    scenario.nowMs = Date.parse("2026-08-21T11:00:00-05:00");
    state = stateSnapshot(store);
    await recordMockInvoicePayment({
      invoiceId: v2.invoiceId,
      expectedRevision: state.revision,
      amountJmd: 5_000,
      method: "cash",
      mutationId: "payment-backdated-after",
    }, frontdeskActor, store);
    expect(stateSnapshot(store).refunds.find((candidate) => candidate.id === refund.id)).toMatchObject({ cashRefundJmd: 8_000 });
    const fresh = createMockLinkedOperationsStore(storage);
    await fresh.ready();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("modern payment fact and receipt revisions are closed and bidirectionally bound", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-payment-binding", [unit("payment-binding", "labor", 10_000, 0)]);
  let state = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-payment-binding",
    expectedRevision: state.revision,
    mutationId: "payment-binding-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const input = {
    invoiceId: activated.invoiceId,
    expectedRevision: state.revision,
    amountJmd: 3_000,
    method: "cash",
    mutationId: "payment-binding-payment",
  } as const;
  const payment = await recordMockInvoicePayment(input, frontdeskActor, store);
  const afterFirst = stateSnapshot(store);
  const replay = await recordMockInvoicePayment(input, frontdeskActor, store);
  expect(replay).toEqual(payment);
  expect(stateSnapshot(store)).toEqual(afterFirst);
  expect(afterFirst.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId)).toHaveLength(1);

  const factDrift = structuredClone(afterFirst);
  const driftedFact = factDrift.payments.find((candidate) => candidate.id === payment.id)!;
  (driftedFact as unknown as { committedRevision: number }).committedRevision += 1;
  expect.soft(() => validateLinkedOperationsState(factDrift)).toThrow(/payment|receipt|revision|付款|回执|修订/i);

  const receiptDrift = structuredClone(afterFirst);
  const driftedReceipt = receiptDrift.mutationReceipts.find((receipt) => receipt.mutationId === input.mutationId)!;
  (driftedReceipt as unknown as { committedRevision: number }).committedRevision += 1;
  expect.soft(() => validateLinkedOperationsState(receiptDrift)).toThrow(/payment|receipt|revision|付款|回执|修订/i);
});

test("payment request is a closed immutable DTO with safe money, method, note, and mutation identity", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-payment-closed", [unit("payment-closed", "labor", 10_000, 0)]);
  let state = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-payment-closed",
    expectedRevision: state.revision,
    mutationId: "payment-closed-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const base = {
    invoiceId: activated.invoiceId,
    expectedRevision: state.revision,
    mutationId: "payment-closed-payment",
    amountJmd: 3_000,
    method: "cash",
    note: "deposit",
  } as const;
  const before = stateSnapshot(store);
  const accessor = { ...base } as Record<string, unknown>;
  Object.defineProperty(accessor, "note", { enumerable: true, get: () => "hidden" });
  const invalidInputs: unknown[] = [
    { ...base, extra: true },
    accessor,
    { ...base, note: undefined },
    { ...base, amountJmd: 1.5 },
    { ...base, amountJmd: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, method: " " },
    { ...base, note: " " },
    { ...base, mutationId: " " },
    { ...base, mutationId: [] },
  ];
  for (const invalid of invalidInputs) {
    await expect(recordMockInvoicePayment(invalid as never, frontdeskActor, store)).rejects.toMatchObject({ status: 400 });
    expect(stateSnapshot(store)).toEqual(before);
  }
  const input = structuredClone(base);
  const inputBefore = structuredClone(input);
  await recordMockInvoicePayment(input, frontdeskActor, store);
  expect(input).toEqual(inputBefore);
});

test("payment role is server-authorized and exact replay rechecks a revoked actor before receipt lookup", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-payment-role", [unit("payment-role", "parts", 10_000, 0)]);
  let state = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-payment-role",
    expectedRevision: state.revision,
    mutationId: "payment-role-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const input = {
    invoiceId: activated.invoiceId,
    expectedRevision: state.revision,
    mutationId: "payment-role-payment",
    amountJmd: 3_000,
    method: "cash",
  } as const;
  const beforeDenied = stateSnapshot(store);
  await expect(recordMockInvoicePayment(input, {
    id: "emp-004",
    name: "mechanic",
    role: "mechanic",
  } as never, store)).rejects.toMatchObject({ status: 403 });
  expect(stateSnapshot(store)).toEqual(beforeDenied);

  await recordMockInvoicePayment(input, frontdeskActor, store);
  await store.mutate((draft) => {
    draft.trustedIdentities = draft.trustedIdentities.filter((identity) => identity.id !== frontdeskActor.id);
    draft.revision += 1;
  }, { action: "test.payment-revoke-actor.write", consumeWriteFault: false });
  const beforeReplay = stateSnapshot(store);
  await expect(recordMockInvoicePayment(input, frontdeskActor, store)).rejects.toMatchObject({ status: 403 });
  expect(stateSnapshot(store)).toEqual(beforeReplay);
});

test("payment actor, time, id, method, note, amount, audit, result, and receipt are tamper-evident", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-payment-tamper", [unit("payment-tamper", "parts", 10_000, 0)]);
  let state = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-payment-tamper",
    expectedRevision: state.revision,
    mutationId: "payment-tamper-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const payment = await recordMockInvoicePayment({
    invoiceId: activated.invoiceId,
    expectedRevision: state.revision,
    mutationId: "payment-tamper-payment",
    amountJmd: 3_000,
    method: "cash",
    note: "deposit",
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  const mutations: Array<[string, (draft: LinkedOperationsState) => void]> = [
    ["amount", (draft) => { (draft.payments.find((fact) => fact.id === payment.id)! as unknown as { amountJmd: number }).amountJmd += 1; }],
    ["method", (draft) => { (draft.payments.find((fact) => fact.id === payment.id)! as unknown as { method: string }).method = "card"; }],
    ["note", (draft) => { (draft.payments.find((fact) => fact.id === payment.id)! as unknown as { note: string }).note = "drift"; }],
    ["actor name", (draft) => { (draft.payments.find((fact) => fact.id === payment.id)! as unknown as { receivedBy: string }).receivedBy = "spoof"; }],
    ["actor id", (draft) => { (draft.payments.find((fact) => fact.id === payment.id)! as unknown as { receivedById: string }).receivedById = "spoof"; }],
    ["time", (draft) => { (draft.payments.find((fact) => fact.id === payment.id)! as unknown as { receivedAt: string }).receivedAt = "2026-08-20T10:00:00-05:00"; }],
    ["id", (draft) => { (draft.payments.find((fact) => fact.id === payment.id)! as unknown as { id: string }).id = "spoof"; }],
    ["audit", (draft) => { (draft.billingAuditEvents.find((event) => event.mutationId === payment.mutationId)! as unknown as { amountJmd: number }).amountJmd += 1; }],
    ["receipt result", (draft) => {
      const receipt = draft.mutationReceipts.find((candidate) => candidate.mutationId === payment.mutationId)!;
      (receipt.result as { amountJmd: number }).amountJmd += 1;
    }],
  ];
  for (const [label, mutate] of mutations) {
    const corrupted = structuredClone(canonical);
    mutate(corrupted);
    expect.soft(() => validateLinkedOperationsState(corrupted), label)
      .toThrow(/payment|audit|receipt|billing|付款|审计|回执/i);
  }
});

test("activation, payment, and refund actors resolve from the canonical staff catalog", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-billing-actor-catalog", [
    unit("billing-actor-catalog-line", "labor", 5_000, 0, 2),
  ]);
  let state = stateSnapshot(store);
  const activationInput = {
    orderId: "qbo-billing-actor-catalog",
    expectedRevision: state.revision,
    mutationId: "billing-actor-catalog-activation",
  };
  await expect(activateMockQuickInvoiceSnapshot(
    activationInput,
    { ...frontdeskActor, name: "伪造操作员" },
    store,
  )).rejects.toMatchObject({ status: 403 });
  await expect(activateMockQuickInvoiceSnapshot(
    activationInput,
    financeActor as never,
    store,
  )).rejects.toMatchObject({ status: 403 });
  expect(stateSnapshot(store)).toEqual(state);
  const activation = await activateMockQuickInvoiceSnapshot(activationInput, frontdeskActor, store);

  state = stateSnapshot(store);
  const paymentInput = {
    invoiceId: activation.invoiceId,
    expectedRevision: state.revision,
    mutationId: "billing-actor-catalog-payment",
    amountJmd: 3_000,
    method: "cash",
  };
  await expect(recordMockInvoicePayment(
    paymentInput,
    { ...frontdeskActor, role: "finance" },
    store,
  )).rejects.toMatchObject({ status: 403 });
  await expect(recordMockInvoicePayment(
    paymentInput,
    financeActor as never,
    store,
  )).rejects.toMatchObject({ status: 403 });
  expect(stateSnapshot(store)).toEqual(state);
  const payment = await recordMockInvoicePayment(paymentInput, frontdeskActor, store);

  state = stateSnapshot(store);
  const refundInput = {
    logicalInvoiceId: activation.invoiceId,
    invoiceVersionId: activation.invoiceVersionId,
    chargeLineId: "billing-actor-catalog-line",
    refundQuantity: 1,
    method: "cash",
    reason: "catalog provenance",
    expectedRevision: state.revision,
    mutationId: "billing-actor-catalog-refund",
  };
  await expect(recordMockInvoiceLineRefund(
    refundInput,
    { id: "emp-unknown", name: "Unknown Actor", role: "frontdesk_admin" },
    store,
  )).rejects.toMatchObject({ status: 403 });
  await expect(recordMockInvoiceLineRefund(
    refundInput,
    financeActor as never,
    store,
  )).rejects.toMatchObject({ status: 403 });
  expect(stateSnapshot(store)).toEqual(state);
  const refund = await recordMockInvoiceLineRefund(refundInput, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();

  const coordinateActor = (
    draft: LinkedOperationsState,
    mutationId: string,
    actorId: string,
    actorName: string,
  ) => {
    const receipt = draft.mutationReceipts.find((candidate) => candidate.mutationId === mutationId)!;
    (receipt as unknown as { actorId: string }).actorId = actorId;
    const audit = draft.billingAuditEvents.find((candidate) => candidate.mutationId === mutationId)!;
    Object.assign(audit as unknown as Record<string, unknown>, { actorId, actorName });
    if (mutationId === payment.mutationId) {
      const fact = draft.payments.find((candidate) => candidate.id === payment.id)!;
      Object.assign(fact as unknown as Record<string, unknown>, { receivedById: actorId, receivedBy: actorName });
      Object.assign(receipt.result as Record<string, unknown>, { receivedById: actorId, receivedBy: actorName });
    }
    if (mutationId === refund.mutationId) {
      const fact = draft.refunds.find((candidate) => candidate.id === refund.id)!;
      Object.assign(fact as unknown as Record<string, unknown>, { actorId, actorName });
      Object.assign(receipt.result as Record<string, unknown>, { actorId, actorName });
    }
  };
  const actorMutations = [
    { actorId: frontdeskActor.id, actorName: "伪造操作员" },
    { actorId: financeActor.id, actorName: financeActor.name },
    { actorId: "emp-005", actorName: "Marcus Brown" },
    { actorId: "emp-unknown", actorName: "Unknown Actor" },
  ];
  for (const mutationId of [activationInput.mutationId, payment.mutationId, refund.mutationId]) {
    for (const mutation of actorMutations) {
      const drifted = structuredClone(canonical);
      coordinateActor(drifted, mutationId, mutation.actorId, mutation.actorName);
      expect(() => validateLinkedOperationsState(drifted)).toThrow(/ACTOR|actor|billing|audit|账号|操作员/i);
    }
  }
});

test("public identity lists cannot mutate the canonical Task8 actor catalog", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-catalog-isolation", [
    unit("qbo-catalog-isolation-line", "labor", 5_000, 0),
  ]);
  const before = stateSnapshot(store);
  const exposed = mockIdentities();
  const original = structuredClone(exposed);
  const frontdesk = exposed.find((identity) => identity.id === frontdeskActor.id)!;
  const injectedIdentity = {
    ...structuredClone(frontdesk),
    id: "emp-catalog-injected",
    name: "Injected Frontdesk",
    role: "frontdesk_admin" as const,
  };
  const injectedActor = {
    id: injectedIdentity.id,
    name: injectedIdentity.name,
    role: injectedIdentity.role,
  };
  try {
    frontdesk.name = "被公开列表污染";
    exposed.push(injectedIdentity);
    expect(mockIdentities().find((identity) => identity.id === frontdeskActor.id)?.name).toBe(frontdeskActor.name);
    expect(canonicalBillingActorIdentity("billing.invoice.activate", frontdeskActor.id)).toEqual(frontdeskActor);
    expect(canonicalBillingActorIdentity("billing.invoice.activate", "emp-catalog-injected")).toBeNull();
    await expect(activateMockQuickInvoiceSnapshot({
      orderId: "qbo-catalog-isolation",
      expectedRevision: before.revision,
      mutationId: "catalog-injected-activation",
    }, injectedActor, store)).rejects.toMatchObject({ status: 403 });
    expect(stateSnapshot(store)).toEqual(before);
  } finally {
    exposed.splice(0, exposed.length, ...original);
  }
});

test("payment validation replays the balance at its committed revision against coordinated amount drift", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-payment-balance-replay", [unit("payment-balance-replay", "labor", 10_000, 0)]);
  let state = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-payment-balance-replay",
    expectedRevision: state.revision,
    mutationId: "payment-balance-replay-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const payment = await recordMockInvoicePayment({
    invoiceId: activated.invoiceId,
    expectedRevision: state.revision,
    mutationId: "payment-balance-replay-payment",
    amountJmd: 3_000,
    method: "cash",
  }, frontdeskActor, store);
  const corrupted = stateSnapshot(store);
  (corrupted.payments.find((fact) => fact.id === payment.id)! as unknown as { amountJmd: number }).amountJmd = 11_000;
  (corrupted.billingAuditEvents.find((event) => event.mutationId === payment.mutationId)! as unknown as { amountJmd: number }).amountJmd = 11_000;
  const receipt = corrupted.mutationReceipts.find((candidate) => candidate.mutationId === payment.mutationId)!;
  const payload = JSON.parse(receipt.payloadCanonical!) as Record<string, unknown>;
  payload.amountJmd = 11_000;
  const payloadCanonical = JSON.stringify(payload);
  (receipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadCanonical = payloadCanonical;
  (receipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadHash = mutationPayloadHash(payloadCanonical);
  (receipt.result as { amountJmd: number }).amountJmd = 11_000;
  expect(() => validateLinkedOperationsState(corrupted)).toThrow(/payment|balance|amount|ledger|付款|余额|金额/i);
});

test("legacy formal Invoice opening ledger also caps each modern payment at its committed balance", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  const before = stateSnapshot(store);
  const invoice = before.invoices.find((candidate) => candidate.id === "invoice-demo-01")!;
  const payment = await recordMockInvoicePayment({
    invoiceId: invoice.id,
    expectedRevision: before.revision,
    mutationId: "legacy-payment-balance-replay",
    amountJmd: 3_000,
    method: "cash",
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();
  const corrupted = structuredClone(canonical);
  const spoofedAmountJmd = 16_000;
  (corrupted.payments.find((fact) => fact.id === payment.id)! as unknown as { amountJmd: number }).amountJmd = spoofedAmountJmd;
  (corrupted.billingAuditEvents.find((event) => event.mutationId === payment.mutationId)! as unknown as { amountJmd: number }).amountJmd = spoofedAmountJmd;
  const receipt = corrupted.mutationReceipts.find((candidate) => candidate.mutationId === payment.mutationId)!;
  const payload = JSON.parse(receipt.payloadCanonical!) as Record<string, unknown>;
  payload.amountJmd = spoofedAmountJmd;
  const payloadCanonical = JSON.stringify(payload);
  (receipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadCanonical = payloadCanonical;
  (receipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadHash = mutationPayloadHash(payloadCanonical);
  (receipt.result as { amountJmd: number }).amountJmd = spoofedAmountJmd;
  expect(() => validateLinkedOperationsState(corrupted)).toThrow(/payment|balance|amount|legacy|付款|余额|金额/i);
});

test("shared Invoice rejects discriminator-absent legacy payment even when its timestamp is backdated before activation", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-payment-legacy-spoof", [unit("payment-legacy-spoof", "parts", 10_000, 0)]);
  const state = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-payment-legacy-spoof",
    expectedRevision: state.revision,
    mutationId: "payment-legacy-spoof-v1",
  }, frontdeskActor, store);
  const corrupted = stateSnapshot(store);
  const invoice = corrupted.invoices.find((candidate) => candidate.id === activated.invoiceId) as SharedChargeInvoice;
  corrupted.payments.push({
    id: "legacy-payment-backdated-spoof",
    invoiceId: activated.invoiceId,
    amountJmd: 1_000,
    receivedAt: new Date(Date.parse(invoice.versions[0]!.issuedAt) - 1_000).toISOString(),
  });
  expect(() => validateLinkedOperationsState(corrupted)).toThrow(/legacy|shared|payment|provenance|付款|来源/i);
});

test("payment write fault leaves no fact and response loss or concurrency commits exactly once", async () => {
  const scenario: { failNext: { byAction: Record<string, string> } } = {
    failNext: { byAction: { "billing.invoice.payment.write": "payment write fault" } },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(storage);
    await addSharedQuickOrder(store, "qbo-payment-fault", [unit("payment-fault", "labor", 20_000, 0)]);
    let state = stateSnapshot(store);
    const activated = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-payment-fault",
      expectedRevision: state.revision,
      mutationId: "payment-fault-v1",
    }, frontdeskActor, store);
    state = stateSnapshot(store);
    const input = {
      invoiceId: activated.invoiceId,
      expectedRevision: state.revision,
      mutationId: "payment-fault-payment",
      amountJmd: 3_000,
      method: "cash",
    } as const;
    const beforeFault = stateSnapshot(store);
    await expect(recordMockInvoicePayment(input, frontdeskActor, store)).rejects.toThrow(/write fault|写入/i);
    expect(stateSnapshot(store)).toEqual(beforeFault);
    const afterRetry = await recordMockInvoicePayment(input, frontdeskActor, store);

    scenario.failNext.byAction["billing.invoice.payment.response"] = "payment response loss";
    state = stateSnapshot(store);
    const responseInput = {
      ...input,
      expectedRevision: state.revision,
      mutationId: "payment-response-loss",
      amountJmd: 2_000,
    } as const;
    await expect(recordMockInvoicePayment(responseInput, frontdeskActor, store)).rejects.toThrow(/response loss|响应/i);
    const afterLoss = stateSnapshot(store);
    const replay = await recordMockInvoicePayment(responseInput, frontdeskActor, store);
    expect(replay).toEqual(afterLoss.payments.find((fact) => fact.mutationId === responseInput.mutationId));
    expect(stateSnapshot(store)).toEqual(afterLoss);

    state = stateSnapshot(store);
    const concurrent = await Promise.allSettled([
      recordMockInvoicePayment({ ...input, expectedRevision: state.revision, mutationId: "payment-concurrent-a", amountJmd: 1_000 }, frontdeskActor, store),
      recordMockInvoicePayment({ ...input, expectedRevision: state.revision, mutationId: "payment-concurrent-b", amountJmd: 1_000 }, frontdeskActor, store),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    const final = stateSnapshot(store);
    expect(final.payments.filter((fact) => fact.mutationId?.startsWith("payment-concurrent-"))).toHaveLength(1);
    expect(final.billingAuditEvents.filter((event) => event.mutationId.startsWith("payment-concurrent-"))).toHaveLength(1);
    expect(final.mutationReceipts.filter((receipt) => receipt.mutationId.startsWith("payment-concurrent-"))).toHaveLength(1);
    expect(final.payments).toContainEqual(afterRetry);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("shared Invoice financially-effective pointer cannot be flipped back from latest V2 to V1", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-effective-latest", [unit("latest-line", "labor", 10_000, 0)]);
  let state = stateSnapshot(store);
  const v1 = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-effective-latest",
    expectedRevision: state.revision,
    mutationId: "invoice-effective-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const v2 = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-effective-latest",
    expectedRevision: state.revision,
    mutationId: "invoice-effective-v2",
  }, frontdeskActor, store);
  const before = stateSnapshot(store);
  await expect(store.mutate((draft) => {
    const invoice = draft.invoices.find((candidate) => candidate.id === v2.invoiceId)!;
    (invoice as unknown as { financiallyEffectiveVersionId: string }).financiallyEffectiveVersionId = v1.invoiceVersionId;
    draft.revision += 1;
  }, { action: "test.effective-pointer.write", consumeWriteFault: false })).rejects.toThrow(/effective|latest|validation|生效|版本/i);
  expect(stateSnapshot(store)).toEqual(before);
});

test("billing discriminators fail closed while own-key-absent seeded legacy Invoices remain valid", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-billing-tags", [unit("tag-line", "labor", 10_000, 0)]);
  let state = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-billing-tags",
    expectedRevision: state.revision,
    mutationId: "invoice-tags-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoiceLineRefund({
    logicalInvoiceId: activated.invoiceId,
    invoiceVersionId: activated.invoiceVersionId,
    chargeLineId: "tag-line",
    refundQuantity: 1,
    method: "cash",
    reason: "tag validation",
    expectedRevision: state.revision,
    mutationId: "invoice-tags-refund",
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();
  expect(canonical.invoices.some((invoice) => !Object.prototype.hasOwnProperty.call(invoice, "invoiceContract"))).toBe(true);

  for (const mutate of [
    (draft: LinkedOperationsState) => {
      (draft.invoices.find((invoice) => invoice.id === activated.invoiceId) as unknown as { invoiceContract: string }).invoiceContract = "bogus";
    },
    (draft: LinkedOperationsState) => {
      const invoice = draft.invoices.find((candidate) => candidate.id === activated.invoiceId)!;
      (invoice.versions[0] as unknown as { chargeContract: string }).chargeContract = "bogus";
    },
    (draft: LinkedOperationsState) => {
      (draft.refunds.find((refund) => refund.refundContract === "ordinary_line_v1") as unknown as { refundContract: string }).refundContract = "bogus";
    },
  ]) {
    const corrupted = structuredClone(canonical);
    mutate(corrupted);
    expect(() => validateLinkedOperationsState(corrupted)).toThrow();
  }
});

test("billing validator closes activation signature, audit, receipt, and exact result in both directions", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-activation-bindings", [unit("binding-line", "labor", 10_000, 2_001)]);
  const before = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-activation-bindings",
    expectedRevision: before.revision,
    mutationId: "activation-bindings-v1",
    signature: { rawStrokes: INVOICE_STROKES },
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);

  const withoutAudit = structuredClone(canonical);
  withoutAudit.billingAuditEvents = withoutAudit.billingAuditEvents.filter((event) => event.mutationId !== "activation-bindings-v1");
  expect.soft(() => validateLinkedOperationsState(withoutAudit)).toThrow(/audit|activation|billing|审计/i);

  const withoutReceipt = structuredClone(canonical);
  withoutReceipt.mutationReceipts = withoutReceipt.mutationReceipts.filter((receipt) => receipt.mutationId !== "activation-bindings-v1");
  expect.soft(() => validateLinkedOperationsState(withoutReceipt)).toThrow(/receipt|activation|mutation|回执/i);

  const withoutSignature = structuredClone(canonical);
  withoutSignature.discountSignatureEvents = withoutSignature.discountSignatureEvents.filter((event) => event.mutationId !== "activation-bindings-v1");
  expect.soft(() => validateLinkedOperationsState(withoutSignature)).toThrow(/signature|discount|签字|优惠/i);

  const driftedResult = structuredClone(canonical);
  const receipt = driftedResult.mutationReceipts.find((candidate) => candidate.mutationId === "activation-bindings-v1")!;
  (receipt.result as { invoiceVersionId: string }).invoiceVersionId = `${activated.invoiceVersionId}-spoof`;
  expect.soft(() => validateLinkedOperationsState(driftedResult)).toThrow(/result|version|receipt|结果|版本/i);
});

test("billing validator recomputes a modern refund from its original source version even after V2 repricing", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-refund-source", [unit("source-line", "parts", 8_000, 0, 2)]);
  let state = stateSnapshot(store);
  const v1 = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-refund-source",
    expectedRevision: state.revision,
    mutationId: "refund-source-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoicePayment({
    invoiceId: v1.invoiceId,
    expectedRevision: state.revision,
    mutationId: "refund-source-payment",
    amountJmd: 16_000,
    method: "cash",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoiceLineRefund({
    logicalInvoiceId: v1.invoiceId,
    invoiceVersionId: v1.invoiceVersionId,
    chargeLineId: "source-line",
    refundQuantity: 1,
    method: "cash",
    reason: "V1 source price",
    expectedRevision: state.revision,
    mutationId: "refund-source-fact",
  }, frontdeskActor, store);
  await store.mutate((draft) => {
    const order = draft.quickOrders.find((candidate) => candidate.id === "qbo-refund-source")!;
    draft.quickOrders[draft.quickOrders.indexOf(order)] = { ...order, chargeLines: [unit("source-line", "parts", 5_000, 0, 2)] };
    draft.revision += 1;
  }, { action: "test.refund-source-v2-price.write", consumeWriteFault: false });
  state = stateSnapshot(store);
  await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-refund-source",
    expectedRevision: state.revision,
    mutationId: "refund-source-v2",
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();

  const corrupted = structuredClone(canonical);
  const refund = corrupted.refunds.find((candidate) => candidate.refundContract === "ordinary_line_v1")!;
  const mutableRefund = refund as unknown as { receivableReductionJmd: number; cashRefundJmd: number };
  mutableRefund.receivableReductionJmd = 7_999;
  mutableRefund.cashRefundJmd = 7_999;
  const audit = corrupted.billingAuditEvents.find((event) => event.operation === "invoice_line_refund")!;
  const mutableAudit = audit as unknown as { receivableReductionJmd: number; cashRefundJmd: number };
  mutableAudit.receivableReductionJmd = 7_999;
  mutableAudit.cashRefundJmd = 7_999;
  const receipt = corrupted.mutationReceipts.find((candidate) => candidate.mutationId === "refund-source-fact")!;
  (receipt.result as { receivableReductionJmd: number; cashRefundJmd: number }).receivableReductionJmd = 7_999;
  (receipt.result as { receivableReductionJmd: number; cashRefundJmd: number }).cashRefundJmd = 7_999;
  expect(() => validateLinkedOperationsState(corrupted)).toThrow(/source|quantity|refund|amount|原版本|退款|金额/i);
});

test("every unchanged high-discount Invoice version requires a fresh signature and exact replay adds nothing", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-repeat-signature", [unit("repeat-high", "labor", 10_000, 2_001)]);
  let state = stateSnapshot(store);
  await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-repeat-signature",
    expectedRevision: state.revision,
    mutationId: "repeat-signature-v1",
    signature: { rawStrokes: INVOICE_STROKES },
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const v2Input = {
    orderId: "qbo-repeat-signature",
    expectedRevision: state.revision,
    mutationId: "repeat-signature-v2",
  };
  await expect(activateMockQuickInvoiceSnapshot(v2Input, frontdeskActor, store)).rejects.toThrow(/signature|签字|笔迹/i);
  expect(stateSnapshot(store)).toEqual(state);
  const v2 = await activateMockQuickInvoiceSnapshot({
    ...v2Input,
    signature: { rawStrokes: OTHER_INVOICE_STROKES },
  }, frontdeskActor, store);
  const after = stateSnapshot(store);
  expect(after.discountSignatureEvents.filter((event) => event.document.kind === "invoice")).toHaveLength(2);
  expect(await activateMockQuickInvoiceSnapshot({
    ...v2Input,
    signature: { rawStrokes: OTHER_INVOICE_STROKES },
  }, frontdeskActor, store)).toEqual(v2);
  expect(stateSnapshot(store)).toEqual(after);
});

test("closed billing DTOs and invocation-time role recheck reject accessors, hidden array keys, undefined, and stale roles atomically", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-closed-api", [unit("closed-api-line", "labor", 10_000, 0)]);
  const before = stateSnapshot(store);
  const base = { orderId: "qbo-closed-api", expectedRevision: before.revision, mutationId: "closed-api" };

  const accessor = { ...base } as Record<string, unknown>;
  Object.defineProperty(accessor, "expectedRevision", { enumerable: true, get: () => before.revision });
  await expect(activateMockQuickInvoiceSnapshot(accessor as never, frontdeskActor, store)).rejects.toThrow(/accessor|访问器|字段/i);
  expect(stateSnapshot(store)).toEqual(before);

  await expect(activateMockQuickInvoiceSnapshot({ ...base, mutationId: undefined } as never, frontdeskActor, store))
    .rejects.toThrow(/undefined|字段/i);
  expect(stateSnapshot(store)).toEqual(before);

  const strokes = [[{ x: 1, y: 1, time: 1 }]] as Array<Array<{ x: number; y: number; time: number }>>;
  Object.defineProperty(strokes, "hidden", { enumerable: false, value: "spoof" });
  await expect(activateMockQuickInvoiceSnapshot({ ...base, signature: { rawStrokes: strokes } }, frontdeskActor, store))
    .rejects.toThrow(/unexpected|hidden|隐藏|field/i);
  expect(stateSnapshot(store)).toEqual(before);

  await expect(activateMockQuickInvoiceSnapshot(base, { ...frontdeskActor, role: "finance" }, store))
    .rejects.toThrow(/permission|role|权限|账号/i);
  expect(stateSnapshot(store)).toEqual(before);
});

test("exact activation replay rechecks the caller role inside the lock before returning its receipt", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-replay-role-activation", [unit("replay-role-activation", "labor", 10_000, 0)]);
  const before = stateSnapshot(store);
  const input = {
    orderId: "qbo-replay-role-activation",
    expectedRevision: before.revision,
    mutationId: "replay-role-activation-v1",
  };
  await activateMockQuickInvoiceSnapshot(input, frontdeskActor, store);
  await store.mutate((draft) => {
    draft.trustedIdentities = draft.trustedIdentities.filter((identity) => identity.id !== frontdeskActor.id);
    draft.revision += 1;
  }, { action: "test.revoke-activation-actor.write", consumeWriteFault: false });
  const revoked = stateSnapshot(store);

  await expect(activateMockQuickInvoiceSnapshot(input, frontdeskActor, store))
    .rejects.toThrow(/permission|role|trusted|权限|账号/i);
  expect(stateSnapshot(store)).toEqual(revoked);
});

test("exact line-refund replay rechecks the caller role inside the lock before returning its receipt", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-replay-role-refund", [unit("replay-role-refund", "parts", 8_000, 0)]);
  let state = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-replay-role-refund",
    expectedRevision: state.revision,
    mutationId: "replay-role-refund-activation",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const input = {
    logicalInvoiceId: activated.invoiceId,
    invoiceVersionId: activated.invoiceVersionId,
    chargeLineId: "replay-role-refund",
    refundQuantity: 1,
    method: "cash",
    reason: "role replay",
    expectedRevision: state.revision,
    mutationId: "replay-role-refund-v1",
  };
  await recordMockInvoiceLineRefund(input, frontdeskActor, store);
  await store.mutate((draft) => {
    draft.trustedIdentities = draft.trustedIdentities.map((identity) => (
      identity.id === frontdeskActor.id ? { ...identity, role: "mechanic" as const } : identity
    ));
    draft.revision += 1;
  }, { action: "test.downgrade-refund-actor.write", consumeWriteFault: false });
  const revoked = stateSnapshot(store);

  await expect(recordMockInvoiceLineRefund(input, frontdeskActor, store))
    .rejects.toThrow(/permission|role|trusted|权限|账号/i);
  expect(stateSnapshot(store)).toEqual(revoked);
});

test("shared Invoice numbers use the approved Jamaica-date format and skip an existing collision", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:34:56-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(storage);
    await addSharedQuickOrder(store, "qbo-approved-invoice-no", [unit("approved-invoice-no", "labor", 10_000, 0)]);
    await store.mutate((draft) => {
      const seededFirst = draft.invoices[0];
      const seededSecond = draft.invoices[1];
      if (!seededFirst || !seededSecond) throw new Error("seed Invoices missing");
      draft.invoices[0] = { ...seededFirst, invoiceNo: "KGN-WH-INV-2026082110000" };
      draft.invoices[1] = { ...seededSecond, invoiceNo: "KGN-WH-INV-2026082110002" };
      const sequence = draft.billingDocumentSequences.find((candidate) => candidate.businessDate === "20260821");
      if (sequence) sequence.lastAllocated = Math.max(sequence.lastAllocated, 10_002);
      else draft.billingDocumentSequences.push({
          id: "invoice:KGN:WH:20260821",
          kind: "invoice",
          branchCode: "KGN",
          brandCode: "WH",
          businessDate: "20260821",
          lastAllocated: 10_002,
        });
      draft.revision += 1;
    }, { action: "test.seed-invoice-number-collision.write", consumeWriteFault: false });
    const state = stateSnapshot(store);
    const activated = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-approved-invoice-no",
      expectedRevision: state.revision,
      mutationId: "approved-invoice-no-v1",
    }, frontdeskActor, store);
    const invoice = stateSnapshot(store).invoices.find((candidate) => candidate.id === activated.invoiceId)!;
    expect(invoice.invoiceNo).toBe("KGN-WH-INV-2026082110003");
    expect(invoice.invoiceNo).toMatch(/^KGN-WH-INV-\d{13}$/u);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("concurrent shared Invoice activation conflicts cleanly then retries to a unique locked number", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:34:56-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(storage);
    await addSharedQuickOrder(store, "qbo-number-race-a", [unit("number-race-a", "labor", 10_000, 0)]);
    await addSharedQuickOrder(store, "qbo-number-race-b", [unit("number-race-b", "labor", 10_000, 0)]);
    const expectedRevision = stateSnapshot(store).revision;
    const inputs = [
      { orderId: "qbo-number-race-a", expectedRevision, mutationId: "number-race-a-v1" },
      { orderId: "qbo-number-race-b", expectedRevision, mutationId: "number-race-b-v1" },
    ] as const;
    const raced = await Promise.allSettled(inputs.map((input) => (
      activateMockQuickInvoiceSnapshot(input, frontdeskActor, store)
    )));
    expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(raced.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejectedIndex = raced.findIndex((result) => result.status === "rejected");
    await activateMockQuickInvoiceSnapshot({
      ...inputs[rejectedIndex],
      expectedRevision: stateSnapshot(store).revision,
    }, frontdeskActor, store);
    const numbers = stateSnapshot(store).invoices
      .filter((invoice) => invoice.businessOrderId === "qbo-number-race-a" || invoice.businessOrderId === "qbo-number-race-b")
      .map((invoice) => invoice.invoiceNo);
    expect(numbers).toHaveLength(2);
    expect(new Set(numbers).size).toBe(2);
    expect(numbers.every((number) => /^KGN-WH-INV-20260821\d{5}$/u.test(number))).toBe(true);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("Invoice sequence high-water survives write faults and response-loss replay without gaps or reuse", async () => {
  const scenario: {
    nowMs: number;
    failNext: { byAction: Record<string, string> };
  } = {
    nowMs: Date.parse("2026-08-21T12:34:56-05:00"),
    failNext: { byAction: {} },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(storage);
    await store.mutate((draft) => {
      const seededFirst = draft.invoices[0];
      const seededSecond = draft.invoices[1];
      if (!seededFirst || !seededSecond) throw new Error("seed Invoices missing");
      draft.invoices[0] = { ...seededFirst, invoiceNo: "KGN-WH-INV-2026082110000" };
      draft.invoices[1] = { ...seededSecond, invoiceNo: "KGN-WH-INV-2026082110002" };
      draft.billingDocumentSequences.push({
        id: "invoice:KGN:WH:20260821",
        kind: "invoice",
        branchCode: "KGN",
        brandCode: "WH",
        businessDate: "20260821",
        lastAllocated: 10_002,
      });
      draft.revision += 1;
    }, { action: "test.seed-invoice-gap.write", consumeWriteFault: false });
    await addSharedQuickOrder(store, "qbo-sequence-fault", [unit("sequence-fault", "labor", 10_000, 0)]);
    const before = stateSnapshot(store);
    const input = {
      orderId: "qbo-sequence-fault",
      expectedRevision: before.revision,
      mutationId: "sequence-fault-v1",
    };
    scenario.failNext.byAction["billing.invoice.activate.write"] = "sequence write fault";
    await expect(activateMockQuickInvoiceSnapshot(input, frontdeskActor, store)).rejects.toThrow(/write fault|写入/i);
    expect(stateSnapshot(store)).toEqual(before);

    const first = await activateMockQuickInvoiceSnapshot(input, frontdeskActor, store);
    expect(first.invoiceNo).toBe("KGN-WH-INV-2026082110003");
    const afterFirst = stateSnapshot(store);
    expect(afterFirst.billingDocumentSequences.find((sequence) => sequence.businessDate === "20260821")?.lastAllocated).toBe(10_003);

    scenario.failNext.byAction["billing.invoice.activate.response"] = "sequence response loss";
    await expect(activateMockQuickInvoiceSnapshot(input, frontdeskActor, store)).rejects.toThrow(/response loss|响应/i);
    const afterLoss = stateSnapshot(store);
    const replay = await activateMockQuickInvoiceSnapshot(input, frontdeskActor, store);
    expect(replay).toEqual(first);
    expect(stateSnapshot(store)).toEqual(afterLoss);

    await addSharedQuickOrder(store, "qbo-sequence-next", [unit("sequence-next", "parts", 8_000, 0)]);
    const nextState = stateSnapshot(store);
    const next = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-sequence-next",
      expectedRevision: nextState.revision,
      mutationId: "sequence-next-v1",
    }, frontdeskActor, store);
    expect(next.invoiceNo).toBe("KGN-WH-INV-2026082110004");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("one shared Quick BO owns at most one logical Invoice and readers reject duplicate owners", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-one-logical-invoice", [unit("one-logical-invoice", "labor", 10_000, 0)]);
  const before = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-one-logical-invoice",
    expectedRevision: before.revision,
    mutationId: "one-logical-invoice-v1",
  }, frontdeskActor, store);
  const corrupted = stateSnapshot(store);
  const original = corrupted.invoices.find((invoice) => invoice.id === activated.invoiceId) as SharedChargeInvoice;
  corrupted.invoices.push({
    ...structuredClone(original),
    id: `${original.id}-duplicate-owner`,
    invoiceNo: `${original.invoiceNo}-DUPLICATE`,
    financiallyEffectiveVersionId: `${original.versions[0]!.id}-duplicate-owner`,
    versions: [{ ...structuredClone(original.versions[0]!), id: `${original.versions[0]!.id}-duplicate-owner` }],
  });
  expect(() => validateLinkedOperationsState(corrupted)).toThrow(/owner|Quick BO|logical|唯一|INVOICE_SHARED_OWNER/i);

  const duplicateStore = {
    ...store,
    read: <T,>(selector: (state: LinkedOperationsState) => T): T => structuredClone(selector(corrupted)),
  } as ReturnType<typeof createMockLinkedOperationsStore>;
  expect(() => getMockBillingBusinessOrder("qbo-one-logical-invoice", duplicateStore))
    .toThrow(/conflict|duplicate|owner|logical|冲突|重复|唯一/i);
});

test("legacy Invoice owner must be one formal BO that points back through invoiceIds", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-legacy-owner-spoof", [unit("legacy-owner-spoof", "labor", 10_000, 0)]);
  const canonical = stateSnapshot(store);
  const source = canonical.invoices.find((invoice) => (
    !Object.prototype.hasOwnProperty.call(invoice, "invoiceContract")
  )) as LegacyInvoice;
  const sourceVersion = source.versions[0]!;

  const quickOwnedClone = structuredClone(canonical);
  const quickClone: LegacyInvoice = {
    ...structuredClone(source),
    id: "legacy-invoice-quick-owner-spoof",
    invoiceNo: "LEGACY-QUICK-OWNER-SPOOF",
    businessOrderId: "qbo-legacy-owner-spoof",
    versions: [{ ...structuredClone(sourceVersion), id: "legacy-version-quick-owner-spoof" }],
  };
  quickOwnedClone.invoices.push(quickClone);
  quickOwnedClone.invoiceFileHashes["legacy-version-quick-owner-spoof"] = canonical.invoiceFileHashes[sourceVersion.id]!;
  expect.soft(() => validateLinkedOperationsState(quickOwnedClone))
    .toThrow(/legacy|formal|owner|invoiceIds|Business Order|反向/i);

  const missingReverse = structuredClone(canonical);
  const owner = missingReverse.businessOrders.find((order) => order.id === source.businessOrderId)!;
  (owner as unknown as { invoiceIds: string[] }).invoiceIds = owner.invoiceIds.filter((invoiceId) => invoiceId !== source.id);
  expect.soft(() => validateLinkedOperationsState(missingReverse))
    .toThrow(/legacy|formal|owner|invoiceIds|Business Order|反向/i);
});

test("Invoice version IDs are globally unique across coordinated shared and aliased legacy versions", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-version-global-a", [unit("version-global-a", "labor", 10_000, 0)]);
  await addSharedQuickOrder(store, "qbo-version-global-b", [unit("version-global-b", "parts", 8_000, 0)]);
  let state = stateSnapshot(store);
  const first = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-version-global-a",
    expectedRevision: state.revision,
    mutationId: "version-global-a-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const second = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-version-global-b",
    expectedRevision: state.revision,
    mutationId: "version-global-b-v1",
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);

  const sharedAlias = structuredClone(canonical);
  const secondInvoice = sharedAlias.invoices.find((invoice) => invoice.id === second.invoiceId)!;
  (secondInvoice.versions[0] as unknown as { id: string }).id = first.invoiceVersionId;
  (secondInvoice as unknown as { financiallyEffectiveVersionId: string }).financiallyEffectiveVersionId = first.invoiceVersionId;
  const secondAudit = sharedAlias.billingAuditEvents.find((event) => event.mutationId === "version-global-b-v1")!;
  (secondAudit as unknown as { invoiceVersionId: string }).invoiceVersionId = first.invoiceVersionId;
  const secondReceipt = sharedAlias.mutationReceipts.find((receipt) => receipt.mutationId === "version-global-b-v1")!;
  (secondReceipt.result as { invoiceVersionId: string }).invoiceVersionId = first.invoiceVersionId;
  expect.soft(() => validateLinkedOperationsState(sharedAlias))
    .toThrow(/version|global|unique|duplicate|版本|全局|重复/i);

  const legacyAlias = structuredClone(canonical);
  const legacyInvoices = legacyAlias.invoices.filter((invoice) => (
    !Object.prototype.hasOwnProperty.call(invoice, "invoiceContract")
  )) as LegacyInvoice[];
  const legacyFirst = legacyInvoices[0]!;
  const legacyDifferent = legacyInvoices.find((invoice) => (
    invoice.versions[0]?.totals.totalJmd !== legacyFirst.versions[0]?.totals.totalJmd
  ))!;
  expect(legacyDifferent).toBeTruthy();
  const legacyClone: LegacyInvoice = {
    ...structuredClone(legacyDifferent),
    id: "legacy-invoice-version-alias",
    invoiceNo: "LEGACY-VERSION-ALIAS",
    businessOrderId: legacyFirst.businessOrderId,
    versions: [{ ...structuredClone(legacyDifferent.versions[0]!), id: legacyFirst.versions[0]!.id }],
  };
  legacyAlias.invoices.push(legacyClone);
  const legacyOwner = legacyAlias.businessOrders.find((order) => order.id === legacyClone.businessOrderId)!;
  (legacyOwner as unknown as { invoiceIds: string[] }).invoiceIds = [...legacyOwner.invoiceIds, legacyClone.id];
  expect.soft(() => validateLinkedOperationsState(legacyAlias))
    .toThrow(/version|global|unique|duplicate|alias|版本|全局|重复/i);
});

test("coordinated owner tampering still cannot move a second logical Invoice onto the first Quick BO", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-owner-coordinate-a", [unit("owner-coordinate-a", "labor", 10_000, 0)]);
  await addSharedQuickOrder(store, "qbo-owner-coordinate-b", [unit("owner-coordinate-b", "parts", 8_000, 0)]);
  let state = stateSnapshot(store);
  const first = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-owner-coordinate-a",
    expectedRevision: state.revision,
    mutationId: "owner-coordinate-a-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const second = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-owner-coordinate-b",
    expectedRevision: state.revision,
    mutationId: "owner-coordinate-b-v1",
  }, frontdeskActor, store);
  const corrupted = stateSnapshot(store);
  const secondInvoice = corrupted.invoices.find((invoice) => invoice.id === second.invoiceId)!;
  (secondInvoice as unknown as { businessOrderId: string }).businessOrderId = "qbo-owner-coordinate-a";
  for (const version of secondInvoice.versions) {
    (version.snapshot as unknown as { sourceBusinessOrderId: string }).sourceBusinessOrderId = "qbo-owner-coordinate-a";
  }
  const receipt = corrupted.mutationReceipts.find((candidate) => candidate.mutationId === "owner-coordinate-b-v1")!;
  const payload = JSON.parse(receipt.payloadCanonical!) as { orderId: string };
  payload.orderId = "qbo-owner-coordinate-a";
  const canonical = JSON.stringify(payload);
  (receipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadCanonical = canonical;
  (receipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadHash = mutationPayloadHash(canonical);

  expect(() => validateLinkedOperationsState(corrupted)).toThrow(/owner|Quick BO|logical|唯一|INVOICE_SHARED_OWNER/i);
  const duplicateStore = {
    ...store,
    read: <T,>(selector: (snapshot: LinkedOperationsState) => T): T => structuredClone(selector(corrupted)),
  } as ReturnType<typeof createMockLinkedOperationsStore>;
  expect(() => getMockBillingBusinessOrder("qbo-owner-coordinate-a", duplicateStore))
    .toThrow(/conflict|owner|logical|冲突|唯一/i);
  expect(first.invoiceId).not.toBe(second.invoiceId);
});

test("formal and Quick BO owner IDs occupy one closed namespace", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-owner-namespace", [unit("owner-namespace", "labor", 10_000, 0)]);
  const corrupted = stateSnapshot(store);
  const formalId = corrupted.businessOrders[0]!.id;
  const quick = corrupted.quickOrders.find((order) => order.id === "qbo-owner-namespace")!;
  (quick as unknown as { id: string }).id = formalId;
  expect(() => validateLinkedOperationsState(corrupted)).toThrow(/owner|namespace|business order|命名空间|重复/i);
});

test("shared Invoice number is bound to activation audit and receipt, not only a valid-looking field", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:34:56-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(storage);
    await addSharedQuickOrder(store, "qbo-number-binding-a", [unit("number-binding-a", "labor", 10_000, 0)]);
    await addSharedQuickOrder(store, "qbo-number-binding-b", [unit("number-binding-b", "parts", 8_000, 0)]);
    let state = stateSnapshot(store);
    const first = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-number-binding-a",
      expectedRevision: state.revision,
      mutationId: "number-binding-a-v1",
    }, frontdeskActor, store);
    state = stateSnapshot(store);
    const second = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-number-binding-b",
      expectedRevision: state.revision,
      mutationId: "number-binding-b-v1",
    }, frontdeskActor, store);
    const canonical = stateSnapshot(store);
    const firstInvoice = canonical.invoices.find((invoice) => invoice.id === first.invoiceId)!;
    const secondInvoice = canonical.invoices.find((invoice) => invoice.id === second.invoiceId)!;

    const duplicate = structuredClone(canonical);
    (duplicate.invoices.find((invoice) => invoice.id === second.invoiceId) as unknown as { invoiceNo: string }).invoiceNo = firstInvoice.invoiceNo;
    expect.soft(() => validateLinkedOperationsState(duplicate)).toThrow(/number|invoice|duplicate|编号|重复/i);

    const validLookingDrift = structuredClone(canonical);
    const drifted = validLookingDrift.invoices.find((invoice) => invoice.id === second.invoiceId)!;
    const sequence = Number(secondInvoice.invoiceNo.slice(-5));
    (drifted as unknown as { invoiceNo: string }).invoiceNo = secondInvoice.invoiceNo.slice(0, -5) + String(sequence + 1).padStart(5, "0");
    expect.soft(() => validateLinkedOperationsState(validLookingDrift)).toThrow(/audit|receipt|result|number|sequence|high.water|编号|回执|高水位/i);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("deleting a complete historical shared Invoice allocation cannot make its number reusable", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:34:56-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(storage);
    await addSharedQuickOrder(store, "qbo-number-delete-a", [unit("number-delete-a", "labor", 10_000, 0)]);
    let state = stateSnapshot(store);
    const first = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-number-delete-a",
      expectedRevision: state.revision,
      mutationId: "number-delete-a-v1",
    }, frontdeskActor, store);
    const firstInvoice = stateSnapshot(store).invoices.find((invoice) => invoice.id === first.invoiceId)!;
    const firstNumber = firstInvoice.invoiceNo;
    await store.mutate((draft) => {
      const deleted = draft.invoices.find((invoice) => invoice.id === first.invoiceId)!;
      draft.invoices = draft.invoices.filter((invoice) => invoice.id !== first.invoiceId);
      for (const version of deleted.versions) delete draft.invoiceFileHashes[version.id];
      draft.billingAuditEvents = draft.billingAuditEvents.filter((event) => event.mutationId !== "number-delete-a-v1");
      draft.mutationReceipts = draft.mutationReceipts.filter((receipt) => receipt.mutationId !== "number-delete-a-v1");
      draft.discountSignatureEvents = draft.discountSignatureEvents.filter((event) => event.mutationId !== "number-delete-a-v1");
      draft.revision += 1;
    }, { action: "test.delete-complete-invoice-history.write", consumeWriteFault: false });
    await addSharedQuickOrder(store, "qbo-number-delete-b", [unit("number-delete-b", "parts", 8_000, 0)]);
    state = stateSnapshot(store);
    const second = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-number-delete-b",
      expectedRevision: state.revision,
      mutationId: "number-delete-b-v1",
    }, frontdeskActor, store);
    const secondNumber = stateSnapshot(store).invoices.find((invoice) => invoice.id === second.invoiceId)!.invoiceNo;
    expect(secondNumber).not.toBe(firstNumber);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("activation exposes one strong snapshot commitment through version file, audit, and receipt result", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-snapshot-commitment", [unit("snapshot-commitment", "labor", 10_000, 0)]);
  const before = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-snapshot-commitment",
    expectedRevision: before.revision,
    mutationId: "snapshot-commitment-v1",
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  const audit = canonical.billingAuditEvents.find((event) => event.mutationId === "snapshot-commitment-v1")!;
  const receipt = canonical.mutationReceipts.find((candidate) => candidate.mutationId === "snapshot-commitment-v1")!;
  const invoice = canonical.invoices.find((candidate) => candidate.id === activated.invoiceId) as unknown as {
    versions: Array<{ snapshotCommitment: string }>;
  };
  const versionCommitment = invoice.versions[0]!.snapshotCommitment;
  const result = receipt.result as Record<string, unknown>;
  expect.soft((activated as unknown as { snapshotCommitment?: string }).snapshotCommitment).toMatch(/^sha256-/u);
  expect.soft((audit as unknown as { snapshotCommitment?: string }).snapshotCommitment).toBe(versionCommitment);
  expect.soft(result.snapshotCommitment).toBe(versionCommitment);
  expect.soft(canonical.invoiceFileHashes[activated.invoiceVersionId]).toBeUndefined();
});

test("snapshot commitment rejects a valid recomputed snapshot or commitment drift independently", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-snapshot-drift", [unit("snapshot-drift", "parts", 8_000, 0)]);
  const before = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-snapshot-drift",
    expectedRevision: before.revision,
    mutationId: "snapshot-drift-v1",
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);

  const changedSnapshot = structuredClone(canonical);
  const changedVersion = (changedSnapshot.invoices.find((invoice) => invoice.id === activated.invoiceId) as unknown as {
    versions: Array<{ snapshot: InvoiceChargeSnapshot }>;
  }).versions[0]!;
  const sourceLines = changedVersion.snapshot.lines.map(invoiceSnapshotLineToQuotedCharge);
  const first = sourceLines[0];
  if (!first || first.pricingMode !== "unit") throw new Error("unit snapshot line missing");
  (changedVersion as unknown as { snapshot: InvoiceChargeSnapshot }).snapshot = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: changedVersion.snapshot.sourceBusinessOrderId,
    sourceBusinessOrderRevision: changedVersion.snapshot.sourceBusinessOrderRevision,
    lines: [{ ...first, unitPriceJmd: first.unitPriceJmd + 1_000 }, ...sourceLines.slice(1)],
    adjustments: changedVersion.snapshot.adjustments,
  });
  expect.soft(() => validateLinkedOperationsState(changedSnapshot)).toThrow(/commitment|hash|snapshot|快照|哈希/i);

  const changedCommitment = structuredClone(canonical);
  const changedCommitmentVersion = (changedCommitment.invoices.find((invoice) => invoice.id === activated.invoiceId) as unknown as {
    versions: Array<{ snapshotCommitment: string }>;
  }).versions[0]!;
  changedCommitmentVersion.snapshotCommitment = "sha256-utf16le:" + "f".repeat(64);
  expect.soft(() => validateLinkedOperationsState(changedCommitment)).toThrow(/commitment|hash|snapshot|快照|哈希/i);
});

test("refund receipt must fall after its source activation and before the next Invoice activation", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-ledger-window", [unit("ledger-window", "labor", 5_000, 0, 2)]);
  let state = stateSnapshot(store);
  const v1 = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-ledger-window",
    expectedRevision: state.revision,
    mutationId: "ledger-window-v1",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  const v2 = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-ledger-window",
    expectedRevision: state.revision,
    mutationId: "ledger-window-v2",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoiceLineRefund({
    logicalInvoiceId: v2.invoiceId,
    invoiceVersionId: v2.invoiceVersionId,
    chargeLineId: "ledger-window",
    refundQuantity: 1,
    method: "cash",
    reason: "ledger window",
    expectedRevision: state.revision,
    mutationId: "ledger-window-refund",
  }, frontdeskActor, store);
  const corrupted = stateSnapshot(store);
  const refund = corrupted.refunds.find((candidate) => candidate.refundContract === "ordinary_line_v1")!;
  (refund as unknown as { invoiceVersionId: string }).invoiceVersionId = v1.invoiceVersionId;
  const v1Line = (corrupted.invoices.find((invoice) => invoice.id === v1.invoiceId) as unknown as {
    versions: Array<{ snapshot: InvoiceChargeSnapshot }>;
  }).versions[0]!.snapshot.lines[0]!;
  (refund as unknown as { lineSnapshot: typeof v1Line }).lineSnapshot = structuredClone(v1Line);
  const audit = corrupted.billingAuditEvents.find((event) => event.operation === "invoice_line_refund")!;
  (audit as unknown as { invoiceVersionId: string }).invoiceVersionId = v1.invoiceVersionId;
  const receipt = corrupted.mutationReceipts.find((candidate) => candidate.mutationId === "ledger-window-refund")!;
  const payload = JSON.parse(receipt.payloadCanonical!) as Record<string, unknown>;
  payload.invoiceVersionId = v1.invoiceVersionId;
  const payloadCanonical = JSON.stringify(payload);
  (receipt as unknown as { payloadCanonical: string; payloadHash: string; result: unknown }).payloadCanonical = payloadCanonical;
  (receipt as unknown as { payloadCanonical: string; payloadHash: string; result: unknown }).payloadHash = mutationPayloadHash(payloadCanonical);
  (receipt as unknown as { payloadCanonical: string; payloadHash: string; result: unknown }).result = structuredClone(refund);
  expect(() => validateLinkedOperationsState(corrupted)).toThrow(/ledger|revision|activation|source|顺序|版本/i);
});

test("all new billing receipts have a unique committed revision despite coordinated refund tampering", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-ledger-unique", [unit("ledger-unique", "parts", 5_000, 0, 2)]);
  let state = stateSnapshot(store);
  const activated = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-ledger-unique",
    expectedRevision: state.revision,
    mutationId: "ledger-unique-activation",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoiceLineRefund({
    logicalInvoiceId: activated.invoiceId,
    invoiceVersionId: activated.invoiceVersionId,
    chargeLineId: "ledger-unique",
    refundQuantity: 1,
    method: "cash",
    reason: "first",
    expectedRevision: state.revision,
    mutationId: "ledger-unique-refund-a",
  }, frontdeskActor, store);
  state = stateSnapshot(store);
  await recordMockInvoiceLineRefund({
    logicalInvoiceId: activated.invoiceId,
    invoiceVersionId: activated.invoiceVersionId,
    chargeLineId: "ledger-unique",
    refundQuantity: 1,
    method: "cash",
    reason: "second",
    expectedRevision: state.revision,
    mutationId: "ledger-unique-refund-b",
  }, frontdeskActor, store);
  const corrupted = stateSnapshot(store);
  const firstReceipt = corrupted.mutationReceipts.find((receipt) => receipt.mutationId === "ledger-unique-refund-a")!;
  const secondReceipt = corrupted.mutationReceipts.find((receipt) => receipt.mutationId === "ledger-unique-refund-b")!;
  (secondReceipt as unknown as { committedRevision: number }).committedRevision = firstReceipt.committedRevision;
  const payload = JSON.parse(secondReceipt.payloadCanonical!) as Record<string, unknown>;
  payload.expectedRevision = firstReceipt.committedRevision - 1;
  const payloadCanonical = JSON.stringify(payload);
  (secondReceipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadCanonical = payloadCanonical;
  (secondReceipt as unknown as { payloadCanonical: string; payloadHash: string }).payloadHash = mutationPayloadHash(payloadCanonical);
  expect(() => validateLinkedOperationsState(corrupted)).toThrow(/billing|ledger|revision|duplicate|顺序|重复/i);
});
