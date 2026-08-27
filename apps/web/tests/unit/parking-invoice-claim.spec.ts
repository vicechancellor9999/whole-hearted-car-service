import { expect, test } from "@playwright/test";
import {
  calculateParkingCorrectionAmounts,
  transferParkingClaims,
  type ParkingClaimMap,
} from "../../src/lib/parking/invoice-claims";
import { calculateInvoiceTotals } from "../../src/lib/billing/calculations";
import { isSharedChargeInvoice } from "../../src/lib/billing/types";
import {
  buildInvoiceChargeSnapshot,
  invoiceSnapshotLineToQuotedCharge,
} from "../../src/lib/billing/invoice-snapshots";
import {
  calculateParkingAccrual,
  deriveParkingFinalAccrual,
  validateParkingWaiver,
} from "../../src/lib/parking/calculations";
import {
  createMockLinkedOperationsStore,
  billingSnapshotCommitment,
  deriveLinkedInvoiceFinancialSummary,
  isModernParkingSourceFact,
  parkingSourceOriginCommitment,
  validateLinkedOperationsState,
  type AdministratorSignatureEvidence,
  type LinkedModernParkingCorrectionPreviewToken,
  type LinkedOperationsState,
} from "../../src/lib/api/mock-orders";
import type { QuickOrderChargeLine } from "../../src/lib/orders/quick-order-types";
import {
  activateMockQuickInvoiceSnapshot,
  recordMockInvoicePayment,
} from "../../src/lib/api/mock-billing";
import {
  applyMockParkingWaiver,
  previewMockParkingWaiver,
  recordMockParkingSourcePickup,
} from "../../src/lib/api/mock-parking";
import {
  applyMockQuickOrderAction,
  recordMockQuickOrderLifecycleMutation,
  recordMockQuickPickup,
} from "../../src/lib/api/mock-quick-orders";

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

const unit = (id: string, amountJmd = 10_000): Extract<QuickOrderChargeLine, { pricingMode: "unit" }> => ({
  id,
  category: "labor",
  pricingMode: "unit",
  descZh: `工时-${id}`,
  descEn: `Labor-${id}`,
  remarkZh: "",
  remarkEn: "",
  unit: "项",
  unitEn: "item",
  quantity: 1,
  unitPriceJmd: amountJmd,
  unitDiscountJmd: 0,
  pendingQuote: false,
});

const frontdeskActor = { id: "emp-001", name: "超级管理员", role: "superadmin" as const };
const financeActor = { id: "emp-002", name: "李美玲", role: "finance" as const };
const FIRST_INVOICE_STROKES = [[
  { x: 1, y: 1, time: 1 },
  { x: 2, y: 3, time: 2 },
]];
const CORRECTION_INVOICE_STROKES = [[
  { x: 11, y: 7, time: 11 },
  { x: 13, y: 17, time: 12 },
]];

function administratorEvidence(input: {
  caseId: string;
  sourceRevision: number;
  cumulativeWaiverJmd: number;
  reason: string;
  mutationId: string;
  administratorId?: string;
}): AdministratorSignatureEvidence {
  const administratorId = input.administratorId ?? "emp-001";
  const signedAt = "2026-08-21T12:00:00-05:00";
  return {
    signatureId: `signature-parking-${input.caseId}-${input.mutationId}`,
    signatureHash: `sha256-parking-${input.caseId}-${input.mutationId}`,
    blobRef: `mock-signatures/parking/${input.caseId}/${input.mutationId}`,
    administratorId,
    action: "parking_waiver",
    subjectId: input.caseId,
    sourceRevision: input.sourceRevision,
    amountJmd: input.cumulativeWaiverJmd,
    reason: input.reason,
    signedAt,
    payloadHash: [
      "bound", "parking_waiver", administratorId, input.caseId,
      input.sourceRevision, input.cumulativeWaiverJmd, encodeURIComponent(input.reason), signedAt,
    ].join(":"),
  };
}

function receiptPayloadHash(canonical: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function stateSnapshot(store: ReturnType<typeof createMockLinkedOperationsStore>): LinkedOperationsState {
  return store.read((state) => state);
}

async function addSharedQuickOrder(
  store: ReturnType<typeof createMockLinkedOperationsStore>,
  orderId: string,
  lines: ReadonlyArray<QuickOrderChargeLine> = [unit(`${orderId}-labor`)],
  overrides: Partial<Pick<LinkedOperationsState["quickOrders"][number], "vehicleId" | "customerId" | "createdAt" | "submittedAt">> = {},
): Promise<void> {
  await store.mutate((state) => {
    const base = state.quickOrders.find((order) => order.id === "demo-v2-parking-unclaimed")
      ?? state.quickOrders.find((order) => order.status === "submitted")
      ?? state.quickOrders[0]!;
    const createdAt = overrides.createdAt ?? "2026-08-01T08:00:00-05:00";
    const assignedAt = "2026-08-01T08:15:00-05:00";
    const acceptedAt = "2026-08-01T08:30:00-05:00";
    const returnedAt = "2026-08-01T08:45:00-05:00";
    const submittedAt = overrides.submittedAt ?? "2026-08-01T09:00:00-05:00";
    const teamId = "test-repair-team";
    const customerId = overrides.customerId ?? base.customerId;
    let vehicleId = overrides.vehicleId;
    if (!vehicleId) {
      const baseVehicle = state.vehicles.find((vehicle) => vehicle.id === base.vehicleId)!;
      vehicleId = `${orderId}-vehicle`;
      state.vehicles.push({
        ...structuredClone(baseVehicle),
        id: vehicleId,
        customerId,
        plate: `TEST-${state.quickOrders.length + 1}`,
      });
    }
    state.quickOrders.push({
      ...structuredClone(base),
      id: orderId,
      businessOrderNo: `KGN-WH-${orderId.toUpperCase()}`,
      customerId,
      vehicleId,
      createdAt,
      status: "submitted",
      teamId,
      assignedAt,
      acceptedAt,
      returnedAt,
      submittedAt,
      submittedBy: "超级管理员",
      statusHistory: [
        { id: `${orderId}-ev-1`, from: null, to: "pending_assign", by: "超级管理员", byRole: "frontdesk", at: createdAt },
        { id: `${orderId}-ev-2`, from: "pending_assign", to: "assigned", by: "超级管理员", byRole: "frontdesk", at: assignedAt },
        { id: `${orderId}-ev-3`, from: "assigned", to: "in_repair", by: "维修工", byRole: "mechanic", at: acceptedAt },
        { id: `${orderId}-ev-4`, from: "in_repair", to: "returned", by: "维修工", byRole: "mechanic", at: returnedAt },
        {
          id: `${orderId}-ev-5`,
          from: "returned",
          to: "submitted",
          by: "超级管理员",
          byRole: "frontdesk",
          at: submittedAt,
          roundNumber: 1,
          teamId,
          performanceValueJmd: base.performanceValueJmd,
        },
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
      ...overrides,
    });
    state.revision += 1;
  }, { action: "test.parking-shared-order.write", consumeWriteFault: false });
}

function modernParkingSource(orderId: string, vehicleId: string, caseId = `PARK-${orderId}`) {
  return {
    id: caseId,
    parkingContract: "parking_source_v1" as const,
    originBusinessOrderId: orderId,
    eligibleBusinessOrderIds: [orderId],
    vehicleId,
    notificationDate: "2026-08-01",
    pickupDate: "2026-08-08",
    accrual: { chargeableDays: 5, originalAmountJmd: 12_500 },
    dailyRateJmd: 2_500,
    revision: 1,
    asOf: "2026-08-21T12:00:00-05:00",
    waiverHistory: [],
    waiverReasons: [],
  };
}

async function addModernParkingSource(
  store: ReturnType<typeof createMockLinkedOperationsStore>,
  orderId: string,
  _caseId?: string,
  elapsedDays = 7,
  closeEpisode = true,
): Promise<ReturnType<typeof modernParkingSource>> {
  const before = stateSnapshot(store);
  const requestedOrder = before.quickOrders.find((candidate) => candidate.id === orderId)!;
  const priorEpisodes = before.parkingCases.filter((candidate) => (
    isModernParkingSourceFact(candidate) && candidate.eligibleBusinessOrderIds.includes(orderId)
  ));
  let originOrderId = orderId;
  if (requestedOrder.pickupNotice !== null || priorEpisodes.length > 0) {
    originOrderId = `${orderId}-episode-${priorEpisodes.length + 1}`;
    await addSharedQuickOrder(store, originOrderId, [unit(`${originOrderId}-labor`)], {
      vehicleId: requestedOrder.vehicleId,
      customerId: requestedOrder.customerId,
    });
  }
  const beforePickup = stateSnapshot(store);
  const currentClockMs = store.nowMs();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const existingWindow = typeof window === "undefined" ? undefined : window as Window & {
    __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: { nowMs?: number };
  };
  const existingScenario = existingWindow?.__WH_LINKED_OPERATIONS_TEST_SCENARIO__;
  const existingNowMs = existingScenario?.nowMs;
  if (existingWindow) {
    existingWindow.__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = { ...existingScenario, nowMs: currentClockMs - elapsedDays * 86_400_000 };
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __WH_LINKED_OPERATIONS_TEST_SCENARIO__: { nowMs: currentClockMs - elapsedDays * 86_400_000 } },
    });
  }
  let created: Awaited<ReturnType<typeof recordMockQuickPickup>>;
  try {
    created = await recordMockQuickPickup({
      orderId: originOrderId,
      expectedRevision: beforePickup.revision,
      mutationId: `parking-source-fixture-create-${originOrderId}`,
      channels: pickupChannels,
    }, frontdeskActor, store);
  } finally {
    if (existingWindow) {
      if (existingScenario) {
        existingWindow.__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = existingScenario;
      } else {
        delete existingWindow.__WH_LINKED_OPERATIONS_TEST_SCENARIO__;
      }
    } else if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
  if (!closeEpisode) return created.parkingSource as ReturnType<typeof modernParkingSource>;
  const beforeClose = stateSnapshot(store);
  const updated = await recordMockParkingSourcePickup({
    caseId: created.parkingSource.id,
    expectedRevision: beforeClose.revision,
    expectedSourceRevision: created.parkingSource.revision,
    mutationId: `parking-source-fixture-pickup-${created.parkingSource.id}`,
  }, frontdeskActor, store);
  return updated.parkingSource as ReturnType<typeof modernParkingSource>;
}

const pickupChannels = [{
  kind: "sms" as const,
  language: "zh" as const,
  text: "车辆已可取，请尽快安排取车。",
}];

const projection = (chargeLineId: string, parkingCaseId: string, sourceRevision = 1, amountJmd = 10_000) => ({
  pricingMode: "parking_projection" as const,
  chargeLineId,
  category: "other_service" as const,
  code: "parking_overtime" as const,
  descZh: "停车超时费",
  descEn: "Parking overtime",
  remarkZh: "",
  remarkEn: "",
  parkingCaseId,
  sourceRevision,
  asOf: "2026-08-21T12:00:00-05:00",
  amountJmd,
});

test("parking claim CAS acquires once and same logical Invoice transfers the same lineage", () => {
  const first = transferParkingClaims({
    claims: {},
    logicalInvoiceId: "invoice-1",
    previousEffectiveVersionId: null,
    nextEffectiveVersionId: "invoice-1-v1",
    nextParkingLines: [projection("parking-line-stable", "PARK-1")],
  });
  expect(first).toEqual({
    "PARK-1": {
      logicalInvoiceId: "invoice-1",
      financiallyEffectiveVersionId: "invoice-1-v1",
      chargeLineId: "parking-line-stable",
    },
  });

  const transferred = transferParkingClaims({
    claims: first,
    logicalInvoiceId: "invoice-1",
    previousEffectiveVersionId: "invoice-1-v1",
    nextEffectiveVersionId: "invoice-1-v2",
    nextParkingLines: [projection("parking-line-stable", "PARK-1", 2, 2_500)],
  });
  expect(transferred["PARK-1"]).toEqual({
    logicalInvoiceId: "invoice-1",
    financiallyEffectiveVersionId: "invoice-1-v2",
    chargeLineId: "parking-line-stable",
  });
  expect(first["PARK-1"].financiallyEffectiveVersionId).toBe("invoice-1-v1");
});

test("parking claim rejects a competing Invoice, duplicate case row, stale owner, and partial transfer", () => {
  const existing: ParkingClaimMap = {
    "PARK-1": {
      logicalInvoiceId: "invoice-1",
      financiallyEffectiveVersionId: "invoice-1-v1",
      chargeLineId: "parking-line-stable",
    },
  };
  expect(() => transferParkingClaims({
    claims: existing,
    logicalInvoiceId: "invoice-2",
    previousEffectiveVersionId: null,
    nextEffectiveVersionId: "invoice-2-v1",
    nextParkingLines: [projection("parking-line-2", "PARK-1")],
  })).toThrow(/claim|occupied|占用|Invoice/i);

  expect(() => transferParkingClaims({
    claims: {},
    logicalInvoiceId: "invoice-1",
    previousEffectiveVersionId: null,
    nextEffectiveVersionId: "invoice-1-v1",
    nextParkingLines: [projection("parking-line-a", "PARK-1"), projection("parking-line-b", "PARK-1")],
  })).toThrow(/duplicate|重复|case/i);

  expect(() => transferParkingClaims({
    claims: existing,
    logicalInvoiceId: "invoice-1",
    previousEffectiveVersionId: "invoice-1-wrong",
    nextEffectiveVersionId: "invoice-1-v2",
    nextParkingLines: [projection("parking-line-stable", "PARK-1", 2, 2_500)],
  })).toThrow(/stale|source|旧版本|占用/i);

  expect(() => transferParkingClaims({
    claims: {
      ...existing,
      "PARK-2": {
        logicalInvoiceId: "invoice-1",
        financiallyEffectiveVersionId: "invoice-1-v1",
        chargeLineId: "parking-line-2",
      },
    },
    logicalInvoiceId: "invoice-1",
    previousEffectiveVersionId: "invoice-1-v1",
    nextEffectiveVersionId: "invoice-1-v2",
    nextParkingLines: [projection("parking-line-stable", "PARK-1", 2, 2_500)],
  })).toThrow(/partial|missing|完整|PARK-2/i);
});

test("parking correction cash uses the approved formula for unpaid, partial, full, and overpaid ledgers", () => {
  const preview = (netPaidBeforeJmd: number) => calculateParkingCorrectionAmounts({
    oldParkingAmountJmd: 10_000,
    newParkingAmountJmd: 2_500,
    receivableAfterCorrectionJmd: 42_500,
    netPaidBeforeJmd,
  });

  expect(preview(0)).toEqual({ parkingDeltaJmd: -7_500, parkingCashRefundJmd: 0 });
  expect(preview(20_000)).toEqual({ parkingDeltaJmd: -7_500, parkingCashRefundJmd: 0 });
  expect(preview(45_000)).toEqual({ parkingDeltaJmd: -7_500, parkingCashRefundJmd: 2_500 });
  expect(preview(50_000)).toEqual({ parkingDeltaJmd: -7_500, parkingCashRefundJmd: 7_500 });
  expect(preview(52_000)).toEqual({ parkingDeltaJmd: -7_500, parkingCashRefundJmd: 7_500 });
});

test("parking increase and unchanged source never create a cash refund", () => {
  expect(calculateParkingCorrectionAmounts({
    oldParkingAmountJmd: 2_500,
    newParkingAmountJmd: 10_000,
    receivableAfterCorrectionJmd: 50_000,
    netPaidBeforeJmd: 60_000,
  })).toEqual({ parkingDeltaJmd: 7_500, parkingCashRefundJmd: 0 });
  expect(calculateParkingCorrectionAmounts({
    oldParkingAmountJmd: 10_000,
    newParkingAmountJmd: 10_000,
    receivableAfterCorrectionJmd: 50_000,
    netPaidBeforeJmd: 60_000,
  })).toEqual({ parkingDeltaJmd: 0, parkingCashRefundJmd: 0 });
});

test("parking correction validates safe nonnegative money and never mutates caller facts", () => {
  const input = {
    oldParkingAmountJmd: 10_000,
    newParkingAmountJmd: 2_500,
    receivableAfterCorrectionJmd: 42_500,
    netPaidBeforeJmd: 50_000,
  };
  const before = structuredClone(input);
  expect(calculateParkingCorrectionAmounts(input)).toEqual({
    parkingDeltaJmd: -7_500,
    parkingCashRefundJmd: 7_500,
  });
  expect(input).toEqual(before);
  expect(() => calculateParkingCorrectionAmounts({ ...input, newParkingAmountJmd: -1 })).toThrow(/non-negative|非负/i);
  expect(() => calculateParkingCorrectionAmounts({ ...input, netPaidBeforeJmd: 1.5 })).toThrow(/integer|整数/i);
});

test("live parking final accrual applies historical cumulative waiver to the current clock", () => {
  const historicalDecision = validateParkingWaiver({
    caseId: "PARK-LIVE-CLOCK",
    originalChargeableDays: 3,
    dailyRateJmd: 2_500,
    existingWaivedDays: 0,
    existingWaivedAmountJmd: 0,
    proposedWaivedDays: 1,
    proposedWaivedAmountJmd: 2_500,
  });
  expect(historicalDecision.finalAmountJmd).toBe(5_000);
  expect(deriveParkingFinalAccrual({
    currentAccrual: { chargeableDays: 5, originalAmountJmd: 12_500 },
    dailyRateJmd: 2_500,
    latestWaiverDecision: historicalDecision,
  })).toEqual({
    finalChargeableDays: 4,
    finalAmountJmd: 10_000,
  });
});

test("modern waiver decision stays bound to its historical source while activation uses current net accrual", async () => {
  const scenario: { nowMs: number } = { nowMs: Date.parse("2026-08-21T12:00:00-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    await addSharedQuickOrder(store, "qbo-parking-waiver-clock");
    const original = await addModernParkingSource(
      store,
      "qbo-parking-waiver-clock",
      "PARK-WAIVER-CLOCK",
      7,
      false,
    );
    const beforePreview = stateSnapshot(store);
    const preview = await previewMockParkingWaiver({
      caseId: original.id,
      expectedRevision: beforePreview.revision,
      expectedSourceRevision: original.revision,
      mutationId: "parking-waiver-clock-preview",
      waiveDays: 1,
      reason: "one historical closure day",
    }, frontdeskActor, store);
    await applyMockParkingWaiver({
      caseId: original.id,
      expectedRevision: preview.latestRevision,
      expectedSourceRevision: preview.sourceRevision,
      mutationId: "parking-waiver-clock-apply",
      previewToken: preview.previewToken,
    }, frontdeskActor, store);
    const committed = stateSnapshot(store);
    expect(() => validateLinkedOperationsState(committed)).not.toThrow();

    const driftedBasis = structuredClone(committed);
    const drifted = driftedBasis.parkingCases.find((candidate) => candidate.id === original.id)!;
    if (!isModernParkingSourceFact(drifted)) throw new Error("expected modern parking source");
    (drifted.waiverHistory[0] as unknown as { sourceAsOf: string }).sourceAsOf = "2026-08-21T12:00:01-05:00";
    expect(() => validateLinkedOperationsState(driftedBasis)).toThrow(/parking|waiver|source|revision|asOf|减免|来源/i);

    scenario.nowMs += 2 * 86_400_000;
    const beforeActivation = stateSnapshot(store);
    const activated = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-parking-waiver-clock",
      expectedRevision: beforeActivation.revision,
      mutationId: "parking-waiver-clock-activation",
    }, frontdeskActor, store);
    const finalState = stateSnapshot(store);
    const invoice = finalState.invoices.find((candidate) => candidate.id === activated.invoiceId)!;
    if (!isSharedChargeInvoice(invoice)) throw new Error("expected shared Invoice");
    const parkingLine = invoice.versions[0]!.snapshot.lines.find((line) => line.pricingMode === "parking_projection")!;
    expect(parkingLine).toMatchObject({ sourceRevision: preview.nextSourceRevision + 1, amountJmd: 15_000 });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("claim transfer rejects empty coordinates and a mixed collision atomically without mutating the claim map", () => {
  expect(() => transferParkingClaims({
    claims: {},
    logicalInvoiceId: "invoice-empty",
    previousEffectiveVersionId: null,
    nextEffectiveVersionId: "invoice-empty-v1",
    nextParkingLines: [projection("", "PARK-EMPTY")],
  })).toThrow(/empty|不能为空/i);
  expect(() => transferParkingClaims({
    claims: {},
    logicalInvoiceId: "invoice-empty",
    previousEffectiveVersionId: null,
    nextEffectiveVersionId: "invoice-empty-v1",
    nextParkingLines: [projection("parking-line", "")],
  })).toThrow(/empty|不能为空/i);

  const claims: ParkingClaimMap = {
    "PARK-COLLISION": {
      logicalInvoiceId: "invoice-other",
      financiallyEffectiveVersionId: "invoice-other-v1",
      chargeLineId: "parking-other",
    },
  };
  const before = structuredClone(claims);
  expect(() => transferParkingClaims({
    claims,
    logicalInvoiceId: "invoice-mixed",
    previousEffectiveVersionId: null,
    nextEffectiveVersionId: "invoice-mixed-v1",
    nextParkingLines: [
      projection("parking-free", "PARK-FREE"),
      projection("parking-collision", "PARK-COLLISION"),
    ],
  })).toThrow(/occupied|claim|占用/i);
  expect(claims).toEqual(before);
});

test("modern unbilled Quick BO parking source is a closed reloadable fact without Invoice coordinates", async () => {
  const storage = memoryStorage();
  const store = createMockLinkedOperationsStore(storage);
  await addSharedQuickOrder(store, "qbo-parking-source");
  const source = await addModernParkingSource(store, "qbo-parking-source", "PARK-SOURCE-1");
  const canonical = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();
  expect(canonical.parkingCases.find((candidate) => candidate.id === source.id)).toEqual(source);
  expect(Object.prototype.hasOwnProperty.call(source, "invoiceId")).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(source, "invoiceVersionId")).toBe(false);

  const fresh = createMockLinkedOperationsStore(storage);
  await fresh.ready();
  expect(stateSnapshot(fresh).parkingCases.find((candidate) => candidate.id === source.id)).toEqual(source);
});

test("modern parking source rejects extra Invoice coordinates, missing required fields, bogus tags, and unknown keys", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-source-closed");
  const source = await addModernParkingSource(store, "qbo-parking-source-closed", "PARK-SOURCE-CLOSED");
  const canonical = stateSnapshot(store);
  const mutations: Array<(draft: LinkedOperationsState) => void> = [
    (draft) => { Object.assign(draft.parkingCases.find((item) => item.id === source.id)!, { invoiceId: "spoof", invoiceVersionId: "spoof-v1" }); },
    (draft) => { delete (draft.parkingCases.find((item) => item.id === source.id)! as unknown as { asOf?: string }).asOf; },
    (draft) => { (draft.parkingCases.find((item) => item.id === source.id)! as unknown as { parkingContract: string }).parkingContract = "bogus"; },
    (draft) => { delete (draft.parkingCases.find((item) => item.id === source.id)! as unknown as { parkingContract?: string }).parkingContract; },
    (draft) => { Object.assign(draft.parkingCases.find((item) => item.id === source.id)!, { extra: true }); },
  ];
  for (const mutate of mutations) {
    const corrupted = structuredClone(canonical);
    mutate(corrupted);
    expect(() => validateLinkedOperationsState(corrupted)).toThrow(/parking|source|contract|closed|Invoice|停车|来源/i);
  }
});

test("optional pickupDate is either absent or a real calendar value and survives canonical JSON roundtrip", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-pickup-own-key");
  const before = stateSnapshot(store);
  const created = await recordMockQuickPickup({
    orderId: "qbo-parking-pickup-own-key",
    expectedRevision: before.revision,
    mutationId: "parking-pickup-own-key-create",
    channels: pickupChannels,
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();
  const serialized = JSON.stringify(canonical);
  const roundtripped = JSON.parse(serialized) as LinkedOperationsState;
  expect(() => validateLinkedOperationsState(roundtripped)).not.toThrow();
  expect(JSON.stringify(roundtripped)).toBe(serialized);

  const descriptorKinds = ["undefined value", "enumerable accessor"] as const;
  const accepted: string[] = [];
  for (const descriptorKind of descriptorKinds) {
    const drifted = structuredClone(canonical);
    const current = drifted.parkingCases.find((candidate) => candidate.id === created.parkingSource.id)!;
    const receipt = drifted.mutationReceipts.find((candidate) => candidate.mutationId === "parking-pickup-own-key-create")!;
    const receiptSource = (receipt.result as { parkingSource: Record<string, unknown> }).parkingSource;
    const origin = drifted.parkingSourceOrigins.find((candidate) => candidate.id === created.parkingSource.id)!;
    const targets = [
      current as unknown as Record<string, unknown>,
      receiptSource,
      origin.initialSource as unknown as Record<string, unknown>,
    ];
    for (const target of targets) {
      if (descriptorKind === "undefined value") {
        Object.defineProperty(target, "pickupDate", {
          configurable: true,
          enumerable: true,
          writable: true,
          value: undefined,
        });
      } else {
        Object.defineProperty(target, "pickupDate", {
          configurable: true,
          enumerable: true,
          get: () => undefined,
        });
      }
    }
    const { commitment: _commitment, ...withoutCommitment } = origin;
    (origin as unknown as { commitment: string }).commitment = parkingSourceOriginCommitment(withoutCommitment);
    try {
      validateLinkedOperationsState(drifted);
      accepted.push(descriptorKind);
    } catch {
      // Desired fail-closed result.
    }
  }
  expect(accepted).toEqual([]);
});

test("modern parking source closes calendar, positive accrual, and the complete deterministic waiver chain", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-source-financial");
  const source = await addModernParkingSource(store, "qbo-parking-source-financial", "PARK-SOURCE-FINANCIAL");
  const canonical = stateSnapshot(store);
  const mutations: Array<(draft: LinkedOperationsState) => void> = [
    (draft) => { (draft.parkingCases.find((item) => item.id === source.id)! as unknown as { notificationDate: string }).notificationDate = "2026-02-31"; },
    (draft) => { (draft.parkingCases.find((item) => item.id === source.id)! as unknown as { pickupDate: string }).pickupDate = "2026-07-31"; },
    (draft) => { (draft.parkingCases.find((item) => item.id === source.id)! as unknown as { asOf: string }).asOf = "2026-08-07T23:59:00-05:00"; },
    (draft) => {
      const parking = draft.parkingCases.find((item) => item.id === source.id)!;
      (parking as unknown as { dailyRateJmd: number }).dailyRateJmd = 0;
      (parking.accrual as unknown as { originalAmountJmd: number }).originalAmountJmd = 0;
    },
    (draft) => {
      const parking = draft.parkingCases.find((item) => item.id === source.id)!;
      (parking as unknown as { revision: number }).revision = 2;
      (parking.waiverHistory as unknown as Array<Record<string, unknown>>).push({
        caseId: "OTHER",
        finalAmountJmd: 1,
      });
    },
  ];
  for (const mutate of mutations) {
    const corrupted = structuredClone(canonical);
    mutate(corrupted);
    expect(() => validateLinkedOperationsState(corrupted)).toThrow(/parking|source|date|amount|waiver|停车|日期|减免/i);
  }
});

test("own-key-absent legacy parking cases retain formal legacy Invoice coordinates and cannot move to Quick BO", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-legacy-owner");
  const canonical = stateSnapshot(store);
  const legacy = canonical.parkingCases.find((candidate) => (
    !Object.prototype.hasOwnProperty.call(candidate, "parkingContract")
  ))!;
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();

  const quickOwner = structuredClone(canonical);
  (quickOwner.parkingCases.find((candidate) => candidate.id === legacy.id)! as unknown as { businessOrderId: string }).businessOrderId = "qbo-parking-legacy-owner";
  expect.soft(() => validateLinkedOperationsState(quickOwner)).toThrow(/legacy|formal|owner|Invoice|parking|停车/i);

  const missingCoordinate = structuredClone(canonical);
  delete (missingCoordinate.parkingCases.find((candidate) => candidate.id === legacy.id)! as unknown as { invoiceId?: string }).invoiceId;
  expect.soft(() => validateLinkedOperationsState(missingCoordinate)).toThrow(/legacy|Invoice|coordinate|parking|停车|坐标/i);
});

test("pickup notice atomically creates one vehicle episode with a frozen eligible BO cohort and reloads", async () => {
  const values = new Map<string, string>();
  const storage = memoryStorage(values);
  const store = createMockLinkedOperationsStore(storage);
  await addSharedQuickOrder(store, "qbo-parking-public-a");
  const publicA = stateSnapshot(store).quickOrders.find((order) => order.id === "qbo-parking-public-a")!;
  await addSharedQuickOrder(store, "qbo-parking-public-b", undefined, {
    vehicleId: publicA.vehicleId,
    customerId: publicA.customerId,
  });
  const before = stateSnapshot(store);
  const publicVehicleId = before.quickOrders.find((order) => order.id === "qbo-parking-public-a")!.vehicleId;
  const creationInput = {
    orderId: "qbo-parking-public-a",
    expectedRevision: before.revision,
    mutationId: "parking-source-public-a",
    channels: pickupChannels,
  };
  await expect(recordMockQuickPickup(creationInput, financeActor as never, store))
    .rejects.toMatchObject({ status: 403 });
  await expect(recordMockQuickPickup(
    creationInput,
    { ...frontdeskActor, name: "伪造操作员" },
    store,
  )).rejects.toMatchObject({ status: 403 });
  expect(stateSnapshot(store)).toEqual(before);
  const first = await recordMockQuickPickup(creationInput, frontdeskActor, store);

  expect(first).toEqual({
    revision: before.revision + 1,
    orderId: "qbo-parking-public-a",
    pickupNotice: expect.objectContaining({ notifiedBy: frontdeskActor.name, channels: expect.any(Array) }),
    parkingSource: expect.objectContaining({
      id: `parking-source-${publicVehicleId}-r${before.revision + 1}`,
      parkingContract: "parking_source_v1",
      originBusinessOrderId: "qbo-parking-public-a",
      eligibleBusinessOrderIds: [
        "qbo-parking-public-a", "qbo-parking-public-b",
      ],
      revision: 1,
      dailyRateJmd: 2_500,
      waiverHistory: [],
      waiverReasons: [],
    }),
  });
  const committed = stateSnapshot(store);
  expect(committed.quickOrders.find((order) => order.id === first.orderId)?.pickupNotice).toEqual(first.pickupNotice);
  expect(committed.parkingCases.filter((source) => (
    isModernParkingSourceFact(source) && source.eligibleBusinessOrderIds.includes(first.orderId)
  ))).toEqual([first.parkingSource]);
  expect(committed.mutationReceipts.filter((receipt) => receipt.operation === "parking.source.create")).toHaveLength(1);
  expect(values.get("wh_quick_parking_v1")).toBeUndefined();
  expect(() => validateLinkedOperationsState(committed)).not.toThrow();

  const financeActorDrift = structuredClone(committed);
  const financeReceipt = financeActorDrift.mutationReceipts.find((receipt) => (
    receipt.mutationId === creationInput.mutationId
  ))!;
  (financeReceipt as unknown as { actorId: string }).actorId = financeActor.id;
  const financeResultNotice = (financeReceipt.result as {
    pickupNotice: { notifiedBy: string; channels: Array<{ sentBy: string }> };
  }).pickupNotice;
  financeResultNotice.notifiedBy = financeActor.name;
  financeResultNotice.channels.forEach((channel) => { channel.sentBy = financeActor.name; });
  const financeOrderNotice = financeActorDrift.quickOrders.find((order) => order.id === creationInput.orderId)!.pickupNotice!;
  (financeOrderNotice as unknown as { notifiedBy: string }).notifiedBy = financeActor.name;
  financeOrderNotice.channels.forEach((channel) => {
    (channel as unknown as { sentBy: string }).sentBy = financeActor.name;
  });
  expect(() => validateLinkedOperationsState(financeActorDrift))
    .toThrow(/parking|source|actor|receipt|停车|操作员/i);

  const mutatePublicCohort = (
    draft: LinkedOperationsState,
    mutate: (ids: string[]) => void,
  ) => {
    const source = draft.parkingCases.find((candidate) => (
      isModernParkingSourceFact(candidate) && candidate.id === first.parkingSource.id
    ))!;
    if (!isModernParkingSourceFact(source)) throw new Error("expected modern parking source");
    const receipt = draft.mutationReceipts.find((candidate) => candidate.mutationId === "parking-source-public-a")!;
    const resultSource = (receipt.result as { parkingSource: { eligibleBusinessOrderIds: string[] } }).parkingSource;
    const next = [...source.eligibleBusinessOrderIds];
    mutate(next);
    (source as unknown as { eligibleBusinessOrderIds: string[] }).eligibleBusinessOrderIds = [...next].sort();
    resultSource.eligibleBusinessOrderIds = [...next].sort();
  };
  const missingEligible = structuredClone(committed);
  mutatePublicCohort(missingEligible, (ids) => { ids.splice(ids.indexOf("qbo-parking-public-b"), 1); });
  expect(() => validateLinkedOperationsState(missingEligible)).toThrow(/parking|eligible|cohort|source|停车/i);

  const lateEligible = structuredClone(committed);
  const lateBase = lateEligible.quickOrders.find((order) => order.id === "qbo-parking-public-b")!;
  lateEligible.quickOrders.push({
    ...structuredClone(lateBase),
    id: "qbo-parking-public-c-late",
    businessOrderNo: "KGN-WH-QBO-PARKING-PUBLIC-C-LATE",
    createdAt: "2026-08-22T08:00:00-05:00",
    submittedAt: "2026-08-22T09:00:00-05:00",
    statusHistory: lateBase.statusHistory.map((event) => ({
      ...event,
      id: `${event.id}-late`,
      at: event.from === "returned" && event.to === "submitted"
        ? "2026-08-22T09:00:00-05:00"
        : event.at,
    })),
    chargeLines: lateBase.chargeLines?.map((line) => ({ ...line, id: `${line.id}-late` })),
  });
  mutatePublicCohort(lateEligible, (ids) => { ids.push("qbo-parking-public-c-late"); });
  expect(() => validateLinkedOperationsState(lateEligible)).toThrow(/parking|eligible|cohort|source|停车/i);

  const foreignEligible = structuredClone(committed);
  const foreignBase = foreignEligible.quickOrders.find((order) => order.id === "qbo-parking-public-b")!;
  const foreignCustomer = foreignEligible.customers.find((customer) => customer.id !== foreignBase.customerId)!;
  const foreignVehicle = foreignEligible.vehicles.find((vehicle) => vehicle.customerId === foreignCustomer.id)!;
  foreignEligible.quickOrders.push({
    ...structuredClone(foreignBase),
    id: "qbo-parking-public-foreign",
    businessOrderNo: "KGN-WH-QBO-PARKING-PUBLIC-FOREIGN",
    customerId: foreignCustomer.id,
    vehicleId: foreignVehicle.id,
    chargeLines: foreignBase.chargeLines?.map((line) => ({ ...line, id: `${line.id}-foreign` })),
  });
  mutatePublicCohort(foreignEligible, (ids) => { ids.push("qbo-parking-public-foreign"); });
  expect(() => validateLinkedOperationsState(foreignEligible)).toThrow(/parking|eligible|cohort|source|停车/i);

  const missingCreationReceipt = structuredClone(committed);
  missingCreationReceipt.mutationReceipts = missingCreationReceipt.mutationReceipts.filter((receipt) => (
    receipt.mutationId !== "parking-source-public-a"
  ));
  expect(() => validateLinkedOperationsState(missingCreationReceipt)).toThrow(/parking|source|provenance|receipt|停车|来源/i);

  const orphanSource = structuredClone(committed);
  const orphan = structuredClone(first.parkingSource) as typeof first.parkingSource & { pickupDate?: string };
  (orphan as unknown as { id: string }).id = "PARK-ORPHAN-WITHOUT-RECEIPT";
  (orphan as unknown as { pickupDate: string }).pickupDate = orphan.notificationDate;
  orphanSource.parkingCases.push(orphan);
  expect(() => validateLinkedOperationsState(orphanSource)).toThrow(/parking|source|provenance|receipt|停车|来源/i);

  const coordinatedRename = structuredClone(committed);
  const renamedSource = coordinatedRename.parkingCases.find((candidate) => candidate.id === first.parkingSource.id)!;
  (renamedSource as unknown as { id: string }).id = "PARK-COORDINATED-RENAME";
  const renamedReceipt = coordinatedRename.mutationReceipts.find((receipt) => receipt.mutationId === "parking-source-public-a")!;
  ((renamedReceipt.result as { parkingSource: { id: string } }).parkingSource).id = "PARK-COORDINATED-RENAME";
  const renamedOrigin = coordinatedRename.parkingSourceOrigins.find((origin) => origin.id === first.parkingSource.id)!;
  (renamedOrigin as unknown as { id: string }).id = "PARK-COORDINATED-RENAME";
  (renamedOrigin.initialSource as unknown as { id: string }).id = "PARK-COORDINATED-RENAME";
  const { commitment: _renamedCommitment, ...renamedOriginWithoutCommitment } = renamedOrigin;
  (renamedOrigin as unknown as { commitment: string }).commitment = parkingSourceOriginCommitment(renamedOriginWithoutCommitment);
  expect(() => validateLinkedOperationsState(coordinatedRename)).toThrow(/parking|source|id|receipt|停车|来源/i);

  const coordinatedUnexpected = structuredClone(committed);
  const unexpectedReceipt = coordinatedUnexpected.mutationReceipts.find((receipt) => receipt.mutationId === "parking-source-public-a")!;
  const unexpectedReceiptSource = (unexpectedReceipt.result as { parkingSource: Record<string, unknown> }).parkingSource;
  unexpectedReceiptSource.unexpectedCanonicalField = "coordinated";
  const unexpectedOrigin = coordinatedUnexpected.parkingSourceOrigins.find((origin) => origin.id === first.parkingSource.id)!;
  (unexpectedOrigin.initialSource as unknown as Record<string, unknown>).unexpectedCanonicalField = "coordinated";
  const { commitment: _unexpectedCommitment, ...unexpectedOriginWithoutCommitment } = unexpectedOrigin;
  (unexpectedOrigin as unknown as { commitment: string }).commitment = parkingSourceOriginCommitment(unexpectedOriginWithoutCommitment);
  expect(() => validateLinkedOperationsState(coordinatedUnexpected)).toThrow(/parking|source|closed|unexpected|停车|来源/i);

  await expect(recordMockQuickPickup({
    orderId: "qbo-parking-public-b",
    expectedRevision: committed.revision,
    mutationId: "parking-source-public-b",
    channels: pickupChannels,
  }, frontdeskActor, store)).rejects.toMatchObject({ status: 409 });
  expect(stateSnapshot(store).parkingCases.filter((source) => source.vehicleId === first.parkingSource.vehicleId)).toEqual([first.parkingSource]);

  const fresh = createMockLinkedOperationsStore(storage);
  await fresh.ready();
  expect(stateSnapshot(fresh).parkingCases.filter((source) => isModernParkingSourceFact(source))).toEqual([first.parkingSource]);

  const pickedUp = await recordMockParkingSourcePickup({
    caseId: first.parkingSource.id,
    expectedRevision: stateSnapshot(store).revision,
    expectedSourceRevision: first.parkingSource.revision,
    mutationId: "parking-source-public-a-physical-pickup",
  }, frontdeskActor, store);
  const updated = stateSnapshot(store);
  expect(updated.parkingCases.find((source) => source.id === first.parkingSource.id)).toEqual(pickedUp.parkingSource);
  expect(pickedUp.parkingSource).toMatchObject({ revision: 2, pickupDate: first.parkingSource.notificationDate });
  expect((updated.mutationReceipts.find((receipt) => receipt.mutationId === "parking-source-public-a")?.result as {
    parkingSource: { revision: number };
  }).parkingSource.revision).toBe(1);
  expect(() => validateLinkedOperationsState(updated)).not.toThrow();
});

test("pickup cohort remains frozen across later restore and unsubmit lifecycle changes", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-cohort-history-a");
  const historyA = stateSnapshot(store).quickOrders.find((order) => order.id === "qbo-parking-cohort-history-a")!;
  await addSharedQuickOrder(store, "qbo-parking-cohort-history-b", undefined, {
    vehicleId: historyA.vehicleId,
    customerId: historyA.customerId,
  });
  await recordMockQuickOrderLifecycleMutation({
    contract: "quick_order_lifecycle_mutation_v1",
    kind: "void",
    orderId: "qbo-parking-cohort-history-b",
    expectedRevision: stateSnapshot(store).revision,
    mutationId: "parking-cohort-history-void",
    reason: "temporarily excluded before notification",
  }, frontdeskActor, store);
  const beforeNotice = stateSnapshot(store);
  const created = await recordMockQuickPickup({
    orderId: "qbo-parking-cohort-history-a",
    expectedRevision: beforeNotice.revision,
    mutationId: "parking-source-cohort-history",
    channels: pickupChannels,
  }, frontdeskActor, store);
  expect(created.parkingSource.eligibleBusinessOrderIds).toEqual([
    "qbo-parking-cohort-history-a",
  ]);

  const beforeRestore = stateSnapshot(store);
  const restored = await recordMockQuickOrderLifecycleMutation({
    contract: "quick_order_lifecycle_mutation_v1",
    kind: "restore",
    orderId: "qbo-parking-cohort-history-b",
    expectedRevision: beforeRestore.revision,
    mutationId: "parking-cohort-history-restore",
  }, frontdeskActor, store);
  expect(restored).toEqual({
    contract: "quick_order_lifecycle_mutation_result_v2",
    revision: beforeRestore.revision + 1,
    kind: "restore",
    orderId: "qbo-parking-cohort-history-b",
    affectedOrderIds: ["qbo-parking-cohort-history-b"],
    committedAt: expect.any(String),
  });
  expect(stateSnapshot(store).parkingCases.find((candidate) => candidate.id === created.parkingSource.id)).toMatchObject({
    eligibleBusinessOrderIds: [
      "qbo-parking-cohort-history-a",
    ],
  });

  const stableStore = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(stableStore, "qbo-parking-cohort-unsubmit-a");
  const stableA = stateSnapshot(stableStore).quickOrders.find((order) => order.id === "qbo-parking-cohort-unsubmit-a")!;
  await addSharedQuickOrder(stableStore, "qbo-parking-cohort-unsubmit-b", undefined, {
    vehicleId: stableA.vehicleId,
    customerId: stableA.customerId,
  });
  const stableBefore = stateSnapshot(stableStore);
  const stable = await recordMockQuickPickup({
    orderId: "qbo-parking-cohort-unsubmit-a",
    expectedRevision: stableBefore.revision,
    mutationId: "parking-source-cohort-unsubmit",
    channels: pickupChannels,
  }, frontdeskActor, stableStore);
  await expect(applyMockQuickOrderAction(
    "qbo-parking-cohort-unsubmit-b",
    { kind: "unsubmit", reason: "post-notification correction" },
    frontdeskActor.name,
    "frontdesk",
    stableStore,
  )).resolves.toMatchObject({ status: "returned" });
  expect(stateSnapshot(stableStore).parkingCases.find((candidate) => candidate.id === stable.parkingSource.id)).toMatchObject({
    eligibleBusinessOrderIds: [
      "qbo-parking-cohort-unsubmit-a", "qbo-parking-cohort-unsubmit-b",
    ],
  });
});

test("runtime parking.source.migrate cannot self-assert provenance with the current anchor", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-runtime-migrate");
  const before = stateSnapshot(store);
  const order = before.quickOrders.find((candidate) => candidate.id === "qbo-parking-runtime-migrate")!;
  const source = modernParkingSource(order.id, order.vehicleId, "PARK-RUNTIME-MIGRATE");
  await expect(store.mutateIdempotently({
    mutationId: "parking-runtime-migrate",
    operation: "parking.source.migrate",
    actorId: "system:task8-migration",
    payload: { protectionAnchor: before.protectionAnchor, parkingSource: source },
    recordedAt: source.asOf,
  }, (draft) => {
    draft.parkingCases.push(source);
    draft.revision += 1;
    return { revision: draft.revision, parkingSource: source };
  }, { action: "test.parking-runtime-migrate.write", consumeWriteFault: false })).rejects.toThrow(/parking|source|provenance|migration|来源|保护/i);
  expect(stateSnapshot(store)).toEqual(before);
});

test("unrelated receipts cannot self-authorize a parking source revision or waiver basis", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-generic-receipt");
  const beforePickup = stateSnapshot(store);
  const created = await recordMockQuickPickup({
    orderId: "qbo-parking-generic-receipt",
    expectedRevision: beforePickup.revision,
    mutationId: "parking-generic-receipt-create",
    channels: pickupChannels,
  }, frontdeskActor, store);
  const before = stateSnapshot(store);
  const nextDate = new Date(Date.parse(`${created.parkingSource.notificationDate}T12:00:00Z`) + 7 * 86_400_000)
    .toISOString().slice(0, 10);
  const nextAsOf = `${nextDate}T12:00:00-05:00`;
  await expect(store.mutateIdempotently({
    mutationId: "parking-generic-receipt-update",
    operation: "quickOrders.notes.update",
    actorId: frontdeskActor.id,
    payload: { orderId: created.orderId, note: "unrelated" },
    recordedAt: nextAsOf,
  }, (draft) => {
    const source = draft.parkingCases.find((candidate) => candidate.id === created.parkingSource.id)!;
    if (!isModernParkingSourceFact(source)) throw new Error("expected modern parking source");
    Object.assign(source as unknown as Record<string, unknown>, {
      pickupDate: nextDate,
      revision: source.revision + 1,
      asOf: nextAsOf,
      accrual: calculateParkingAccrual({
        notificationDate: source.notificationDate,
        pickupDate: nextDate,
        dailyRateJmd: source.dailyRateJmd,
      }),
    });
    draft.revision += 1;
    return { revision: draft.revision, parkingSource: structuredClone(source) };
  }, { action: "test.parking-generic-receipt.write", consumeWriteFault: false }))
    .rejects.toThrow(/parking|source|transition|receipt|operation|停车|来源/i);
  expect(stateSnapshot(store)).toEqual(before);

  const coordinated = structuredClone(before);
  const basis = structuredClone(created.parkingSource);
  Object.assign(basis as unknown as Record<string, unknown>, {
    pickupDate: nextDate,
    revision: 2,
    asOf: nextAsOf,
    accrual: calculateParkingAccrual({
      notificationDate: basis.notificationDate,
      pickupDate: nextDate,
      dailyRateJmd: basis.dailyRateJmd,
    }),
  });
  const decision = {
    waiverContract: "parking_waiver_decision_v1" as const,
    sourceRevision: basis.revision,
    sourceAsOf: basis.asOf,
    ...validateParkingWaiver({
      caseId: basis.id,
      originalChargeableDays: basis.accrual.chargeableDays,
      dailyRateJmd: basis.dailyRateJmd,
      existingWaivedDays: 0,
      existingWaivedAmountJmd: 0,
      proposedWaivedDays: 1,
      proposedWaivedAmountJmd: basis.dailyRateJmd,
    }),
  };
  const forgedCurrent = coordinated.parkingCases.find((candidate) => candidate.id === created.parkingSource.id)!;
  Object.assign(forgedCurrent as unknown as Record<string, unknown>, {
    ...structuredClone(basis),
    revision: 3,
    waiverHistory: [decision],
    waiverReasons: ["self-reported basis"],
  });
  const payloadCanonical = `{"caseId":"${basis.id}","sourceRevision":${basis.revision}}`;
  coordinated.revision += 1;
  coordinated.mutationReceipts.push({
    id: "parking-generic-forged-basis",
    mutationId: "parking-generic-forged-basis",
    operation: "quickOrders.notes.update",
    actorId: frontdeskActor.id,
    payloadHash: receiptPayloadHash(payloadCanonical),
    payloadCanonical,
    result: { revision: coordinated.revision, parkingSource: basis },
    committedRevision: coordinated.revision,
    committedAt: nextAsOf,
  });
  expect(() => validateLinkedOperationsState(coordinated)).toThrow(/parking|source|transition|receipt|operation|waiver|停车|来源|减免/i);
});


test("pickup source request is closed and write/response/concurrency paths never duplicate notice or source", async () => {
  const scenario: { failNext: { byAction: Record<string, string> } } = { failNext: { byAction: {} } };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(storage);
    await addSharedQuickOrder(store, "qbo-parking-public-fault");
    const before = stateSnapshot(store);
    const input = {
      orderId: "qbo-parking-public-fault",
      expectedRevision: before.revision,
      mutationId: "parking-source-public-fault",
      channels: pickupChannels,
    };
    for (const extra of [
      { sourceRevision: 9 },
      { amountJmd: 1 },
      { notificationDate: "2020-01-01" },
      { parkingSource: { id: "spoof" } },
    ]) {
      await expect(recordMockQuickPickup({ ...input, ...extra } as never, frontdeskActor, store)).rejects.toMatchObject({ status: 400 });
      expect(stateSnapshot(store)).toEqual(before);
    }

    scenario.failNext.byAction["parking.source.create.write"] = "parking source write fault";
    await expect(recordMockQuickPickup(input, frontdeskActor, store)).rejects.toThrow(/write fault|写入/i);
    expect(stateSnapshot(store)).toEqual(before);

    scenario.failNext.byAction["parking.source.create.response"] = "parking source response loss";
    await expect(recordMockQuickPickup(input, frontdeskActor, store)).rejects.toThrow(/response loss|响应/i);
    const afterLoss = stateSnapshot(store);
    const replay = await recordMockQuickPickup(input, frontdeskActor, store);
    expect(stateSnapshot(store)).toEqual(afterLoss);
    expect(afterLoss.quickOrders.filter((order) => order.id === input.orderId && order.pickupNotice !== null)).toHaveLength(1);
    expect(afterLoss.parkingCases.filter((source) => (
      isModernParkingSourceFact(source) && source.originBusinessOrderId === input.orderId
    ))).toEqual([replay.parkingSource]);
    expect(afterLoss.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId)).toHaveLength(1);

    const raceStore = createMockLinkedOperationsStore(memoryStorage());
    await addSharedQuickOrder(raceStore, "qbo-parking-public-race-a");
    const raceA = stateSnapshot(raceStore).quickOrders.find((order) => order.id === "qbo-parking-public-race-a")!;
    await addSharedQuickOrder(raceStore, "qbo-parking-public-race-b", undefined, {
      vehicleId: raceA.vehicleId,
      customerId: raceA.customerId,
    });
    const raceRevision = stateSnapshot(raceStore).revision;
    const race = await Promise.allSettled([
      recordMockQuickPickup({ ...input, orderId: "qbo-parking-public-race-a", expectedRevision: raceRevision, mutationId: "parking-source-race-a" }, frontdeskActor, raceStore),
      recordMockQuickPickup({ ...input, orderId: "qbo-parking-public-race-b", expectedRevision: raceRevision, mutationId: "parking-source-race-b" }, frontdeskActor, raceStore),
    ]);
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((result) => result.status === "rejected")).toHaveLength(1);
    const raced = stateSnapshot(raceStore);
    expect(raced.parkingCases.filter((source) => (
      isModernParkingSourceFact(source)
        && source.eligibleBusinessOrderIds.includes("qbo-parking-public-race-a")
        && source.eligibleBusinessOrderIds.includes("qbo-parking-public-race-b")
    ))).toHaveLength(1);
    expect(raced.quickOrders.filter((order) => (
      (order.id === "qbo-parking-public-race-a" || order.id === "qbo-parking-public-race-b")
        && order.pickupNotice !== null
    ))).toHaveLength(1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("canonical parking preview and unclaimed apply use separate closed idempotent intents", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-waiver-unclaimed");
  const source = await addModernParkingSource(store, "qbo-parking-waiver-unclaimed", "PARK-WAIVER-UNCLAIMED");
  const beforePreview = stateSnapshot(store);
  const previewInput = {
    caseId: source.id,
    expectedRevision: beforePreview.revision,
    expectedSourceRevision: source.revision,
    mutationId: "parking-waiver-preview-unclaimed",
    waiveDays: 1,
    reason: "one closure day",
  };
  await expect(previewMockParkingWaiver(previewInput, financeActor as never, store))
    .rejects.toMatchObject({ status: 403 });
  expect(stateSnapshot(store)).toEqual(beforePreview);
  const preview = await previewMockParkingWaiver(previewInput, frontdeskActor, store);
  expect(preview).toMatchObject({
    caseId: source.id,
    latestRevision: beforePreview.revision + 1,
    sourceRevision: source.revision + 1,
    nextSourceRevision: source.revision + 2,
    proposedWaivedDays: 1,
    proposedWaivedAmountJmd: 2_500,
    finalAmountJmd: 10_000,
    parkingAdministratorSignatureRequired: false,
    invoiceSignatureRequired: false,
    claimedInvoiceId: null,
    nextInvoiceVersionId: null,
    nextSnapshotCommitment: null,
    parkingDeltaJmd: -2_500,
    parkingCashRefundJmd: 0,
    previewToken: expect.stringMatching(/^pwp_/),
  });
  const afterPreview = stateSnapshot(store);
  expect(afterPreview.parkingCases.find((candidate) => candidate.id === source.id)).toEqual(preview.parkingSource);
  expect(preview.sourceBefore).toEqual(source);
  expect(preview.parkingSource).toMatchObject({ revision: source.revision + 1, waiverHistory: [] });
  expect(afterPreview.mutationReceipts.filter((receipt) => receipt.operation === "parking.correction.preview")).toHaveLength(1);

  const applyInput = {
    caseId: source.id,
    expectedRevision: preview.latestRevision,
    expectedSourceRevision: preview.sourceRevision,
    mutationId: "parking-waiver-apply-unclaimed",
    previewToken: preview.previewToken,
  };
  await expect(applyMockParkingWaiver(applyInput, financeActor as never, store))
    .rejects.toMatchObject({ status: 403 });
  expect(stateSnapshot(store)).toEqual(afterPreview);
  const applied = await applyMockParkingWaiver(applyInput, frontdeskActor, store);
  expect(applied).toMatchObject({
    revision: preview.latestRevision + 1,
    caseId: source.id,
    sourceRevision: source.revision + 2,
    invoiceId: null,
    invoiceVersionId: null,
    parkingDeltaJmd: -2_500,
    parkingCashRefundJmd: 0,
  });
  const committed = stateSnapshot(store);
  const committedSource = committed.parkingCases.find((candidate) => candidate.id === source.id)!;
  expect(committedSource).toMatchObject({
    revision: source.revision + 2,
    waiverHistory: [expect.objectContaining({
      waiverContract: "parking_waiver_decision_v1",
      sourceRevision: preview.sourceRevision,
      sourceAsOf: preview.sourceAsOf,
      cumulativeWaivedDays: 1,
    })],
    waiverReasons: ["one closure day"],
  });
  expect(committed.invoices).toEqual(beforePreview.invoices);
  expect(committed.activeParkingClaim).toEqual(beforePreview.activeParkingClaim);
  expect(committed.mutationReceipts.filter((receipt) => receipt.operation === "parking.source.correct")).toHaveLength(1);
  expect(() => validateLinkedOperationsState(committed)).not.toThrow();

  const previewFinanceDrift = structuredClone(afterPreview);
  const previewFinanceReceipt = previewFinanceDrift.mutationReceipts.find((receipt) => (
    receipt.mutationId === previewInput.mutationId
  ))!;
  (previewFinanceReceipt as unknown as { actorId: string }).actorId = financeActor.id;
  expect(() => validateLinkedOperationsState(previewFinanceDrift))
    .toThrow(/parking|preview|actor|receipt|停车|操作员/i);

  const applyFinanceDrift = structuredClone(committed);
  const applyFinanceReceipt = applyFinanceDrift.mutationReceipts.find((receipt) => (
    receipt.mutationId === applyInput.mutationId
  ))!;
  (applyFinanceReceipt as unknown as { actorId: string }).actorId = financeActor.id;
  const applyFinanceAudit = applyFinanceDrift.parkingWaiverAudits.find((audit) => (
    audit.mutationId === applyInput.mutationId
  ))!;
  (applyFinanceAudit as unknown as { actorId: string }).actorId = financeActor.id;
  expect(() => validateLinkedOperationsState(applyFinanceDrift))
    .toThrow(/parking|correction|actor|receipt|audit|停车|操作员/i);

  const replay = await applyMockParkingWaiver(applyInput, frontdeskActor, store);
  expect(replay).toEqual(applied);
  expect(stateSnapshot(store)).toEqual(committed);

  await expect(previewMockParkingWaiver({ ...previewInput, amountJmd: 1 } as never, frontdeskActor, store))
    .rejects.toMatchObject({ status: 400 });
  await expect(applyMockParkingWaiver({ ...applyInput, waiveDays: 1 } as never, frontdeskActor, store))
    .rejects.toMatchObject({ status: 400 });
  await expect(applyMockParkingWaiver({ ...applyInput, mutationId: previewInput.mutationId }, frontdeskActor, store))
    .rejects.toMatchObject({ status: 409 });
});

test("parking administrator signatures use closed immutable provenance and current authorization only at commit", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:00:00-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const values = new Map<string, string>();
    const storage = memoryStorage(values);
    const store = createMockLinkedOperationsStore(storage);
    await addSharedQuickOrder(store, "qbo-parking-admin-history", undefined, {
      createdAt: "2026-07-01T08:00:00-05:00",
      submittedAt: "2026-07-01T09:00:00-05:00",
    });
    const source = await addModernParkingSource(store, "qbo-parking-admin-history", undefined, 30);
    const beforePreview = stateSnapshot(store);
    const previewInput = {
      caseId: source.id,
      expectedRevision: beforePreview.revision,
      expectedSourceRevision: source.revision,
      mutationId: "parking-admin-history-preview",
      waiveDays: 21,
      reason: "authorized long storage waiver",
    };
    const preview = await previewMockParkingWaiver(previewInput, frontdeskActor, store);
    expect(preview.parkingAdministratorSignatureRequired).toBe(true);
    expect(preview.proposedWaivedAmountJmd).toBe(52_500);
    const validEvidence = administratorEvidence({
      caseId: source.id,
      sourceRevision: preview.sourceRevision,
      cumulativeWaiverJmd: preview.proposedWaivedAmountJmd,
      reason: previewInput.reason,
      mutationId: "parking-admin-history-apply",
    });
    const applyBase = {
      caseId: source.id,
      expectedRevision: preview.latestRevision,
      expectedSourceRevision: preview.sourceRevision,
      previewToken: preview.previewToken,
      administratorId: validEvidence.administratorId,
    };
    const accessorEvidence = structuredClone(validEvidence);
    Object.defineProperty(accessorEvidence, "signatureHash", {
      enumerable: true,
      configurable: true,
      get: () => validEvidence.signatureHash,
    });
    const malformedEvidence: ReadonlyArray<{ label: string; evidence: AdministratorSignatureEvidence }> = [
      { label: "extra", evidence: { ...validEvidence, unexpected: true } as AdministratorSignatureEvidence },
      { label: "undefined", evidence: { ...validEvidence, unexpected: undefined } as AdministratorSignatureEvidence },
      { label: "accessor", evidence: accessorEvidence },
    ];
    const afterPreview = stateSnapshot(store);
    for (const malformed of malformedEvidence) {
      await expect(applyMockParkingWaiver({
        ...applyBase,
        mutationId: `parking-admin-malformed-${malformed.label}`,
        administratorSignature: malformed.evidence,
      }, frontdeskActor, store), malformed.label).rejects.toMatchObject({ status: 400 });
      expect(stateSnapshot(store)).toEqual(afterPreview);
    }
    await applyMockParkingWaiver({
      ...applyBase,
      mutationId: "parking-admin-history-apply",
      administratorSignature: validEvidence,
    }, frontdeskActor, store);
    expect(() => validateLinkedOperationsState(stateSnapshot(store))).not.toThrow();

    await store.mutate((draft) => {
      draft.trustedIdentities = draft.trustedIdentities.filter((identity) => identity.id !== "emp-001");
      draft.revision += 1;
    }, { action: "test.parking-admin-revoke.write", consumeWriteFault: false });
    const afterRevocation = stateSnapshot(store);
    expect(() => validateLinkedOperationsState(afterRevocation)).not.toThrow();
    const reloaded = createMockLinkedOperationsStore(storage);
    await expect(reloaded.ready()).resolves.toBeUndefined();
    expect(() => validateLinkedOperationsState(stateSnapshot(reloaded))).not.toThrow();

    const injectedStore = createMockLinkedOperationsStore(memoryStorage());
    await addSharedQuickOrder(injectedStore, "qbo-parking-admin-injected", undefined, {
      createdAt: "2026-07-01T08:00:00-05:00",
      submittedAt: "2026-07-01T09:00:00-05:00",
    });
    const injectedSource = await addModernParkingSource(injectedStore, "qbo-parking-admin-injected", undefined, 30);
    await injectedStore.mutate((draft) => {
      draft.trustedIdentities.push({ id: "emp-admin-injected", role: "superadmin" });
      draft.revision += 1;
    }, { action: "test.parking-admin-inject.write", consumeWriteFault: false });
    const beforeInjectedPreview = stateSnapshot(injectedStore);
    const injectedReason = "unknown administrator must fail";
    const injectedPreview = await previewMockParkingWaiver({
      caseId: injectedSource.id,
      expectedRevision: beforeInjectedPreview.revision,
      expectedSourceRevision: injectedSource.revision,
      mutationId: "parking-admin-injected-preview",
      waiveDays: 21,
      reason: injectedReason,
    }, frontdeskActor, injectedStore);
    const injectedEvidence = administratorEvidence({
      caseId: injectedSource.id,
      sourceRevision: injectedPreview.sourceRevision,
      cumulativeWaiverJmd: injectedPreview.proposedWaivedAmountJmd,
      reason: injectedReason,
      mutationId: "parking-admin-injected-apply",
      administratorId: "emp-admin-injected",
    });
    const beforeInjectedApply = stateSnapshot(injectedStore);
    await expect(applyMockParkingWaiver({
      caseId: injectedSource.id,
      expectedRevision: injectedPreview.latestRevision,
      expectedSourceRevision: injectedPreview.sourceRevision,
      mutationId: "parking-admin-injected-apply",
      previewToken: injectedPreview.previewToken,
      administratorId: injectedEvidence.administratorId,
      administratorSignature: injectedEvidence,
    }, frontdeskActor, injectedStore)).rejects.toMatchObject({ status: 403 });
    expect(stateSnapshot(injectedStore)).toEqual(beforeInjectedApply);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("modern parking preview tokens are exact closed server-recomputed facts with bidirectional receipts", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-preview-closed");
  const source = await addModernParkingSource(store, "qbo-parking-preview-closed", "PARK-PREVIEW-CLOSED");
  const before = stateSnapshot(store);
  const preview = await previewMockParkingWaiver({
    caseId: source.id,
    expectedRevision: before.revision,
    expectedSourceRevision: source.revision,
    mutationId: "parking-preview-closed",
    waiveDays: 1,
    reason: "closed preview reason",
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();

  const shiftJamaicaInstant = (instant: string, deltaMs: number): string => {
    const localClock = new Date(Date.parse(instant) + deltaMs - 5 * 60 * 60 * 1_000).toISOString();
    return `${localClock.slice(0, -1)}-05:00`;
  };
  const mutations: ReadonlyArray<{
    readonly label: string;
    readonly mutate: (token: LinkedModernParkingCorrectionPreviewToken) => void;
  }> = [
    { label: "unexpected token field", mutate: (token) => { (token as unknown as Record<string, unknown>).unexpectedCanonicalField = true; } },
    { label: "waive days", mutate: (token) => { (token as unknown as { waiveDays: number }).waiveDays += 1; } },
    { label: "reason", mutate: (token) => { (token as unknown as { reason: string }).reason = "drifted reason"; } },
    { label: "sourceStored", mutate: (token) => { (token.sourceStored as unknown as Record<string, unknown>).unexpectedCanonicalField = true; } },
    { label: "sourceBefore", mutate: (token) => { (token.sourceBefore as unknown as Record<string, unknown>).unexpectedCanonicalField = true; } },
    {
      label: "nextParkingSource",
      mutate: (token) => {
        (token.nextParkingSource as unknown as { asOf: string }).asOf = shiftJamaicaInstant(token.nextParkingSource.asOf, 1_000);
      },
    },
    {
      label: "decision",
      mutate: (token) => {
        (token.decision as unknown as { proposedWaivedDays: number }).proposedWaivedDays += 1;
      },
    },
    {
      label: "claim",
      mutate: (token) => {
        (token as unknown as { claim: unknown }).claim = {
          logicalInvoiceId: "invoice-forged",
          financiallyEffectiveVersionId: "invoice-forged-v1",
          chargeLineId: "parking-forged",
        };
      },
    },
    { label: "ledger high-water", mutate: (token) => { (token as unknown as { ledgerHighWaterRevision: number }).ledgerHighWaterRevision += 1; } },
    { label: "next Invoice", mutate: (token) => { (token as unknown as { nextInvoiceVersion: unknown }).nextInvoiceVersion = {}; } },
    { label: "next commitment", mutate: (token) => { (token as unknown as { nextSnapshotCommitment: string | null }).nextSnapshotCommitment = "sha256-forged"; } },
    { label: "old amount", mutate: (token) => { (token as unknown as { oldParkingAmountJmd: number }).oldParkingAmountJmd += 1; } },
    { label: "new amount", mutate: (token) => { (token as unknown as { newParkingAmountJmd: number }).newParkingAmountJmd += 1; } },
    { label: "delta", mutate: (token) => { (token as unknown as { parkingDeltaJmd: number }).parkingDeltaJmd -= 1; } },
    { label: "cash", mutate: (token) => { (token as unknown as { parkingCashRefundJmd: number }).parkingCashRefundJmd += 1; } },
    {
      label: "administrator signature flag",
      mutate: (token) => {
        (token as unknown as { parkingAdministratorSignatureRequired: boolean }).parkingAdministratorSignatureRequired = true;
      },
    },
    {
      label: "Invoice signature flag",
      mutate: (token) => { (token as unknown as { invoiceSignatureRequired: boolean }).invoiceSignatureRequired = true; },
    },
    {
      label: "issued time",
      mutate: (token) => { (token as unknown as { issuedAt: string }).issuedAt = shiftJamaicaInstant(token.issuedAt, 1_000); },
    },
    {
      label: "expiry time",
      mutate: (token) => { (token as unknown as { expiresAt: string }).expiresAt = shiftJamaicaInstant(token.expiresAt, 1_000); },
    },
    {
      label: "unpaired consumption",
      mutate: (token) => { token.consumedAt = shiftJamaicaInstant(token.issuedAt, 2_000); },
    },
  ];
  const accepted: string[] = [];
  for (const mutation of mutations) {
    const drifted = structuredClone(canonical);
    const token = drifted.parkingWaiverPreviews.find((candidate) => candidate.id === preview.previewToken);
    if (!token || token.previewContract !== "parking_correction_preview_v1") throw new Error("expected modern preview token");
    mutation.mutate(token);
    try {
      validateLinkedOperationsState(drifted);
      accepted.push(mutation.label);
    } catch {
      // Desired fail-closed result.
    }
  }
  expect(accepted).toEqual([]);

  const coordinatedReason = structuredClone(canonical);
  const coordinatedToken = coordinatedReason.parkingWaiverPreviews.find((candidate) => candidate.id === preview.previewToken);
  if (!coordinatedToken || coordinatedToken.previewContract !== "parking_correction_preview_v1") {
    throw new Error("expected modern preview token");
  }
  (coordinatedToken as unknown as { reason: string }).reason = "coordinated reason drift";
  const previewReceipt = coordinatedReason.mutationReceipts.find((receipt) => receipt.operation === "parking.correction.preview")!;
  const mutableReceipt = previewReceipt as unknown as { payloadCanonical: string; payloadHash: string };
  const payload = JSON.parse(mutableReceipt.payloadCanonical) as Record<string, unknown>;
  payload.reason = "coordinated reason drift";
  mutableReceipt.payloadCanonical = JSON.stringify(payload);
  mutableReceipt.payloadHash = receiptPayloadHash(mutableReceipt.payloadCanonical);
  expect(() => validateLinkedOperationsState(coordinatedReason)).toThrow(/parking|preview|token|receipt|reason|停车|预览|来源/i);

  const orphan = structuredClone(canonical);
  const orphanToken = structuredClone(orphan.parkingWaiverPreviews.find((candidate) => candidate.id === preview.previewToken)!);
  (orphanToken as unknown as { id: string }).id = `${preview.previewToken}-orphan`;
  orphan.parkingWaiverPreviews.push(orphanToken);
  expect(() => validateLinkedOperationsState(orphan)).toThrow(/parking|preview|token|receipt|reverse|停车|预览/i);
});

test("parking source transitions advance their per-case committed ledger revision strictly", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-transition-ledger");
  const source = await addModernParkingSource(store, "qbo-parking-transition-ledger", "PARK-TRANSITION-LEDGER");
  const beforePreview = stateSnapshot(store);
  const preview = await previewMockParkingWaiver({
    caseId: source.id,
    expectedRevision: beforePreview.revision,
    expectedSourceRevision: source.revision,
    mutationId: "parking-transition-ledger-preview",
    waiveDays: 1,
    reason: "strict transition order",
  }, frontdeskActor, store);
  await applyMockParkingWaiver({
    caseId: source.id,
    expectedRevision: preview.latestRevision,
    expectedSourceRevision: preview.sourceRevision,
    mutationId: "parking-transition-ledger-apply",
    previewToken: preview.previewToken,
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();
  const createReceipt = canonical.mutationReceipts.find((receipt) => receipt.operation === "parking.source.create")!;
  const pickupReceipt = canonical.mutationReceipts.find((receipt) => receipt.operation === "parking.source.pickup")!;
  const previewReceipt = canonical.mutationReceipts.find((receipt) => receipt.operation === "parking.correction.preview")!;
  const applyReceipt = canonical.mutationReceipts.find((receipt) => receipt.operation === "parking.source.correct")!;
  const cases = [
    { label: "pickup", mutationId: pickupReceipt.mutationId, priorRevision: createReceipt.committedRevision, resultRevisionKey: "revision" },
    { label: "preview", mutationId: previewReceipt.mutationId, priorRevision: pickupReceipt.committedRevision, resultRevisionKey: "latestRevision" },
    { label: "correction", mutationId: applyReceipt.mutationId, priorRevision: previewReceipt.committedRevision, resultRevisionKey: "revision" },
  ] as const;
  const accepted: string[] = [];
  for (const entry of cases) {
    const drifted = structuredClone(canonical);
    const receipt = drifted.mutationReceipts.find((candidate) => candidate.mutationId === entry.mutationId)!;
    const mutable = receipt as unknown as {
      payloadCanonical: string;
      payloadHash: string;
      committedRevision: number;
      result: Record<string, unknown>;
    };
    const payload = JSON.parse(mutable.payloadCanonical) as Record<string, unknown>;
    payload.expectedRevision = entry.priorRevision - 1;
    mutable.payloadCanonical = JSON.stringify(payload);
    mutable.payloadHash = receiptPayloadHash(mutable.payloadCanonical);
    mutable.committedRevision = entry.priorRevision;
    mutable.result[entry.resultRevisionKey] = entry.priorRevision;
    try {
      validateLinkedOperationsState(drifted);
      accepted.push(entry.label);
    } catch {
      // Desired fail-closed result.
    }
  }
  expect(accepted).toEqual([]);
});

test("consumed parking previews and waiver audits are exactly paired with one apply receipt", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-audit-closure");
  const source = await addModernParkingSource(store, "qbo-parking-audit-closure", "PARK-AUDIT-CLOSURE");
  const beforePreview = stateSnapshot(store);
  const preview = await previewMockParkingWaiver({
    caseId: source.id,
    expectedRevision: beforePreview.revision,
    expectedSourceRevision: source.revision,
    mutationId: "parking-audit-closure-preview",
    waiveDays: 1,
    reason: "audit closure reason",
  }, frontdeskActor, store);
  const applyMutationId = "parking-audit-closure-apply";
  await applyMockParkingWaiver({
    caseId: source.id,
    expectedRevision: preview.latestRevision,
    expectedSourceRevision: preview.sourceRevision,
    mutationId: applyMutationId,
    previewToken: preview.previewToken,
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();
  const auditIndex = canonical.parkingWaiverAudits.findIndex((audit) => audit.mutationId === applyMutationId);
  expect(auditIndex).toBeGreaterThanOrEqual(0);
  const coordinatedApplyTime = (state: LinkedOperationsState, targetMs: number): void => {
    const localClock = new Date(targetMs - 5 * 60 * 60 * 1_000).toISOString();
    const target = `${localClock.slice(0, -1)}-05:00`;
    const token = state.parkingWaiverPreviews.find((candidate) => candidate.id === preview.previewToken);
    const receipt = state.mutationReceipts.find((candidate) => candidate.mutationId === applyMutationId)!;
    const audit = state.parkingWaiverAudits.find((candidate) => candidate.mutationId === applyMutationId)!;
    if (!token || token.previewContract !== "parking_correction_preview_v1") throw new Error("expected modern token");
    token.consumedAt = target;
    (receipt as unknown as { committedAt: string }).committedAt = target;
    (audit as unknown as { appliedAt: string }).appliedAt = target;
  };
  const mutants: ReadonlyArray<{ readonly label: string; readonly mutate: (state: LinkedOperationsState) => void }> = [
    { label: "missing", mutate: (state) => { state.parkingWaiverAudits.splice(auditIndex, 1); } },
    {
      label: "extra",
      mutate: (state) => {
        const copy = structuredClone(state.parkingWaiverAudits[auditIndex]!);
        (copy as unknown as { id: string }).id = `${copy.id}-extra`;
        state.parkingWaiverAudits.push(copy);
      },
    },
    {
      label: "reason drift",
      mutate: (state) => {
        (state.parkingWaiverAudits[auditIndex] as unknown as { reason: string }).reason = "drifted audit reason";
      },
    },
    {
      label: "actor drift",
      mutate: (state) => {
        (state.parkingWaiverAudits[auditIndex] as unknown as { actorId: string }).actorId = "emp-tampered";
      },
    },
    {
      label: "time drift",
      mutate: (state) => {
        (state.parkingWaiverAudits[auditIndex] as unknown as { appliedAt: string }).appliedAt = "2026-08-21T12:00:01-05:00";
      },
    },
    {
      label: "decision drift",
      mutate: (state) => {
        const audit = state.parkingWaiverAudits[auditIndex]!;
        (audit.preview as unknown as { proposedWaivedDays: number }).proposedWaivedDays += 1;
      },
    },
    {
      label: "apply after token expiry",
      mutate: (state) => {
        const token = state.parkingWaiverPreviews.find((candidate) => candidate.id === preview.previewToken)!;
        coordinatedApplyTime(state, Date.parse(token.expiresAt) + 1);
      },
    },
    {
      label: "apply before token issue",
      mutate: (state) => {
        const token = state.parkingWaiverPreviews.find((candidate) => candidate.id === preview.previewToken)!;
        coordinatedApplyTime(state, Date.parse(token.issuedAt) - 1);
      },
    },
  ];
  const accepted: string[] = [];
  for (const mutant of mutants) {
    const drifted = structuredClone(canonical);
    mutant.mutate(drifted);
    try {
      validateLinkedOperationsState(drifted);
      accepted.push(mutant.label);
    } catch {
      // Desired fail-closed result.
    }
  }
  expect(accepted).toEqual([]);
});

test("Invoice activation materializes exactly its own parking projection cases and no unrelated source", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:00:00-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    await addSharedQuickOrder(store, "qbo-parking-activation-own-a");
    const initial = stateSnapshot(store);
    const orderA = initial.quickOrders.find((candidate) => candidate.id === "qbo-parking-activation-own-a")!;
    const vehicleA = initial.vehicles.find((candidate) => candidate.id === orderA.vehicleId)!;
    const vehicleB = { ...structuredClone(vehicleA), id: "vehicle-parking-activation-own-b", plate: "OWN-B-2026" };
    await store.mutate((draft) => {
      draft.vehicles.push(vehicleB);
      draft.revision += 1;
    }, { action: "test.parking-activation-second-vehicle.write", consumeWriteFault: false });
    await addSharedQuickOrder(store, "qbo-parking-activation-own-b", undefined, {
      vehicleId: vehicleB.id,
      customerId: vehicleB.customerId,
    });
    scenario.nowMs -= 7 * 86_400_000;
    let state = stateSnapshot(store);
    const sourceA = await recordMockQuickPickup({
      orderId: "qbo-parking-activation-own-a",
      expectedRevision: state.revision,
      mutationId: "parking-activation-own-source-a",
      channels: pickupChannels,
    }, frontdeskActor, store);
    state = stateSnapshot(store);
    const sourceB = await recordMockQuickPickup({
      orderId: "qbo-parking-activation-own-b",
      expectedRevision: state.revision,
      mutationId: "parking-activation-own-source-b",
      channels: pickupChannels,
    }, frontdeskActor, store);
    scenario.nowMs += 7 * 86_400_000;
    state = stateSnapshot(store);
    await activateMockQuickInvoiceSnapshot({
      orderId: sourceA.orderId,
      expectedRevision: state.revision,
      mutationId: "parking-activation-own-invoice-a",
    }, frontdeskActor, store);
    const canonical = stateSnapshot(store);
    expect(() => validateLinkedOperationsState(canonical)).not.toThrow();

    const drifted = structuredClone(canonical);
    const receipt = drifted.mutationReceipts.find((candidate) => candidate.mutationId === "parking-activation-own-invoice-a")!;
    const result = receipt.result as {
      parkingSourceTransitions: Array<{
        caseId: string;
        sourceBefore: typeof sourceB.parkingSource;
        parkingSource: typeof sourceB.parkingSource;
      }>;
    };
    const unrelatedBefore = structuredClone(sourceB.parkingSource);
    const unrelatedAfter = {
      ...structuredClone(unrelatedBefore),
      revision: unrelatedBefore.revision + 1,
      asOf: receipt.committedAt,
      accrual: calculateParkingAccrual({
        notificationDate: unrelatedBefore.notificationDate,
        pickupDate: receipt.committedAt.slice(0, 10),
        dailyRateJmd: unrelatedBefore.dailyRateJmd,
      }),
    };
    result.parkingSourceTransitions.push({
      caseId: unrelatedBefore.id,
      sourceBefore: unrelatedBefore,
      parkingSource: unrelatedAfter,
    });
    const unrelatedIndex = drifted.parkingCases.findIndex((candidate) => candidate.id === unrelatedBefore.id);
    drifted.parkingCases[unrelatedIndex] = unrelatedAfter;
    expect(() => validateLinkedOperationsState(drifted)).toThrow(/parking|activation|projection|Invoice|eligible|claim|停车|投影|占用/i);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("claimed physical pickup atomically reprojects Invoice V2 and transfers every claim without Invoice signature", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:00:00-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    await addSharedQuickOrder(store, "qbo-parking-claimed-pickup");
    const closedSource = await addModernParkingSource(
      store,
      "qbo-parking-claimed-pickup",
      "PARK-CLAIMED-PICKUP-CLOSED",
      7,
      true,
    );
    const openSource = await addModernParkingSource(
      store,
      "qbo-parking-claimed-pickup",
      "PARK-CLAIMED-PICKUP-OPEN",
      7,
      false,
    );
    const activation = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-parking-claimed-pickup",
      expectedRevision: stateSnapshot(store).revision,
      mutationId: "parking-claimed-pickup-v1",
    }, frontdeskActor, store);
    const activated = stateSnapshot(store);
    const activatedInvoice = activated.invoices.find((candidate) => candidate.id === activation.invoiceId)!;
    if (!isSharedChargeInvoice(activatedInvoice)) throw new Error("expected shared Invoice");
    const v1 = structuredClone(activatedInvoice.versions[0]!);
    const v1ParkingLines = v1.snapshot.lines.filter((line) => line.pricingMode === "parking_projection");
    expect(v1ParkingLines).toHaveLength(2);
    const openLineV1 = v1ParkingLines.find((line) => line.parkingCaseId === openSource.id)!;
    const closedLineV1 = v1ParkingLines.find((line) => line.parkingCaseId === closedSource.id)!;
    const materializedOpenSource = activated.parkingCases.find((candidate) => candidate.id === openSource.id)!;
    if (!isModernParkingSourceFact(materializedOpenSource)) throw new Error("expected modern parking source");
    expect(activated.activeParkingClaim[openSource.id]?.financiallyEffectiveVersionId).toBe(v1.id);
    expect(activated.activeParkingClaim[closedSource.id]?.financiallyEffectiveVersionId).toBe(v1.id);

    scenario.nowMs += 2 * 86_400_000;
    const beforePickup = stateSnapshot(store);
    let pickupFailure: unknown;
    let pickupResult: Awaited<ReturnType<typeof recordMockParkingSourcePickup>> | undefined;
    try {
      pickupResult = await recordMockParkingSourcePickup({
        caseId: openSource.id,
        expectedRevision: beforePickup.revision,
        expectedSourceRevision: materializedOpenSource.revision,
        mutationId: "parking-claimed-physical-pickup",
      }, frontdeskActor, store);
    } catch (error) {
      pickupFailure = error;
    }
    if (pickupFailure !== undefined) expect(stateSnapshot(store)).toEqual(beforePickup);
    expect(pickupFailure).toBeUndefined();

    const committed = stateSnapshot(store);
    const invoice = committed.invoices.find((candidate) => candidate.id === activation.invoiceId)!;
    if (!isSharedChargeInvoice(invoice)) throw new Error("expected shared Invoice");
    expect(invoice.versions).toHaveLength(2);
    expect(invoice.versions[0]).toEqual(v1);
    const v2 = invoice.versions[1]!;
    expect(invoice.financiallyEffectiveVersionId).toBe(v2.id);
    const openLineV2 = v2.snapshot.lines.find((line) => (
      line.pricingMode === "parking_projection" && line.parkingCaseId === openSource.id
    ))!;
    const closedLineV2 = v2.snapshot.lines.find((line) => (
      line.pricingMode === "parking_projection" && line.parkingCaseId === closedSource.id
    ))!;
    expect(openLineV2).toMatchObject({
      chargeLineId: openLineV1.chargeLineId,
      sourceRevision: materializedOpenSource.revision + 1,
      amountJmd: openLineV1.amountJmd + 5_000,
    });
    expect(closedLineV2).toEqual(closedLineV1);
    expect(v2.snapshot.lines.filter((line) => line.pricingMode !== "parking_projection"))
      .toEqual(v1.snapshot.lines.filter((line) => line.pricingMode !== "parking_projection"));
    expect(v2.snapshot.adjustments).toEqual(v1.snapshot.adjustments);
    expect(v2.snapshot.totals.grandTotalJmd).toBe(v1.snapshot.totals.grandTotalJmd + 5_000);
    expect(committed.activeParkingClaim[openSource.id]).toEqual({
      logicalInvoiceId: invoice.id,
      financiallyEffectiveVersionId: v2.id,
      chargeLineId: openLineV1.chargeLineId,
    });
    expect(committed.activeParkingClaim[closedSource.id]).toEqual({
      logicalInvoiceId: invoice.id,
      financiallyEffectiveVersionId: v2.id,
      chargeLineId: closedLineV1.chargeLineId,
    });
    expect(committed.discountSignatureEvents.filter((event) => event.mutationId === "parking-claimed-physical-pickup"))
      .toHaveLength(0);
    expect(committed.billingAuditEvents.filter((event) => event.mutationId === "parking-claimed-physical-pickup"))
      .toHaveLength(1);
    expect(committed.refunds).toEqual(beforePickup.refunds);
    expect(committed.mutationReceipts.filter((receipt) => receipt.mutationId === "parking-claimed-physical-pickup"))
      .toHaveLength(1);
    expect(pickupResult).toMatchObject({
      revision: committed.revision,
      caseId: openSource.id,
      sourceRevision: materializedOpenSource.revision + 1,
      invoiceId: invoice.id,
      invoiceVersionId: v2.id,
      parkingDeltaJmd: 5_000,
      parkingCashRefundJmd: 0,
    });
    expect(() => validateLinkedOperationsState(committed)).not.toThrow();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("unclaimed physical pickup result cannot invent Invoice coordinates or a source delta", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-unclaimed-pickup-result");
  const source = await addModernParkingSource(
    store,
    "qbo-parking-unclaimed-pickup-result",
    "PARK-UNCLAIMED-PICKUP-RESULT",
    7,
    false,
  );
  const beforePickup = stateSnapshot(store);
  const result = await recordMockParkingSourcePickup({
    caseId: source.id,
    expectedRevision: beforePickup.revision,
    expectedSourceRevision: source.revision,
    mutationId: "parking-unclaimed-pickup-result",
  }, frontdeskActor, store);
  expect(result).toMatchObject({
    invoiceId: null,
    previousInvoiceVersionId: null,
    invoiceVersionId: null,
    snapshotCommitment: null,
    parkingCashRefundJmd: 0,
  });
  const canonical = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();
  const mutations: Array<(draft: LinkedOperationsState) => void> = [
    (draft) => {
      const receipt = draft.mutationReceipts.find((candidate) => candidate.mutationId === "parking-unclaimed-pickup-result")!;
      (receipt.result as { parkingDeltaJmd: number }).parkingDeltaJmd += 1;
    },
    (draft) => {
      const receipt = draft.mutationReceipts.find((candidate) => candidate.mutationId === "parking-unclaimed-pickup-result")!;
      (receipt.result as { invoiceId: string | null }).invoiceId = "invoice-invented";
    },
    (draft) => {
      const receipt = draft.mutationReceipts.find((candidate) => candidate.mutationId === "parking-unclaimed-pickup-result")!;
      (receipt.result as { snapshotCommitment: string | null }).snapshotCommitment = `sha256-utf16le:${"0".repeat(64)}`;
    },
  ];
  for (const mutate of mutations) {
    const drifted = structuredClone(canonical);
    mutate(drifted);
    expect(() => validateLinkedOperationsState(drifted)).toThrow(/parking|pickup|result|Invoice|delta|停车|取车/i);
  }
});

test("claimed physical pickup actor is independently resolved from the canonical staff catalog", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:00:00-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    await addSharedQuickOrder(store, "qbo-parking-pickup-audit-actor");
    const source = await addModernParkingSource(
      store,
      "qbo-parking-pickup-audit-actor",
      "PARK-PICKUP-AUDIT-ACTOR",
      7,
      false,
    );
    await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-parking-pickup-audit-actor",
      expectedRevision: stateSnapshot(store).revision,
      mutationId: "parking-pickup-audit-actor-v1",
    }, frontdeskActor, store);
    scenario.nowMs += 86_400_000;
    const beforePickup = stateSnapshot(store);
    const currentSource = beforePickup.parkingCases.find((candidate) => candidate.id === source.id)!;
    const actorInput = {
      caseId: source.id,
      expectedRevision: beforePickup.revision,
      expectedSourceRevision: currentSource.revision,
    };
    await expect(recordMockParkingSourcePickup({
      ...actorInput,
      mutationId: "parking-pickup-audit-wrong-name",
    }, { ...frontdeskActor, name: "伪造操作员" }, store)).rejects.toMatchObject({ status: 403 });
    await expect(recordMockParkingSourcePickup({
      ...actorInput,
      mutationId: "parking-pickup-audit-wrong-role",
    }, { ...frontdeskActor, role: "finance" }, store)).rejects.toMatchObject({ status: 403 });
    await expect(recordMockParkingSourcePickup({
      ...actorInput,
      mutationId: "parking-pickup-audit-real-finance",
    }, financeActor as never, store)).rejects.toMatchObject({ status: 403 });
    expect(stateSnapshot(store)).toEqual(beforePickup);
    await recordMockParkingSourcePickup({
      ...actorInput,
      mutationId: "parking-pickup-audit-actor-v2",
    }, frontdeskActor, store);
    const canonical = stateSnapshot(store);
    const actorMutations = [
      { actorId: "emp-003", actorName: "伪造操作员" },
      { actorId: financeActor.id, actorName: financeActor.name },
      { actorId: "emp-005", actorName: "Marcus Brown" },
      { actorId: "emp-unknown", actorName: "Unknown Actor" },
    ];
    for (const mutation of actorMutations) {
      const drifted = structuredClone(canonical);
      const receipt = drifted.mutationReceipts.find((candidate) => (
        candidate.mutationId === "parking-pickup-audit-actor-v2"
      ))!;
      (receipt as unknown as { actorId: string }).actorId = mutation.actorId;
      Object.assign(receipt.result as Record<string, unknown>, mutation);
      const audit = drifted.billingAuditEvents.find((candidate) => (
        candidate.mutationId === "parking-pickup-audit-actor-v2"
      ))!;
      Object.assign(audit as unknown as Record<string, unknown>, mutation);
      expect(() => validateLinkedOperationsState(drifted)).toThrow(/PARKING|BILLING|binding|reprojection|actor|audit|账号|操作员/i);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("claimed physical pickup write fault rolls back while response loss replays one exact V2", async () => {
  const scenario: {
    nowMs: number;
    failNext: { byAction: Record<string, string> };
  } = {
    nowMs: Date.parse("2026-08-21T12:00:00-05:00"),
    failNext: { byAction: {} },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    await addSharedQuickOrder(store, "qbo-parking-pickup-fault-replay");
    const source = await addModernParkingSource(
      store,
      "qbo-parking-pickup-fault-replay",
      "PARK-PICKUP-FAULT-REPLAY",
      7,
      false,
    );
    const activation = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-parking-pickup-fault-replay",
      expectedRevision: stateSnapshot(store).revision,
      mutationId: "parking-pickup-fault-replay-v1",
    }, frontdeskActor, store);
    scenario.nowMs += 2 * 86_400_000;
    const beforePickup = stateSnapshot(store);
    const currentSource = beforePickup.parkingCases.find((candidate) => candidate.id === source.id)!;
    const input = {
      caseId: source.id,
      expectedRevision: beforePickup.revision,
      expectedSourceRevision: currentSource.revision,
      mutationId: "parking-pickup-fault-replay-v2",
    };
    scenario.failNext.byAction["parking.source.pickup.write"] = "claimed pickup write fault";
    await expect(recordMockParkingSourcePickup(input, frontdeskActor, store)).rejects.toThrow(/write fault|写入/i);
    expect(stateSnapshot(store)).toEqual(beforePickup);

    scenario.failNext.byAction["parking.source.pickup.response"] = "claimed pickup response loss";
    await expect(recordMockParkingSourcePickup(input, frontdeskActor, store)).rejects.toThrow(/response loss|响应/i);
    const afterLoss = stateSnapshot(store);
    const replay = await recordMockParkingSourcePickup(input, frontdeskActor, store);
    expect(stateSnapshot(store)).toEqual(afterLoss);
    const invoice = afterLoss.invoices.find((candidate) => candidate.id === activation.invoiceId)!;
    expect(invoice.versions).toHaveLength(2);
    expect(replay.invoiceVersionId).toBe(invoice.versions[1]!.id);
    expect(afterLoss.billingAuditEvents.filter((event) => event.mutationId === input.mutationId)).toHaveLength(1);
    expect(afterLoss.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId)).toHaveLength(1);
    expect(afterLoss.refunds.filter((refund) => (
      Object.prototype.hasOwnProperty.call(refund, "mutationId")
        && (refund as { mutationId?: string }).mutationId === input.mutationId
    ))).toHaveLength(0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("concurrent claimed pickups create one V2 and parking-only reprojection never consumes fresh discount strokes", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:00:00-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const highDiscountLine = {
      ...unit("parking-pickup-high-discount", 10_000),
      unitDiscountJmd: 2_500,
    };
    await addSharedQuickOrder(store, "qbo-parking-pickup-concurrent", [highDiscountLine]);
    const source = await addModernParkingSource(
      store,
      "qbo-parking-pickup-concurrent",
      "PARK-PICKUP-CONCURRENT",
      7,
      false,
    );
    const activation = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-parking-pickup-concurrent",
      expectedRevision: stateSnapshot(store).revision,
      mutationId: "parking-pickup-concurrent-v1",
      signature: { rawStrokes: FIRST_INVOICE_STROKES },
    }, frontdeskActor, store);
    const afterActivation = stateSnapshot(store);
    expect(afterActivation.discountSignatureEvents.filter((event) => event.document.id === activation.invoiceId))
      .toHaveLength(1);
    scenario.nowMs += 86_400_000;
    const currentSource = afterActivation.parkingCases.find((candidate) => candidate.id === source.id)!;
    const common = {
      caseId: source.id,
      expectedRevision: afterActivation.revision,
      expectedSourceRevision: currentSource.revision,
    };
    const settled = await Promise.allSettled([
      recordMockParkingSourcePickup({ ...common, mutationId: "parking-pickup-concurrent-a" }, frontdeskActor, store),
      recordMockParkingSourcePickup({ ...common, mutationId: "parking-pickup-concurrent-b" }, frontdeskActor, store),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    const committed = stateSnapshot(store);
    const invoice = committed.invoices.find((candidate) => candidate.id === activation.invoiceId)!;
    expect(invoice.versions).toHaveLength(2);
    expect(committed.discountSignatureEvents.filter((event) => event.document.id === activation.invoiceId))
      .toEqual(afterActivation.discountSignatureEvents.filter((event) => event.document.id === activation.invoiceId));
    const pickupReceipts = committed.mutationReceipts.filter((receipt) => (
      receipt.operation === "parking.source.pickup"
        && (receipt.mutationId === "parking-pickup-concurrent-a" || receipt.mutationId === "parking-pickup-concurrent-b")
    ));
    expect(pickupReceipts).toHaveLength(1);
    expect(committed.billingAuditEvents.filter((event) => (
      event.mutationId === "parking-pickup-concurrent-a" || event.mutationId === "parking-pickup-concurrent-b"
    ))).toHaveLength(1);
    expect(() => validateLinkedOperationsState(committed)).not.toThrow();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("claimed pickup rejects coordinated V1, V2, claim, audit, cash, and result-branch drift", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:00:00-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    await addSharedQuickOrder(store, "qbo-parking-pickup-mutants");
    const closedSource = await addModernParkingSource(store, "qbo-parking-pickup-mutants", undefined, 7, true);
    const openSource = await addModernParkingSource(store, "qbo-parking-pickup-mutants", undefined, 7, false);
    const activation = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-parking-pickup-mutants",
      expectedRevision: stateSnapshot(store).revision,
      mutationId: "parking-pickup-mutants-v1",
    }, frontdeskActor, store);
    scenario.nowMs += 2 * 86_400_000;
    const beforePickup = stateSnapshot(store);
    const currentSource = beforePickup.parkingCases.find((candidate) => candidate.id === openSource.id)!;
    await recordMockParkingSourcePickup({
      caseId: openSource.id,
      expectedRevision: beforePickup.revision,
      expectedSourceRevision: currentSource.revision,
      mutationId: "parking-pickup-mutants-v2",
    }, frontdeskActor, store);
    const canonical = stateSnapshot(store);
    expect(() => validateLinkedOperationsState(canonical)).not.toThrow();

    const rebuildVersion = (
      draft: LinkedOperationsState,
      versionIndex: number,
      mutateLines: (lines: ReturnType<typeof invoiceSnapshotLineToQuotedCharge>[]) => void,
      mutationId: string,
    ) => {
      const invoice = draft.invoices.find((candidate) => candidate.id === activation.invoiceId)!;
      if (!isSharedChargeInvoice(invoice)) throw new Error("expected shared Invoice");
      const version = invoice.versions[versionIndex]!;
      const quoted = version.snapshot.lines.map(invoiceSnapshotLineToQuotedCharge);
      mutateLines(quoted);
      const snapshot = buildInvoiceChargeSnapshot({
        sourceBusinessOrderId: version.snapshot.sourceBusinessOrderId,
        sourceBusinessOrderRevision: version.snapshot.sourceBusinessOrderRevision,
        lines: quoted,
        adjustments: version.snapshot.adjustments,
      });
      (version as unknown as { snapshot: typeof snapshot }).snapshot = snapshot;
      (version as unknown as { snapshotCommitment: string }).snapshotCommitment = billingSnapshotCommitment(snapshot);
      const audit = draft.billingAuditEvents.find((candidate) => candidate.mutationId === mutationId)!;
      if ("snapshotCommitment" in audit) {
        (audit as unknown as { snapshotCommitment: string }).snapshotCommitment = version.snapshotCommitment;
      }
      const receipt = draft.mutationReceipts.find((candidate) => candidate.mutationId === mutationId)!;
      if (receipt.result && typeof receipt.result === "object") {
        (receipt.result as { snapshotCommitment?: string }).snapshotCommitment = version.snapshotCommitment;
      }
      return { invoice, version, audit, receipt };
    };

    const mutations: Array<(draft: LinkedOperationsState) => void> = [
      (draft) => {
        rebuildVersion(draft, 0, (lines) => {
          const target = lines.find((line) => (
            line.pricingMode === "parking_projection" && line.parkingCaseId === openSource.id
          ))!;
          (target as unknown as { amountJmd: number }).amountJmd += 1;
        }, "parking-pickup-mutants-v1");
      },
      (draft) => {
        rebuildVersion(draft, 1, (lines) => {
          const target = lines.find((line) => (
            line.pricingMode === "parking_projection" && line.parkingCaseId === closedSource.id
          ))!;
          (target as unknown as { amountJmd: number }).amountJmd += 1;
        }, "parking-pickup-mutants-v2");
      },
      (draft) => {
        const { audit, receipt } = rebuildVersion(draft, 1, (lines) => {
          const target = lines.find((line) => (
            line.pricingMode === "parking_projection" && line.parkingCaseId === openSource.id
          ))!;
          (target as unknown as { amountJmd: number }).amountJmd += 1;
        }, "parking-pickup-mutants-v2");
        (audit as unknown as { newParkingAmountJmd: number; parkingDeltaJmd: number }).newParkingAmountJmd += 1;
        (audit as unknown as { parkingDeltaJmd: number }).parkingDeltaJmd += 1;
        (receipt.result as { parkingDeltaJmd: number }).parkingDeltaJmd += 1;
      },
      (draft) => {
        draft.activeParkingClaim[closedSource.id] = {
          ...draft.activeParkingClaim[closedSource.id]!,
          financiallyEffectiveVersionId: activation.invoiceVersionId,
        };
      },
      (draft) => {
        const audit = draft.billingAuditEvents.find((candidate) => candidate.mutationId === "parking-pickup-mutants-v2")!;
        (audit as unknown as { parkingCashRefundJmd: number }).parkingCashRefundJmd = 1;
        const receipt = draft.mutationReceipts.find((candidate) => candidate.mutationId === "parking-pickup-mutants-v2")!;
        (receipt.result as { parkingCashRefundJmd: number }).parkingCashRefundJmd = 1;
      },
      (draft) => {
        const receipt = draft.mutationReceipts.find((candidate) => candidate.mutationId === "parking-pickup-mutants-v2")!;
        Object.assign(receipt.result as Record<string, unknown>, {
          invoiceId: null,
          previousInvoiceVersionId: null,
          invoiceVersionId: null,
          snapshotCommitment: null,
        });
      },
    ];
    for (const mutate of mutations) {
      const drifted = structuredClone(canonical);
      mutate(drifted);
      expect(() => validateLinkedOperationsState(drifted)).toThrow(/parking|pickup|claim|snapshot|Invoice|BILLING|停车|取车/i);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("claimed pickup stale global, source, and prior-version observations return 409 with zero pickup write", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T12:00:00-05:00") };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    await addSharedQuickOrder(store, "qbo-parking-pickup-stale");
    const source = await addModernParkingSource(store, "qbo-parking-pickup-stale", undefined, 7, false);
    const activation = await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-parking-pickup-stale",
      expectedRevision: stateSnapshot(store).revision,
      mutationId: "parking-pickup-stale-v1",
    }, frontdeskActor, store);
    let state = stateSnapshot(store);
    const sourceAfterActivation = state.parkingCases.find((candidate) => candidate.id === source.id)!;
    const staleInput = {
      caseId: source.id,
      expectedRevision: state.revision,
      expectedSourceRevision: sourceAfterActivation.revision,
      mutationId: "parking-pickup-stale-global",
    };
    await recordMockInvoicePayment({
      invoiceId: activation.invoiceId,
      expectedRevision: state.revision,
      mutationId: "parking-pickup-stale-payment",
      amountJmd: 1_000,
      method: "cash",
    }, frontdeskActor, store);
    const afterPayment = stateSnapshot(store);
    await expect(recordMockParkingSourcePickup(staleInput, frontdeskActor, store)).rejects.toMatchObject({ status: 409 });
    expect(stateSnapshot(store)).toEqual(afterPayment);

    scenario.nowMs += 86_400_000;
    await activateMockQuickInvoiceSnapshot({
      orderId: "qbo-parking-pickup-stale",
      expectedRevision: afterPayment.revision,
      mutationId: "parking-pickup-stale-v2",
    }, frontdeskActor, store);
    state = stateSnapshot(store);
    const beforeSourceStale = structuredClone(state);
    await expect(recordMockParkingSourcePickup({
      caseId: source.id,
      expectedRevision: state.revision,
      expectedSourceRevision: sourceAfterActivation.revision,
      mutationId: "parking-pickup-stale-source-version",
    }, frontdeskActor, store)).rejects.toMatchObject({ status: 409 });
    expect(stateSnapshot(store)).toEqual(beforeSourceStale);
    expect(state.mutationReceipts.filter((receipt) => receipt.operation === "parking.source.pickup"
      && receipt.mutationId.startsWith("parking-pickup-stale-"))).toHaveLength(0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("an open protected legacy vehicle episode blocks canonical pickup source creation and mixed open episodes", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  const initial = stateSnapshot(store);
  const legacyOpen = initial.parkingCases.find((candidate) => (
    !isModernParkingSourceFact(candidate) && candidate.pickupDate === undefined
  ))!;
  const vehicle = initial.vehicles.find((candidate) => candidate.id === legacyOpen.vehicleId)!;
  await addSharedQuickOrder(store, "qbo-parking-legacy-open-vehicle", undefined, {
    vehicleId: vehicle.id,
    customerId: vehicle.customerId,
  });
  const before = stateSnapshot(store);
  await expect(recordMockQuickPickup({
    orderId: "qbo-parking-legacy-open-vehicle",
    expectedRevision: before.revision,
    mutationId: "parking-source-legacy-open-conflict",
    channels: pickupChannels,
  }, frontdeskActor, store)).rejects.toMatchObject({ status: 409 });
  expect(stateSnapshot(store)).toEqual(before);

  const mixedOpen = structuredClone(before);
  const modern = modernParkingSource(
    "qbo-parking-legacy-open-vehicle",
    vehicle.id,
    "PARK-MODERN-OPEN-CONFLICT",
  ) as ReturnType<typeof modernParkingSource> & { pickupDate?: string };
  delete (modern as unknown as { pickupDate?: string }).pickupDate;
  (modern as unknown as { accrual: { chargeableDays: number; originalAmountJmd: number } }).accrual = {
    chargeableDays: 18,
    originalAmountJmd: 45_000,
  };
  mixedOpen.parkingCases.push(modern);
  expect(() => validateLinkedOperationsState(mixedOpen)).toThrow(/parking|open|vehicle|episode|停车|车辆/i);
});

test("the first eligible BO Invoice claims the vehicle episode while another cohort BO can open without duplicating parking", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-cohort-a");
  const cohortA = stateSnapshot(store).quickOrders.find((order) => order.id === "qbo-parking-cohort-a")!;
  await addSharedQuickOrder(store, "qbo-parking-cohort-b", undefined, {
    vehicleId: cohortA.vehicleId,
    customerId: cohortA.customerId,
  });
  const sourceResult = await recordMockQuickPickup({
    orderId: "qbo-parking-cohort-a",
    expectedRevision: stateSnapshot(store).revision,
    mutationId: "parking-source-cohort-a",
    channels: pickupChannels,
  }, frontdeskActor, store);
  expect(sourceResult.parkingSource.eligibleBusinessOrderIds).toEqual([
    "qbo-parking-cohort-a",
    "qbo-parking-cohort-b",
  ]);

  const firstInvoice = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-parking-cohort-b",
    expectedRevision: stateSnapshot(store).revision,
    mutationId: "parking-cohort-b-invoice-v1",
  }, frontdeskActor, store);
  const afterFirst = stateSnapshot(store);
  const firstVersion = afterFirst.invoices.find((invoice) => invoice.id === firstInvoice.invoiceId)!.versions[0]!;
  if (firstVersion.chargeContract !== "shared_v1") throw new Error("expected shared Invoice version");
  expect(firstVersion.snapshot.lines.filter((line) => line.pricingMode === "parking_projection")).toHaveLength(1);
  expect(afterFirst.activeParkingClaim[sourceResult.parkingSource.id]?.logicalInvoiceId).toBe(firstInvoice.invoiceId);

  const secondInvoice = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-parking-cohort-a",
    expectedRevision: afterFirst.revision,
    mutationId: "parking-cohort-a-invoice-v1",
  }, frontdeskActor, store);
  const committed = stateSnapshot(store);
  const secondVersion = committed.invoices.find((invoice) => invoice.id === secondInvoice.invoiceId)!.versions[0]!;
  if (secondVersion.chargeContract !== "shared_v1") throw new Error("expected shared Invoice version");
  expect(secondVersion.snapshot.lines.filter((line) => line.pricingMode === "parking_projection")).toHaveLength(0);
  expect(committed.activeParkingClaim[sourceResult.parkingSource.id]?.logicalInvoiceId).toBe(firstInvoice.invoiceId);
  expect(committed.parkingCases.find((source) => source.id === sourceResult.parkingSource.id)).toMatchObject({
    originBusinessOrderId: "qbo-parking-cohort-a",
  });
  expect(() => validateLinkedOperationsState(committed)).not.toThrow();
});

test("legacy parking identity and original source coordinates cannot be rewritten without an append-only waiver lineage", async () => {
  const storage = memoryStorage();
  const store = createMockLinkedOperationsStore(storage);
  await store.mutate((state) => { state.revision += 1; }, {
    action: "test.persist-legacy-parking-protection-source",
    consumeWriteFault: false,
  });
  const before = stateSnapshot(store);
  const legacy = before.parkingCases.find((candidate) => !Object.prototype.hasOwnProperty.call(candidate, "parkingContract"))!;
  await expect(store.mutate((state) => {
    const parking = state.parkingCases.find((candidate) => candidate.id === legacy.id)!;
    state.parkingCases[state.parkingCases.indexOf(parking)] = { ...parking, id: `${parking.id}-tampered` };
    state.revision += 1;
  }, { action: "test.legacy-parking-identity-tamper", consumeWriteFault: false })).rejects.toThrow(/legacy|parking|protected|canonical|停车|保护/i);
  expect(stateSnapshot(store)).toEqual(before);

  const fresh = createMockLinkedOperationsStore(storage);
  await fresh.ready();
  expect(stateSnapshot(fresh)).toEqual(before);
});

test("a frozen legacy parking owner cannot append a forged lower-value Invoice version", async () => {
  const storage = memoryStorage();
  const store = createMockLinkedOperationsStore(storage);
  await store.mutate((state) => { state.revision += 1; }, {
    action: "test.persist-legacy-parking-invoice-source",
    consumeWriteFault: false,
  });
  const before = stateSnapshot(store);
  const parking = before.parkingCases.find((candidate) => !Object.prototype.hasOwnProperty.call(candidate, "parkingContract"))!;

  await expect(store.mutate((state) => {
    const invoiceIndex = state.invoices.findIndex((candidate) => candidate.id === parking.invoiceId);
    const invoice = state.invoices[invoiceIndex]!;
    if (isSharedChargeInvoice(invoice)) throw new Error("expected legacy Invoice");
    const prior = invoice.versions.at(-1)!;
    const lines = prior.lines.map((line) => (
      line.code === "parking_overtime" ? { ...line, quantity: 1 } : line
    ));
    const versionId = `${invoice.id}-forged-v${prior.version + 1}`;
    state.invoices[invoiceIndex] = {
      ...invoice,
      versions: [...invoice.versions, {
        id: versionId,
        version: prior.version + 1,
        lines,
        adjustments: [...prior.adjustments],
        totals: calculateInvoiceTotals({ lines, adjustments: prior.adjustments }),
        issuedAt: "2026-08-21T12:00:00-05:00",
      }],
    };
    state.invoiceFileHashes[versionId] = `sha256-${versionId}-forged`;
    state.revision += 1;
  }, { action: "test.legacy-parking-owner-v2-forgery", consumeWriteFault: false }))
    .rejects.toThrow(/legacy|parking|origin|Invoice|frozen|停车|冻结/i);
  expect(stateSnapshot(store)).toEqual(before);

  const fresh = createMockLinkedOperationsStore(storage);
  await fresh.ready();
  expect(stateSnapshot(fresh)).toEqual(before);
});

test("parking activation derives one immutable projection and active claim from the canonical source", async () => {
  const storage = memoryStorage();
  const store = createMockLinkedOperationsStore(storage);
  await addSharedQuickOrder(store, "qbo-parking-activation");
  const source = await addModernParkingSource(store, "qbo-parking-activation", "PARK-ACTIVATION");
  const sourceBefore = structuredClone(source);
  const result = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-parking-activation",
    expectedRevision: stateSnapshot(store).revision,
    mutationId: "parking-activation-v1",
  }, frontdeskActor, store);

  const committed = stateSnapshot(store);
  const invoice = committed.invoices.find((candidate) => candidate.id === result.invoiceId)!;
  const version = invoice.versions.find((candidate) => candidate.id === result.invoiceVersionId)!;
  expect(version.chargeContract).toBe("shared_v1");
  if (version.chargeContract !== "shared_v1") throw new Error("expected shared Invoice version");
  const line = version.snapshot.lines.find((candidate) => candidate.pricingMode === "parking_projection");
  expect(line).toEqual(expect.objectContaining({
    pricingMode: "parking_projection",
    parkingCaseId: source.id,
    sourceRevision: source.revision,
    asOf: source.asOf,
    amountJmd: source.accrual.originalAmountJmd,
  }));
  expect(committed.activeParkingClaim[source.id]).toEqual({
    logicalInvoiceId: result.invoiceId,
    financiallyEffectiveVersionId: result.invoiceVersionId,
    chargeLineId: line?.chargeLineId,
  });
  expect(committed.parkingCases.find((candidate) => candidate.id === source.id)).toEqual(sourceBefore);
  expect(() => validateLinkedOperationsState(committed)).not.toThrow();

  const fresh = createMockLinkedOperationsStore(storage);
  await fresh.ready();
  expect(stateSnapshot(fresh).activeParkingClaim[source.id]).toEqual(committed.activeParkingClaim[source.id]);
  expect(stateSnapshot(fresh).parkingCases.find((candidate) => candidate.id === source.id)).toEqual(sourceBefore);
});

test("parking activation automatically includes every matching source and rejects any caller-supplied subset or amount", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-all");
  const first = await addModernParkingSource(store, "qbo-parking-all", "PARK-ALL-1");
  const staleRevision = stateSnapshot(store).revision;
  const second = await addModernParkingSource(store, "qbo-parking-all", "PARK-ALL-2");
  const beforeStale = stateSnapshot(store);
  await expect(activateMockQuickInvoiceSnapshot({
    orderId: "qbo-parking-all",
    expectedRevision: staleRevision,
    mutationId: "parking-all-stale",
  }, frontdeskActor, store)).rejects.toMatchObject({ status: 409 });
  expect(stateSnapshot(store)).toEqual(beforeStale);

  const result = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-parking-all",
    expectedRevision: beforeStale.revision,
    mutationId: "parking-all-v1",
  }, frontdeskActor, store);
  const committed = stateSnapshot(store);
  const invoice = committed.invoices.find((candidate) => candidate.id === result.invoiceId)!;
  const version = invoice.versions.find((candidate) => candidate.id === result.invoiceVersionId)!;
  if (version.chargeContract !== "shared_v1") throw new Error("expected shared Invoice version");
  expect(version.snapshot.lines.filter((line) => line.pricingMode === "parking_projection").map((line) => line.parkingCaseId))
    .toEqual([first.id, second.id]);
  expect(Object.keys(committed.activeParkingClaim).filter((caseId) => caseId === first.id || caseId === second.id))
    .toEqual([first.id, second.id]);

  const beforeSpoof = stateSnapshot(store);
  await expect(activateMockQuickInvoiceSnapshot({
    orderId: "qbo-parking-all",
    expectedRevision: beforeSpoof.revision,
    mutationId: "parking-all-spoof",
    parkingSources: [{ parkingCaseId: first.id, sourceRevision: 999, amountJmd: 1 }],
  } as never, frontdeskActor, store)).rejects.toMatchObject({ status: 400 });
  expect(stateSnapshot(store)).toEqual(beforeSpoof);
});

test("activation receipt cannot coordinate-shrink an eligible unclaimed parking source out of its Invoice", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const orderId = "qbo-parking-activation-shrink";
  await addSharedQuickOrder(store, orderId);
  const first = await addModernParkingSource(store, orderId, "PARK-ACTIVATION-SHRINK-1");
  const second = await addModernParkingSource(store, orderId, "PARK-ACTIVATION-SHRINK-2", 2);
  const before = stateSnapshot(store);
  const result = await activateMockQuickInvoiceSnapshot({
    orderId,
    expectedRevision: before.revision,
    mutationId: "parking-activation-shrink-v1",
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  expect(() => validateLinkedOperationsState(canonical)).not.toThrow();
  const canonicalInvoice = canonical.invoices.find((candidate) => candidate.id === result.invoiceId)!;
  if (!isSharedChargeInvoice(canonicalInvoice)) throw new Error("expected shared Invoice");
  expect(canonicalInvoice.versions[0]!.snapshot.lines.find((line) => (
    line.pricingMode === "parking_projection" && line.parkingCaseId === second.id
  ))).toMatchObject({ amountJmd: 0 });
  const drifted = structuredClone(canonical);
  const invoice = drifted.invoices.find((candidate) => candidate.id === result.invoiceId)!;
  if (!isSharedChargeInvoice(invoice)) throw new Error("expected shared Invoice");
  const version = invoice.versions.find((candidate) => candidate.id === result.invoiceVersionId)!;
  const keptLines = version.snapshot.lines.filter((line) => (
    line.pricingMode !== "parking_projection" || line.parkingCaseId !== second.id
  ));
  const nextSnapshot = buildInvoiceChargeSnapshot({
    sourceBusinessOrderId: version.snapshot.sourceBusinessOrderId,
    sourceBusinessOrderRevision: version.snapshot.sourceBusinessOrderRevision,
    lines: keptLines.map(invoiceSnapshotLineToQuotedCharge),
    adjustments: version.snapshot.adjustments,
  });
  const nextCommitment = billingSnapshotCommitment(nextSnapshot);
  (version as unknown as { snapshot: typeof nextSnapshot }).snapshot = nextSnapshot;
  (version as unknown as { snapshotCommitment: string }).snapshotCommitment = nextCommitment;
  delete drifted.activeParkingClaim[second.id];
  const audit = drifted.billingAuditEvents.find((candidate) => candidate.mutationId === "parking-activation-shrink-v1")!;
  if (audit.operation !== "invoice_activation") throw new Error("expected activation audit");
  (audit as unknown as { snapshotCommitment: string }).snapshotCommitment = nextCommitment;
  const receipt = drifted.mutationReceipts.find((candidate) => candidate.mutationId === "parking-activation-shrink-v1")!;
  const receiptResult = receipt.result as { snapshotCommitment: string };
  receiptResult.snapshotCommitment = nextCommitment;
  expect(drifted.activeParkingClaim[first.id]).toBeDefined();
  expect(drifted.activeParkingClaim[second.id]).toBeUndefined();
  expect(() => validateLinkedOperationsState(drifted)).toThrow(/parking|activation|eligible|enumerat|projection|claim|停车|投影|占用/i);
});

test("modern parking claim and effective projection are a bidirectional closed binding", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-binding");
  const source = await addModernParkingSource(store, "qbo-parking-binding", "PARK-BINDING");
  const result = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-parking-binding",
    expectedRevision: stateSnapshot(store).revision,
    mutationId: "parking-binding-v1",
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  const mutants: Array<(draft: LinkedOperationsState) => void> = [
    (draft) => { delete draft.activeParkingClaim[source.id]; },
    (draft) => { draft.activeParkingClaim[source.id] = { ...draft.activeParkingClaim[source.id]!, logicalInvoiceId: "invoice-other" }; },
    (draft) => {
      const invoice = draft.invoices.find((candidate) => candidate.id === result.invoiceId)!;
      const version = invoice.versions.find((candidate) => candidate.id === result.invoiceVersionId)!;
      if (version.chargeContract !== "shared_v1") throw new Error("expected shared Invoice version");
      const line = version.snapshot.lines.find((candidate) => candidate.pricingMode === "parking_projection")!;
      (line as unknown as { amountJmd: number }).amountJmd += 1;
    },
  ];
  for (const mutate of mutants) {
    const corrupted = structuredClone(canonical);
    mutate(corrupted);
    expect(() => validateLinkedOperationsState(corrupted)).toThrow(/PARKING|parking|claim|snapshot|停车/i);
  }
});

test("same logical Invoice transfers every parking claim to V2 with stable lines while V1 stays immutable", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await addSharedQuickOrder(store, "qbo-parking-v2");
  const firstSource = await addModernParkingSource(store, "qbo-parking-v2", "PARK-V2-1");
  const secondSource = await addModernParkingSource(store, "qbo-parking-v2", "PARK-V2-2");
  const v1 = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-parking-v2",
    expectedRevision: stateSnapshot(store).revision,
    mutationId: "parking-transfer-v1",
  }, frontdeskActor, store);
  const v1Snapshot = structuredClone(stateSnapshot(store).invoices.find((candidate) => candidate.id === v1.invoiceId)!.versions[0]);
  const v2 = await activateMockQuickInvoiceSnapshot({
    orderId: "qbo-parking-v2",
    expectedRevision: stateSnapshot(store).revision,
    mutationId: "parking-transfer-v2",
  }, frontdeskActor, store);
  const canonical = stateSnapshot(store);
  const invoice = canonical.invoices.find((candidate) => candidate.id === v1.invoiceId)!;
  expect(invoice.versions[0]).toEqual(v1Snapshot);
  expect(invoice.financiallyEffectiveVersionId).toBe(v2.invoiceVersionId);
  if (invoice.invoiceContract !== "shared_v1") throw new Error("expected shared Invoice");
  const parkingIdsByVersion = invoice.versions.map((version) => version.snapshot.lines
    .filter((line) => line.pricingMode === "parking_projection")
    .map((line) => [line.parkingCaseId, line.chargeLineId]));
  expect(parkingIdsByVersion[1]).toEqual(parkingIdsByVersion[0]);
  for (const source of [firstSource, secondSource]) {
    expect(canonical.activeParkingClaim[source.id]).toEqual({
      logicalInvoiceId: invoice.id,
      financiallyEffectiveVersionId: v2.invoiceVersionId,
      chargeLineId: parkingIdsByVersion[0]!.find(([caseId]) => caseId === source.id)![1],
    });
  }

  const mutants: Array<(draft: LinkedOperationsState) => void> = [
    (draft) => { draft.activeParkingClaim[firstSource.id] = { ...draft.activeParkingClaim[firstSource.id]!, financiallyEffectiveVersionId: v1.invoiceVersionId }; },
    (draft) => { draft.activeParkingClaim[firstSource.id] = { ...draft.activeParkingClaim[firstSource.id]!, chargeLineId: "parking-wrong-line" }; },
    (draft) => {
      const target = draft.invoices.find((candidate) => candidate.id === invoice.id)!;
      if (target.invoiceContract !== "shared_v1") throw new Error("expected shared Invoice");
      (target as unknown as { financiallyEffectiveVersionId: string }).financiallyEffectiveVersionId = v1.invoiceVersionId;
    },
  ];
  for (const mutate of mutants) {
    const corrupted = structuredClone(canonical);
    mutate(corrupted);
    expect(() => validateLinkedOperationsState(corrupted)).toThrow(/PARKING|INVOICE|claim|effective|停车/i);
  }
});

test("two-source activation write fault and response loss leave exactly one replayable version and claim set", async () => {
  const scenario: { failNext: { byAction: Record<string, string> } } = { failNext: { byAction: {} } };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  try {
    const store = createMockLinkedOperationsStore(storage);
    await addSharedQuickOrder(store, "qbo-parking-faults");
    const first = await addModernParkingSource(store, "qbo-parking-faults", "PARK-FAULT-1");
    const second = await addModernParkingSource(store, "qbo-parking-faults", "PARK-FAULT-2");
    const before = stateSnapshot(store);
    const input = {
      orderId: "qbo-parking-faults",
      expectedRevision: before.revision,
      mutationId: "parking-fault-response-v1",
    };
    scenario.failNext.byAction["billing.invoice.activate.write"] = "parking activation write fault";
    await expect(activateMockQuickInvoiceSnapshot(input, frontdeskActor, store)).rejects.toThrow(/write fault|写入/i);
    expect(stateSnapshot(store)).toEqual(before);

    scenario.failNext.byAction["billing.invoice.activate.response"] = "parking activation response loss";
    await expect(activateMockQuickInvoiceSnapshot(input, frontdeskActor, store)).rejects.toThrow(/response loss|响应/i);
    const afterLoss = stateSnapshot(store);
    const replay = await activateMockQuickInvoiceSnapshot(input, frontdeskActor, store);
    expect(stateSnapshot(store)).toEqual(afterLoss);
    expect(afterLoss.invoices.find((candidate) => candidate.id === replay.invoiceId)?.versions).toHaveLength(1);
    for (const source of [first, second]) {
      expect(afterLoss.activeParkingClaim[source.id]).toMatchObject({
        logicalInvoiceId: replay.invoiceId,
        financiallyEffectiveVersionId: replay.invoiceVersionId,
      });
    }
    expect(afterLoss.billingAuditEvents.filter((event) => event.mutationId === input.mutationId)).toHaveLength(1);
    expect(afterLoss.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId)).toHaveLength(1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("legacy parking apply is always frozen before consuming preview and requires reconciliation", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.ready();
  let state = stateSnapshot(store);
  const parking = state.parkingCases.find((candidate) => {
    const invoice = state.invoices.find((item) => item.id === candidate.invoiceId);
    return invoice !== undefined && deriveLinkedInvoiceFinancialSummary(state, invoice).balanceJmd > 0;
  })!;
  const invoice = state.invoices.find((candidate) => candidate.id === parking.invoiceId)!;
  const balance = deriveLinkedInvoiceFinancialSummary(state, invoice).balanceJmd;
  await recordMockInvoicePayment({
    invoiceId: invoice.id,
    expectedRevision: state.revision,
    mutationId: "legacy-parking-modern-payment",
    amountJmd: Math.min(1_000, balance),
    method: "cash",
  }, frontdeskActor, store);
  const preview = await previewMockParkingWaiver({
    caseId: parking.id,
    waiveDays: 1,
    reason: "must reconcile",
  }, store);
  const beforeApply = stateSnapshot(store);
  await expect(applyMockParkingWaiver({
    caseId: parking.id,
    waiveDays: 1,
    reason: "must reconcile",
    expectedRevision: parking.revision,
    previewToken: preview.previewToken,
  }, frontdeskActor.id, store)).rejects.toMatchObject({ status: 409 });
  expect(stateSnapshot(store)).toEqual(beforeApply);
  expect(stateSnapshot(store).parkingWaiverPreviews.find((token) => token.id === preview.previewToken)?.consumedAt).toBeUndefined();

  const legacyStore = createMockLinkedOperationsStore(memoryStorage());
  await legacyStore.ready();
  state = stateSnapshot(legacyStore);
  const legacyParking = state.parkingCases.find((candidate) => candidate.id === parking.id)!;
  const legacyPreview = await previewMockParkingWaiver({
    caseId: legacyParking.id,
    waiveDays: 1,
    reason: "legacy reconciliation only",
  }, legacyStore);
  const beforeLegacyApply = stateSnapshot(legacyStore);
  await expect(applyMockParkingWaiver({
    caseId: legacyParking.id,
    waiveDays: 1,
    reason: "legacy reconciliation only",
    expectedRevision: legacyParking.revision,
    previewToken: legacyPreview.previewToken,
  }, frontdeskActor.id, legacyStore)).rejects.toMatchObject({ status: 409 });
  expect(stateSnapshot(legacyStore)).toEqual(beforeLegacyApply);
  expect(stateSnapshot(legacyStore).parkingWaiverPreviews.find((token) => token.id === legacyPreview.previewToken)?.consumedAt)
    .toBeUndefined();

  const coordinatedTamper = structuredClone(beforeLegacyApply);
  const current = coordinatedTamper.parkingCases.find((candidate) => candidate.id === legacyParking.id)!;
  if (isModernParkingSourceFact(current)) throw new Error("expected legacy parking source");
  const forgedPreview = validateParkingWaiver({
    caseId: current.id,
    originalChargeableDays: current.accrual.chargeableDays,
    dailyRateJmd: current.dailyRateJmd,
    existingWaivedDays: 0,
    existingWaivedAmountJmd: 0,
    proposedWaivedDays: 2,
    proposedWaivedAmountJmd: current.dailyRateJmd * 2,
  });
  const invoiceIndex = coordinatedTamper.invoices.findIndex((candidate) => candidate.id === current.invoiceId);
  const forgedInvoice = coordinatedTamper.invoices[invoiceIndex]!;
  if (isSharedChargeInvoice(forgedInvoice)) throw new Error("expected legacy Invoice");
  const priorVersion = forgedInvoice.versions.at(-1)!;
  const nextVersionId = `${forgedInvoice.id}-v${priorVersion.version + 1}`;
  const nextLines = priorVersion.lines.map((line) => (
    line.code === "parking_overtime" && line.sourceId === current.id
      ? { ...line, quantity: forgedPreview.finalChargeableDays }
      : line
  ));
  coordinatedTamper.invoices[invoiceIndex] = {
    ...forgedInvoice,
    versions: [...forgedInvoice.versions, {
      id: nextVersionId,
      version: priorVersion.version + 1,
      lines: nextLines,
      adjustments: [...priorVersion.adjustments],
      totals: calculateInvoiceTotals({ lines: nextLines, adjustments: priorVersion.adjustments }),
      issuedAt: "2026-08-21T12:00:00-05:00",
    }],
  };
  coordinatedTamper.invoiceFileHashes[nextVersionId] = `sha256-${nextVersionId}-forged`;
  const mutableCurrent = current as unknown as {
    revision: number;
    invoiceVersionId: string;
    waiverHistory: Array<typeof forgedPreview>;
    waiverReasons: string[];
  };
  mutableCurrent.revision += 1;
  mutableCurrent.invoiceVersionId = nextVersionId;
  mutableCurrent.waiverHistory.push(forgedPreview);
  mutableCurrent.waiverReasons.push("forged legacy waiver");
  coordinatedTamper.parkingWaiverAudits.push({
    id: "forged-legacy-waiver-audit",
    caseId: current.id,
    reason: "forged legacy waiver",
    actorId: "spoofed-actor",
    appliedAt: "2026-08-21T12:00:00-05:00",
    preview: forgedPreview,
  });
  expect(() => validateLinkedOperationsState(coordinatedTamper)).toThrow(/legacy|parking|origin|waiver|reconciliation|停车|减免/i);
});
