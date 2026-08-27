import { expect, test } from "@playwright/test";
import {
  createMockLinkedOperationsStore,
  validateLinkedOperationsState,
  type LinkedOperationsState,
} from "../../src/lib/api/mock-orders";
import {
  createMockQuickOrderFromInspectionQuotation,
  updateMockQuotation,
  type CreateQuickOrderFromInspectionQuotationInput,
  type UpdateQuotationLineInput,
} from "../../src/lib/api/mock-inspection-reports";
import {
  applyMockQuickOrderAction,
  createMockQuickOrder,
  getMockQuickOrder,
  recordMockQuickRefund,
  updateMockSharedQuickOrderCharges,
  updateMockQuickOrderNotes,
} from "../../src/lib/api/mock-quick-orders";
import { businessDateInJamaica, formatBusinessOrderNo } from "../../src/lib/orders/document-number";
import {
  isSharedChargeQuickOrder,
  quickOrderFinance,
} from "../../src/lib/orders/quick-order-types";
import type { QuotedChargeLine } from "../../src/lib/billing/quoted-charges";
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

function installLinkedScenario(scenario: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: memoryStorage(), __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  return () => descriptor
    ? Object.defineProperty(globalThis, "window", descriptor)
    : void Reflect.deleteProperty(globalThis, "window");
}

const actor = { id: "emp-003", name: "前台", role: "frontdesk_admin" as const };
const QUOTATION_STROKES = [[{ x: 10, y: 11, time: 1 }, { x: 12, y: 13, time: 2 }]] as const;
const BO_STROKES = [[{ x: 20, y: 21, time: 3 }, { x: 22, y: 23, time: 4 }]] as const;
const DRIFTED_BO_STROKES = [[{ x: 30, y: 31, time: 5 }, { x: 32, y: 33, time: 6 }]] as const;
const DRIFTED_QUOTATION_STROKES = [[{ x: 40, y: 41, time: 7 }, { x: 42, y: 43, time: 8 }]] as const;

function unitLine(input: {
  id?: string;
  category: "labor" | "parts";
  descZh: string;
  descEn?: string;
  remarkZh?: string;
  remarkEn?: string;
  unit?: string;
  unitEn?: string;
  quantity?: number;
  unitPriceJmd: number;
  unitDiscountJmd?: number;
  pendingQuote?: boolean;
}): UpdateQuotationLineInput {
  return {
    ...(input.id ? { id: input.id } : {}),
    category: input.category,
    pricingMode: "unit",
    descZh: input.descZh,
    descEn: input.descEn ?? "",
    remarkZh: input.remarkZh ?? "",
    remarkEn: input.remarkEn ?? "",
    unit: input.unit ?? (input.category === "labor" ? "工时" : "个"),
    unitEn: input.unitEn ?? "",
    quantity: input.quantity ?? 1,
    unitPriceJmd: input.unitPriceJmd,
    unitDiscountJmd: input.unitDiscountJmd ?? 0,
    pendingQuote: input.pendingQuote ?? false,
  };
}

function fixedLine(input: {
  id?: string;
  descZh: string;
  descEn?: string;
  remarkZh?: string;
  remarkEn?: string;
  code?: "towing" | "offsite_service" | "other";
  amountJmd: number;
}): UpdateQuotationLineInput {
  return {
    ...(input.id ? { id: input.id } : {}),
    category: "other_service",
    pricingMode: "fixed_total",
    code: input.code ?? "other",
    descZh: input.descZh,
    descEn: input.descEn ?? "",
    remarkZh: input.remarkZh ?? "",
    remarkEn: input.remarkEn ?? "",
    amountJmd: input.amountJmd,
  };
}

function editableLine(line: QuotedChargeLine): UpdateQuotationLineInput {
  if (line.pricingMode === "parking_projection") throw new Error("IR fixture cannot contain parking");
  const { sourceId: _sourceId, ...editable } = line;
  return editable;
}

async function replaceQuotation(
  store: ReturnType<typeof createMockLinkedOperationsStore>,
  input: {
    reportId?: string;
    mutationId: string;
    lines: ReadonlyArray<UpdateQuotationLineInput>;
    signature?: { rawStrokes: DiscountApprovalEvidence["rawStrokes"] };
  },
) {
  const state = store.read((current) => current);
  const reportId = input.reportId ?? "inspection-report-demo-01";
  const report = state.inspectionReports.find((candidate) => candidate.id === reportId)!;
  const quotation = state.currentQuotations.find((candidate) => candidate.id === report.quotationId)!;
  return updateMockQuotation({
    reportId,
    expectedRevision: state.revision,
    mutationId: input.mutationId,
    noteZh: quotation.noteZh,
    noteEn: quotation.noteEn,
    lines: input.lines,
    ...(input.signature ? { signature: input.signature } : {}),
  }, actor, store);
}

function bridgeInput(
  store: ReturnType<typeof createMockLinkedOperationsStore>,
  selectedLineIds: ReadonlyArray<string>,
  mutationId: string,
  extra: Partial<CreateQuickOrderFromInspectionQuotationInput> = {},
): CreateQuickOrderFromInspectionQuotationInput {
  return {
    reportId: "inspection-report-demo-01",
    expectedRevision: store.read((state) => state.revision),
    quickOrderMutationId: mutationId,
    selectedLineIds,
    ...extra,
  };
}

test("copies selected current labor, pending parts, and fixed totals into one independent shared-charge Quick BO", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const saved = await replaceQuotation(store, {
    mutationId: "bridge-copy-source",
    lines: [
      unitLine({ category: "labor", descZh: "拆解发动机", descEn: "", remarkZh: "检查内部损伤", remarkEn: "", unit: "工时", unitEn: "", quantity: 2, unitPriceJmd: 25_000, unitDiscountJmd: 1_251 }),
      unitLine({ category: "parts", descZh: "待报价密封件", descEn: "", remarkZh: "拆检后确认", remarkEn: "", quantity: 3, unitPriceJmd: 0, pendingQuote: true }),
      fixedLine({ descZh: "拖车费", descEn: "", remarkZh: "一次拖运", remarkEn: "", code: "towing", amountJmd: 7_500 }),
    ],
  });
  const source = store.read((state) => ({
    report: state.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!,
    revision: state.revision,
    currentQuotation: structuredClone(state.currentQuotations.find((item) => item.inspectionReportId === "inspection-report-demo-01")!),
    quotedChargeLines: structuredClone(state.quotedChargeLines),
    communications: structuredClone(state.communicationEvents),
    responses: structuredClone(state.responseEvents),
    lines: saved.lineIds.map((id) => state.quotedChargeLines.find((line) => line.id === id)!),
    quickCount: state.quickOrders.length,
  }));

  const order = await createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, saved.lineIds, "bridge-copy-bo"),
    actor,
    store,
  );

  expect(order).toMatchObject({
    customerId: source.report.customerId,
    vehicleId: source.report.vehicleId,
    rawInput: "",
    noteZh: `来自检查结果：${source.report.inspectionReportNo}`,
    noteEn: null,
    laborDiscountJmd: 0,
    partsDiscountJmd: 0,
    chargeContract: "shared_v1",
    items: [],
  });
  expect(isSharedChargeQuickOrder(order)).toBe(true);
  if (!isSharedChargeQuickOrder(order)) throw new Error("expected shared Quick BO");
  expect(order.chargeLines).toHaveLength(3);
  expect(order.chargeLines.map((line) => line.id)).not.toEqual(saved.lineIds);
  expect(new Set(order.chargeLines.map((line) => line.id)).size).toBe(3);
  expect(order.chargeLines).toEqual([
    expect.objectContaining({ pricingMode: "unit", category: "labor", descZh: "拆解发动机", descEn: "", remarkZh: "检查内部损伤", remarkEn: "", unit: "工时", unitEn: "", quantity: 2, unitPriceJmd: 25_000, unitDiscountJmd: 1_251, pendingQuote: false }),
    expect.objectContaining({ pricingMode: "unit", category: "parts", descZh: "待报价密封件", descEn: "", remarkZh: "拆检后确认", remarkEn: "", quantity: 3, unitPriceJmd: 0, unitDiscountJmd: 0, pendingQuote: true }),
    expect.objectContaining({ pricingMode: "fixed_total", category: "other_service", code: "towing", descZh: "拖车费", descEn: "", remarkZh: "一次拖运", remarkEn: "", amountJmd: 7_500 }),
  ]);
  for (const line of order.chargeLines) {
    expect(line).not.toHaveProperty("sourceId");
    expect(line).not.toHaveProperty("quotationLineId");
  }
  const fixed = order.chargeLines[2];
  expect(fixed).not.toHaveProperty("quantity");
  expect(fixed).not.toHaveProperty("unit");
  expect(fixed).not.toHaveProperty("unitPriceJmd");
  expect(fixed).not.toHaveProperty("unitDiscountJmd");
  expect(fixed).not.toHaveProperty("pendingQuote");
  expect(order).not.toHaveProperty("sourceProject");
  expect(order).not.toHaveProperty("inspectionReportId");
  expect(order).not.toHaveProperty("quotationId");
  expect(order).not.toHaveProperty("sourceSnapshot");
  expect(order).not.toHaveProperty("sourceHash");
  expect(quickOrderFinance(order)).toMatchObject({
    receivableJmd: 54_998,
    laborDiscountJmd: 2_502,
    partsDiscountJmd: 0,
    discountJmd: 2_502,
  });
  const persisted = store.read((state) => state);
  expect(persisted.quickOrders).toHaveLength(source.quickCount + 1);
  expect(persisted.revision).toBe(source.revision + 1);
  expect(persisted.inspectionReports.find((report) => report.id === source.report.id)).toEqual(source.report);
  expect(persisted.currentQuotations.find((quotation) => quotation.inspectionReportId === source.report.id)).toEqual(source.currentQuotation);
  expect(persisted.quotedChargeLines).toEqual(source.quotedChargeLines);
  expect(persisted.communicationEvents).toEqual(source.communications);
  expect(persisted.responseEvents).toEqual(source.responses);

  expect(() => validateLinkedOperationsState(store.read((state) => state))).not.toThrow();
});

test("rejects empty, duplicate, unknown, and cross-report selections without any partial state", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const state = store.read((current) => current);
  const report = state.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!;
  const current = state.currentQuotations.find((item) => item.id === report.quotationId)!;
  const otherReport = state.inspectionReports.find((item) => item.id !== report.id)!;
  const otherQuotation = state.currentQuotations.find((item) => item.id === otherReport.quotationId)!;
  const selections = [
    { ids: [] as string[], mutationId: "bridge-empty" },
    { ids: [current.lineIds[0], current.lineIds[0]], mutationId: "bridge-duplicate" },
    { ids: ["missing-line"], mutationId: "bridge-unknown" },
    { ids: [otherQuotation.lineIds[0]], mutationId: "bridge-cross-report" },
  ];
  const before = store.read((currentState) => structuredClone(currentState));
  for (const selection of selections) {
    await expect(createMockQuickOrderFromInspectionQuotation(
      bridgeInput(store, selection.ids, selection.mutationId),
      actor,
      store,
    )).rejects.toMatchObject({ status: 400 });
  }
  expect(store.read((currentState) => currentState)).toEqual(before);
});

test("keeps source and target values independent in both directions and allows a second BO with a new mutation ID", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const saved = await replaceQuotation(store, {
    mutationId: "bridge-independent-source",
    lines: [unitLine({ category: "labor", descZh: "初始工时", unitPriceJmd: 10_000, unitDiscountJmd: 500 })],
  });
  const first = await createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, saved.lineIds, "bridge-independent-first"), actor, store,
  );
  const afterFirst = store.read((state) => state);
  const quotation = afterFirst.currentQuotations.find((item) => item.inspectionReportId === "inspection-report-demo-01")!;
  await updateMockQuotation({
    reportId: "inspection-report-demo-01",
    expectedRevision: afterFirst.revision,
    mutationId: "bridge-independent-source-edit",
    noteZh: quotation.noteZh,
    noteEn: quotation.noteEn,
    lines: [unitLine({ id: saved.lineIds[0], category: "labor", descZh: "来源后来修改", unitPriceJmd: 20_000, unitDiscountJmd: 500 })],
  }, actor, store);
  expect(getMockQuickOrder(first.id, store)).toMatchObject({
    chargeLines: [expect.objectContaining({ descZh: "初始工时", unitPriceJmd: 10_000 })],
  });

  await store.mutate((draft) => {
    const target = draft.quickOrders.find((order) => order.id === first.id)! as unknown as { chargeLines: Array<Record<string, unknown>> };
    target.chargeLines[0] = { ...target.chargeLines[0], descZh: "BO 后来修改", unitPriceJmd: 30_000 };
    draft.revision += 1;
  }, { action: "test.quick-order-independent-edit" });
  const afterTargetEdit = store.read((state) => state);
  const sourceLine = afterTargetEdit.quotedChargeLines.find((line) => line.id === saved.lineIds[0]);
  expect(sourceLine).toMatchObject({ descZh: "来源后来修改", unitPriceJmd: 20_000 });

  const second = await createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, [saved.lineIds[0]], "bridge-independent-second"), actor, store,
  );
  expect(second.id).not.toBe(first.id);
  expect(second).toMatchObject({ chargeLines: [expect.objectContaining({ descZh: "来源后来修改", unitPriceJmd: 20_000 })] });
});

test("allocates BO and charge-line IDs above persisted high water rather than from array length", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.mutate((draft) => {
    const last = draft.quickOrders.at(-1)! as unknown as { id: string };
    last.id = "qbo-9999";
  }, { action: "test.quick-order-high-water" });
  const state = store.read((current) => current);
  const report = state.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!;
  const quotation = state.currentQuotations.find((item) => item.id === report.quotationId)!;
  const created = await createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, [quotation.lineIds[0]], "bridge-high-water"), actor, store,
  );
  expect(created.id).toBe("qbo-10000");
  expect(new Set(created.chargeLines?.map((line) => line.id))).toHaveProperty("size", created.chargeLines?.length);
  expect(created.chargeLines?.every((line) => line.id.startsWith("qbo-10000-charge-"))).toBe(true);
});

test("skips candidate IDs when either the BO number or a shared line ID is already occupied", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const businessDate = businessDateInJamaica(store.nowMs());
  await store.mutate((draft) => {
    (draft.quickOrders.at(-1)! as unknown as { id: string }).id = "qbo-9999";
    (draft.quickOrders[0] as unknown as { businessOrderNo: string }).businessOrderNo = formatBusinessOrderNo({
      branchCode: "KGN", brandCode: "WH", businessDate, sequence: 29_400,
    });
    const sharedOrder = draft.quickOrders.find((order) => (
      isSharedChargeQuickOrder(order) && order.chargeLines.length > 0
    ));
    if (!sharedOrder || !isSharedChargeQuickOrder(sharedOrder)) {
      throw new Error("clean shared charge fixture missing");
    }
    (sharedOrder.chargeLines[0] as unknown as { id: string }).id = "qbo-10001-charge-1";
  }, { action: "test.quick-order-candidate-collisions" });
  const state = store.read((current) => current);
  const report = state.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!;
  const quotation = state.currentQuotations.find((item) => item.id === report.quotationId)!;
  const created = await createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, [quotation.lineIds[0]], "bridge-collision-skip"), actor, store,
  );
  expect(created.id).toBe("qbo-10002");
  expect(created.chargeLines?.[0].id).toBe("qbo-10002-charge-1");
});

test("shared-charge BO keeps the ordinary assign and accept state workflow", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const dictionaryStorage = memoryStorage(new Map([
    ["wh_teams_v2", JSON.stringify([{ id: "t1", name: "自建维修班组", engineering: false, builtin: false }])],
  ]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: dictionaryStorage } });
  const superadmin = { id: "emp-001", name: "超级管理员", role: "superadmin" as const };
  try {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const state = store.read((current) => current);
  const report = state.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!;
  const quotation = state.currentQuotations.find((item) => item.id === report.quotationId)!;
  const created = await createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, [quotation.lineIds[0]], "bridge-status-workflow"), superadmin, store,
  );
  const assigned = await applyMockQuickOrderAction(
    created.id, { kind: "assign", teamId: "t1", etaDays: 2 }, superadmin.name, "frontdesk", store,
  );
  expect(assigned).toMatchObject({ status: "assigned", teamId: "t1", etaDays: 2, chargeContract: "shared_v1" });
  const accepted = await applyMockQuickOrderAction(
    created.id, { kind: "accept", mechanicName: "超级管理员", startMileageKm: 82_001 }, "超级管理员", "mechanic", store,
  );
  expect(accepted).toMatchObject({ status: "in_repair", mechanicName: "超级管理员", startMileageKm: 82_001, chargeContract: "shared_v1" });
  expect(accepted.chargeLines).toEqual(created.chargeLines);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("exact retry returns the first BO while ordered selection, revision, and signature drift reuse is 409", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const saved = await replaceQuotation(store, {
    mutationId: "bridge-retry-source",
    lines: [
      unitLine({ category: "labor", descZh: "高优惠工时", unitPriceJmd: 10_000, unitDiscountJmd: 2_001 }),
      unitLine({ category: "parts", descZh: "普通配件", unitPriceJmd: 10_000 }),
    ],
    signature: { rawStrokes: QUOTATION_STROKES },
  });
  const input = bridgeInput(store, saved.lineIds, "bridge-retry-bo", {
    quickOrderSignature: { rawStrokes: BO_STROKES },
  });
  const first = await createMockQuickOrderFromInspectionQuotation(input, actor, store);
  const exactReplay = await createMockQuickOrderFromInspectionQuotation(input, actor, store);
  expect(exactReplay).toEqual(first);
  expect(store.read((state) => state.quickOrders.filter((order) => order.id === first.id))).toHaveLength(1);
  expect(store.read((state) => state.discountSignatureEvents.filter((event) => event.mutationId === input.quickOrderMutationId))).toHaveLength(1);

  await expect(createMockQuickOrderFromInspectionQuotation({
    ...input,
    selectedLineIds: input.selectedLineIds.toReversed(),
  }, actor, store)).rejects.toMatchObject({ status: 409 });
  await expect(createMockQuickOrderFromInspectionQuotation({
    ...input,
    expectedRevision: input.expectedRevision + 1,
  }, actor, store)).rejects.toMatchObject({ status: 409 });
  await expect(createMockQuickOrderFromInspectionQuotation({
    ...input,
    quickOrderSignature: { rawStrokes: DRIFTED_BO_STROKES },
  }, actor, store)).rejects.toMatchObject({ status: 409 });

  const latest = store.read((state) => state);
  const current = latest.currentQuotations.find((quotation) => quotation.inspectionReportId === input.reportId)!;
  await updateMockQuotation({
    reportId: input.reportId,
    expectedRevision: latest.revision,
    mutationId: "bridge-retry-value-drift",
    noteZh: current.noteZh,
    noteEn: current.noteEn,
    lines: [
      unitLine({ id: saved.lineIds[0], category: "labor", descZh: "价格已变", unitPriceJmd: 10_001, unitDiscountJmd: 2_001 }),
      unitLine({ id: saved.lineIds[1], category: "parts", descZh: "普通配件", unitPriceJmd: 10_000 }),
    ],
    signature: { rawStrokes: DRIFTED_QUOTATION_STROKES },
  }, actor, store);
  await expect(createMockQuickOrderFromInspectionQuotation({
    ...input,
    expectedRevision: store.read((state) => state.revision),
  }, actor, store)).rejects.toMatchObject({ status: 409 });
});

test("recomputes strict thresholds from selected target lines rather than the whole source Quotation", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const diluted = await replaceQuotation(store, {
    mutationId: "bridge-threshold-diluted",
    lines: [
      unitLine({ category: "labor", descZh: "高优惠子集", unitPriceJmd: 10_000, unitDiscountJmd: 2_001 }),
      unitLine({ category: "labor", descZh: "未优惠稀释行", unitPriceJmd: 100_000, unitDiscountJmd: 0 }),
      unitLine({ category: "parts", descZh: "阈值相等配件", unitPriceJmd: 8_000, unitDiscountJmd: 1_000 }),
    ],
  });
  expect(store.read((state) => state.discountSignatureEvents)).toHaveLength(0);
  await expect(createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, [diluted.lineIds[0]], "bridge-target-high-no-signature"), actor, store,
  )).rejects.toMatchObject({ status: 400 });
  await expect(createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, [diluted.lineIds[2]], "bridge-target-equal"), actor, store,
  )).resolves.toMatchObject({ chargeContract: "shared_v1" });
  await expect(createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, [diluted.lineIds[0]], "bridge-target-high-signed", { quickOrderSignature: { rawStrokes: BO_STROKES } }), actor, store,
  )).resolves.toMatchObject({ chargeContract: "shared_v1" });

  const highSource = await replaceQuotation(store, {
    mutationId: "bridge-threshold-high-source",
    lines: [
      unitLine({ category: "labor", descZh: "来源高优惠", unitPriceJmd: 10_000, unitDiscountJmd: 2_001 }),
      unitLine({ category: "parts", descZh: "目标普通配件", unitPriceJmd: 10_000, unitDiscountJmd: 0 }),
    ],
    signature: { rawStrokes: QUOTATION_STROKES },
  });
  await expect(createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, [highSource.lineIds[1]], "bridge-source-high-target-low"), actor, store,
  )).resolves.toMatchObject({ chargeContract: "shared_v1" });
});

test("an already-signed high Quotation still needs a fresh BO signature and rejects reused raw strokes", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const saved = await replaceQuotation(store, {
    mutationId: "bridge-source-signed",
    lines: [unitLine({ category: "labor", descZh: "高优惠工时", unitPriceJmd: 10_000, unitDiscountJmd: 2_001 })],
    signature: { rawStrokes: QUOTATION_STROKES },
  });
  await expect(createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, saved.lineIds, "bridge-bo-missing-signature"), actor, store,
  )).rejects.toMatchObject({ status: 400 });
  await expect(createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, saved.lineIds, "bridge-bo-reused-strokes", { quickOrderSignature: { rawStrokes: QUOTATION_STROKES } }), actor, store,
  )).rejects.toMatchObject({ status: 409 });
  const order = await createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, saved.lineIds, "bridge-bo-fresh-strokes", {
      quotationMutationId: "bridge-source-signed",
      quickOrderSignature: { rawStrokes: BO_STROKES },
    }),
    actor,
    store,
  );
  const events = store.read((state) => state.discountSignatureEvents);
  expect(events).toHaveLength(2);
  expect(events).toEqual([
    expect.objectContaining({ document: expect.objectContaining({ kind: "quotation" }), mutationId: "bridge-source-signed", rawStrokes: QUOTATION_STROKES }),
    expect.objectContaining({ document: { kind: "business_order", id: order.id }, mutationId: "bridge-bo-fresh-strokes", rawStrokes: BO_STROKES, operationAccount: { id: actor.id, name: actor.name } }),
  ]);
  expect(events[0].signedAt).toMatch(/-05:00$/);
  expect(events[1].signedAt).toMatch(/-05:00$/);
  const receipt = store.read((state) => state.mutationReceipts.find((candidate) => candidate.mutationId === "bridge-bo-fresh-strokes"));
  expect(order.createdAt).toBe(events[1].signedAt);
  expect(order.statusHistory[0].at).toBe(order.createdAt);
  expect(receipt?.committedAt).toBe(order.createdAt);
});

test("rejects equal Quotation and BO mutation IDs before either target signature can be reused", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const state = store.read((current) => current);
  const report = state.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!;
  const quotation = state.currentQuotations.find((item) => item.id === report.quotationId)!;
  await expect(createMockQuickOrderFromInspectionQuotation({
    reportId: report.id,
    expectedRevision: state.revision,
    quotationMutationId: "same-write-id",
    quickOrderMutationId: "same-write-id",
    selectedLineIds: [quotation.lineIds[0]],
  }, actor, store)).rejects.toMatchObject({ status: 400 });
  expect(store.read((current) => current.quickOrders)).toHaveLength(state.quickOrders.length);
});

test("rejects spoof fields, unauthorized roles, and a Quotation prerequisite receipt from another report", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const initial = store.read((current) => current);
  const report = initial.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!;
  const quotation = initial.currentQuotations.find((item) => item.id === report.quotationId)!;
  const base = bridgeInput(store, [quotation.lineIds[0]], "bridge-closed-input");
  await expect(createMockQuickOrderFromInspectionQuotation(
    { ...base, createdBy: "伪造账号" } as CreateQuickOrderFromInspectionQuotationInput,
    actor,
    store,
  )).rejects.toMatchObject({ status: 400 });
  await expect(createMockQuickOrderFromInspectionQuotation(
    { ...base, quickOrderMutationId: "bridge-unauthorized" },
    { id: "emp-finance", name: "财务", role: "finance" } as never,
    store,
  )).rejects.toMatchObject({ status: 403 });

  await replaceQuotation(store, {
    reportId: "inspection-report-demo-02",
    mutationId: "bridge-other-report-quotation",
    lines: [unitLine({ category: "labor", descZh: "其他报告工时", unitPriceJmd: 30_000 })],
  });
  const current = store.read((state) => state);
  const currentReport = current.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!;
  const currentQuotation = current.currentQuotations.find((item) => item.id === currentReport.quotationId)!;
  const before = structuredClone(current);
  await expect(createMockQuickOrderFromInspectionQuotation({
    reportId: currentReport.id,
    expectedRevision: current.revision,
    quotationMutationId: "bridge-other-report-quotation",
    quickOrderMutationId: "bridge-wrong-prerequisite",
    selectedLineIds: [currentQuotation.lineIds[0]],
  }, actor, store)).rejects.toMatchObject({ status: 409 });
  expect(store.read((state) => state)).toEqual(before);
});

test("manual Quick BO creation still rejects blank raw input while the IR bridge owns the blank exception", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const state = store.read((current) => current);
  const report = state.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!;
  await expect(createMockQuickOrder({
    customerId: report.customerId,
    vehicleId: report.vehicleId,
    rawInput: "   ",
    items: [{ descZh: "工时", descEn: "Labor", category: "labor", unitPriceJmd: 100, quantity: 1, pendingQuote: false }],
  }, actor.name, store)).rejects.toMatchObject({ status: 400 });
});

test("shared BO notes use locked idempotency, reject stale or drifted requests, and survive response loss", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const source = store.read((state) => state.currentQuotations.find((quotation) => quotation.inspectionReportId === "inspection-report-demo-01")!);
  const order = await createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, [source.lineIds[0]], "bridge-editable-note"),
    actor,
    store,
  );
  const canonicalBefore = structuredClone(order.chargeLines);

  const editedInput = {
    orderId: order.id,
    expectedEditCount: order.editHistory.length,
    mutationId: "bridge-note-edit",
    noteZh: "客户已确认",
    noteEn: "",
  };
  const edited = await updateMockQuickOrderNotes(editedInput, actor, store);
  expect(edited.noteZh).toBe("客户已确认");
  expect(edited.noteEn).toBeNull();
  expect(edited.chargeLines).toEqual(canonicalBefore);
  expect(edited.items).toEqual([]);

  expect(await updateMockQuickOrderNotes(editedInput, actor, store)).toEqual(edited);
  await expect(updateMockQuickOrderNotes({ ...editedInput, noteZh: "漂移" }, actor, store)).rejects.toMatchObject({ status: 409 });
  await expect(updateMockQuickOrderNotes({ ...editedInput, mutationId: "bridge-note-stale" }, actor, store)).rejects.toMatchObject({ status: 409 });

  const deleted = await updateMockQuickOrderNotes({
    orderId: order.id,
    expectedEditCount: edited.editHistory.length,
    mutationId: "bridge-note-delete",
    noteZh: "",
    noteEn: "",
  }, actor, store);
  expect(deleted.noteZh).toBeNull();
  expect(deleted.noteEn).toBeNull();
  expect(deleted.chargeLines).toEqual(canonicalBefore);
});

test("shared BO note response loss commits once and exact retry returns the receipt", async () => {
  const scenario = { failNext: { byAction: { "quickOrders.notes.update.response": "备注响应丢失" } } };
  const restore = installLinkedScenario(scenario);
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const source = store.read((state) => state.currentQuotations.find((quotation) => quotation.inspectionReportId === "inspection-report-demo-01")!);
    const order = await createMockQuickOrderFromInspectionQuotation(
      bridgeInput(store, [source.lineIds[0]], "bridge-note-loss-create"),
      actor,
      store,
    );
    const input = { orderId: order.id, expectedEditCount: 0, mutationId: "bridge-note-loss", noteZh: "已承诺", noteEn: "" };
    await expect(updateMockQuickOrderNotes(input, actor, store)).rejects.toMatchObject({ status: 503 });
    expect(store.read((state) => state.quickOrders.find((item) => item.id === order.id)?.noteZh)).toBe("已承诺");
    const replay = await updateMockQuickOrderNotes(input, actor, store);
    expect(replay.noteZh).toBe("已承诺");
    expect(store.read((state) => state.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId))).toHaveLength(1);
  } finally {
    restore();
  }
});

test("an already high-discount shared BO signs only when labor or parts threshold money changes and remains high", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const saved = await replaceQuotation(store, {
    mutationId: "bridge-threshold-source",
    lines: [
      unitLine({ category: "labor", descZh: "高优惠工时", unitPriceJmd: 10_000, unitDiscountJmd: 2_001 }),
      fixedLine({ descZh: "拖车费", amountJmd: 500 }),
    ],
    signature: { rawStrokes: QUOTATION_STROKES },
  });
  let order = await createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, saved.lineIds, "bridge-threshold-create", { quickOrderSignature: { rawStrokes: BO_STROKES } }),
    actor,
    store,
  );
  if (!isSharedChargeQuickOrder(order)) throw new Error("shared fixture expected");
  const signatureCount = store.read((state) => state.discountSignatureEvents.length);
  order = await updateMockSharedQuickOrderCharges({
    orderId: order.id,
    expectedEditCount: order.editHistory.length,
    mutationId: "bridge-threshold-text-fixed",
    lines: order.chargeLines.map((line) => line.pricingMode === "fixed_total"
      ? { ...line, descZh: "新拖车费", amountJmd: 750 }
      : { ...line, descEn: "High discount labor" }),
  }, actor, store);
  expect(store.read((state) => state.discountSignatureEvents)).toHaveLength(signatureCount);

  if (!isSharedChargeQuickOrder(order)) throw new Error("shared fixture expected");
  const labor = order.chargeLines.find((line) => line.pricingMode === "unit")!;
  const highInput = {
    orderId: order.id,
    expectedEditCount: order.editHistory.length,
    mutationId: "bridge-threshold-money-high",
    lines: order.chargeLines.map((line) => line.id === labor.id ? { ...line, quantity: 2 } : line),
  };
  await expect(updateMockSharedQuickOrderCharges(highInput, actor, store)).rejects.toMatchObject({ status: 400 });
  order = await updateMockSharedQuickOrderCharges({ ...highInput, signature: { rawStrokes: DRIFTED_BO_STROKES } }, actor, store);
  expect(store.read((state) => state.discountSignatureEvents)).toHaveLength(signatureCount + 1);

  if (!isSharedChargeQuickOrder(order)) throw new Error("shared fixture expected");
  const lowered = await updateMockSharedQuickOrderCharges({
    orderId: order.id,
    expectedEditCount: order.editHistory.length,
    mutationId: "bridge-threshold-money-low",
    lines: order.chargeLines.map((line) => line.pricingMode === "unit" ? { ...line, unitDiscountJmd: 0 } : line),
  }, actor, store);
  expect(store.read((state) => state.discountSignatureEvents)).toHaveLength(signatureCount + 1);
  expect(isSharedChargeQuickOrder(lowered) && lowered.chargeLines.some((line) => line.pricingMode === "unit" && line.unitDiscountJmd === 0)).toBe(true);
});

test("bridge create and shared update reject unused signatures at or below threshold without a receipt", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const saved = await replaceQuotation(store, {
    mutationId: "bridge-unused-signature-source",
    lines: [unitLine({ category: "labor", descZh: "低优惠工时", unitPriceJmd: 10_000, unitDiscountJmd: 2_000 })],
  });
  const createInput = bridgeInput(store, saved.lineIds, "bridge-unused-signature-create", {
    quickOrderSignature: { rawStrokes: BO_STROKES },
  });
  const beforeCreate = store.read((state) => state);
  await expect(createMockQuickOrderFromInspectionQuotation(createInput, actor, store)).rejects.toMatchObject({ status: 400 });
  expect(store.read((state) => state)).toEqual(beforeCreate);
  const order = await createMockQuickOrderFromInspectionQuotation({ ...createInput, quickOrderSignature: undefined }, actor, store);
  if (!isSharedChargeQuickOrder(order)) throw new Error("shared fixture expected");

  const updateInput = {
    orderId: order.id,
    expectedEditCount: order.editHistory.length,
    mutationId: "bridge-unused-signature-update",
    lines: order.chargeLines.map((line) => ({ ...line, descEn: "Low discount labor" })),
    signature: { rawStrokes: DRIFTED_BO_STROKES },
  };
  const beforeUpdate = store.read((state) => state);
  await expect(updateMockSharedQuickOrderCharges(updateInput, actor, store)).rejects.toMatchObject({ status: 400 });
  expect(store.read((state) => state)).toEqual(beforeUpdate);
  const updated = await updateMockSharedQuickOrderCharges({ ...updateInput, signature: undefined }, actor, store);
  expect(isSharedChargeQuickOrder(updated) && updated.chargeLines[0].descEn).toBe("Low discount labor");
});

test("shared BO records an arbitrary signed cash refund without changing its charge lines", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const source = store.read((state) => state.currentQuotations.find((quotation) => quotation.inspectionReportId === "inspection-report-demo-01")!);
  const order = await createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, [source.lineIds[0]], "bridge-refund-guard-create"),
    actor,
    store,
  );
  const beforeLines = structuredClone(order.chargeLines);
  const updated = await recordMockQuickRefund(order.id, {
    amountJmd: 1,
    method: "cash",
    reason: "客户确认现金退款",
    originalDocumentStatus: "returned",
    signerName: "客户本人",
    signatureDataUrl: "data:image/png;base64,AA==",
  }, actor.name, store);
  expect(updated.chargeLines).toEqual(beforeLines);
  expect(updated.refunds.at(-1)).toMatchObject({ amountJmd: 1, category: null });
});

test("shared BO charge edits stay independent, preserve stable IDs, allocate new IDs, and require fresh target approval", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const saved = await replaceQuotation(store, {
    mutationId: "bridge-shared-edit-source",
    lines: [
      unitLine({ category: "labor", descZh: "原工时", descEn: "Labor", unitPriceJmd: 10_000 }),
      unitLine({ category: "parts", descZh: "原配件", descEn: "Part", unitPriceJmd: 5_000 }),
      fixedLine({ descZh: "原拖车费", descEn: "Towing", amountJmd: 1_500 }),
    ],
  });
  const order = await createMockQuickOrderFromInspectionQuotation(
    bridgeInput(store, saved.lineIds, "bridge-shared-edit-create"),
    actor,
    store,
  );
  expect(isSharedChargeQuickOrder(order)).toBe(true);
  if (!isSharedChargeQuickOrder(order)) throw new Error("shared fixture expected");
  const [labor, parts, removedFixed] = order.chargeLines;
  const sourceBefore = store.read((state) => ({
    report: structuredClone(state.inspectionReports),
    quotation: structuredClone(state.currentQuotations),
    lines: structuredClone(state.quotedChargeLines),
    communication: structuredClone(state.communicationEvents),
    generation: structuredClone(state.generationEvents),
  }));
  const input = {
    orderId: order.id,
    expectedEditCount: order.editHistory.length,
    mutationId: "bridge-shared-edit-write",
    lines: [
      { ...labor, descEn: "", unitPriceJmd: 20_000, unitDiscountJmd: 4_001 },
      parts,
      {
        category: "other_service" as const,
        pricingMode: "fixed_total" as const,
        code: "other" as const,
        descZh: "新其他费用",
        descEn: "",
        remarkZh: "",
        remarkEn: "",
        amountJmd: 2_000,
      },
    ],
  };
  const beforeFailure = store.read((state) => state);
  await expect(updateMockSharedQuickOrderCharges(input, actor, store)).rejects.toMatchObject({ status: 400 });
  expect(store.read((state) => state)).toEqual(beforeFailure);

  const updated = await updateMockSharedQuickOrderCharges({
    ...input,
    signature: { rawStrokes: BO_STROKES },
  }, actor, store);
  expect(isSharedChargeQuickOrder(updated)).toBe(true);
  if (!isSharedChargeQuickOrder(updated)) throw new Error("shared update expected");
  expect(updated.chargeLines[0].id).toBe(labor.id);
  expect(updated.chargeLines[1].id).toBe(parts.id);
  expect(updated.chargeLines.some((line) => line.id === removedFixed.id)).toBe(false);
  const newFixed = updated.chargeLines[2] as unknown as Record<string, unknown>;
  expect(newFixed.id).toMatch(new RegExp(`^${order.id}-charge-\\d+$`));
  expect(newFixed).toMatchObject({ pricingMode: "fixed_total", amountJmd: 2_000, descEn: "" });
  expect(newFixed).not.toHaveProperty("quantity");
  expect(newFixed).not.toHaveProperty("unitPriceJmd");
  expect(updated.performanceValueJmd).toBe(20_000);
  expect(updated.items).toEqual([]);
  expect(store.read((state) => ({
    report: state.inspectionReports,
    quotation: state.currentQuotations,
    lines: state.quotedChargeLines,
    communication: state.communicationEvents,
    generation: state.generationEvents,
  }))).toEqual(sourceBefore);

  expect(await updateMockSharedQuickOrderCharges({ ...input, signature: { rawStrokes: BO_STROKES } }, actor, store)).toEqual(updated);
  await expect(updateMockSharedQuickOrderCharges({
    ...input,
    lines: input.lines.slice(0, 2),
    signature: { rawStrokes: BO_STROKES },
  }, actor, store)).rejects.toMatchObject({ status: 409 });
});

test("shared BO charge persistence failure consumes neither signature nor receipt and exact retry succeeds once", async () => {
  const scenario = { failNext: { byAction: { "quickOrders.sharedCharges.update.write": "shared 收费写入故障" } } };
  const restore = installLinkedScenario(scenario);
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const current = store.read((state) => state.currentQuotations.find((quotation) => quotation.inspectionReportId === "inspection-report-demo-01")!);
    const order = await createMockQuickOrderFromInspectionQuotation(
      bridgeInput(store, [current.lineIds[0]], "bridge-shared-fault-create"),
      actor,
      store,
    );
    if (!isSharedChargeQuickOrder(order)) throw new Error("shared fixture expected");
    const line = order.chargeLines[0];
    if (line.pricingMode !== "unit") throw new Error("unit fixture expected");
    const input = {
      orderId: order.id,
      expectedEditCount: 0,
      mutationId: "bridge-shared-fault-update",
      lines: [{ ...line, unitPriceJmd: 10_000, unitDiscountJmd: 2_001 }],
      signature: { rawStrokes: BO_STROKES },
    };
    const before = store.read((state) => state);
    await expect(updateMockSharedQuickOrderCharges(input, actor, store)).rejects.toMatchObject({ status: 503 });
    expect(store.read((state) => state)).toEqual(before);
    const updated = await updateMockSharedQuickOrderCharges(input, actor, store);
    const replay = await updateMockSharedQuickOrderCharges(input, actor, store);
    expect(replay).toEqual(updated);
    expect(store.read((state) => state.discountSignatureEvents.filter((event) => event.mutationId === input.mutationId))).toHaveLength(1);
    expect(store.read((state) => state.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId))).toHaveLength(1);
  } finally {
    restore();
  }
});

test("a BO persistence failure after Quotation success consumes no BO signature or receipt and exact retry creates once", async () => {
  const scenario = { failNext: { byAction: { "quickOrders.createFromInspection.write": "BO 写入故障" } } };
  const restore = installLinkedScenario(scenario);
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const saved = await replaceQuotation(store, {
      mutationId: "bridge-two-write-source",
      lines: [unitLine({ category: "labor", descZh: "高优惠工时", unitPriceJmd: 10_000, unitDiscountJmd: 2_001 })],
      signature: { rawStrokes: QUOTATION_STROKES },
    });
    const beforeBo = store.read((state) => ({ revision: state.revision, quickCount: state.quickOrders.length, signatureCount: state.discountSignatureEvents.length }));
    const input = bridgeInput(store, saved.lineIds, "bridge-two-write-bo", {
      quotationMutationId: "bridge-two-write-source",
      quickOrderSignature: { rawStrokes: BO_STROKES },
    });
    await expect(createMockQuickOrderFromInspectionQuotation(input, actor, store)).rejects.toMatchObject({ status: 503 });
    const failed = store.read((state) => state);
    expect(failed.revision).toBe(beforeBo.revision);
    expect(failed.quickOrders).toHaveLength(beforeBo.quickCount);
    expect(failed.discountSignatureEvents).toHaveLength(beforeBo.signatureCount);
    expect(failed.mutationReceipts.find((receipt) => receipt.mutationId === input.quickOrderMutationId)).toBeUndefined();
    expect(failed.mutationReceipts.find((receipt) => receipt.mutationId === input.quotationMutationId)).toBeDefined();

    const created = await createMockQuickOrderFromInspectionQuotation(input, actor, store);
    const replayAfterLostResponse = await createMockQuickOrderFromInspectionQuotation(input, actor, store);
    expect(replayAfterLostResponse).toEqual(created);
    const final = store.read((state) => state);
    expect(final.quickOrders.filter((order) => order.id === created.id)).toHaveLength(1);
    expect(final.discountSignatureEvents.filter((event) => event.mutationId === input.quickOrderMutationId)).toHaveLength(1);
  } finally {
    restore();
  }
});

test("schema v8 rejects ambiguous or malformed shared Quick BO charge persistence", () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const clean = store.read((state) => state);
  expect(() => validateLinkedOperationsState(clean)).not.toThrow();

  const malformedCases = [
    (state: LinkedOperationsState) => {
      const order = state.quickOrders[0] as unknown as Record<string, unknown>;
      order.items = [];
      order.chargeContract = "shared_v1";
      order.chargeLines = [{ id: "bad-fixed", category: "other_service", pricingMode: "fixed_total", code: "other", descZh: "其他", descEn: "", remarkZh: "", remarkEn: "", amountJmd: 100, quantity: 1 }];
    },
    (state: LinkedOperationsState) => {
      const order = state.quickOrders[0] as unknown as Record<string, unknown>;
      order.items = [];
      order.chargeContract = "shared_v1";
      order.chargeLines = [{ id: "bad-source", category: "labor", pricingMode: "unit", descZh: "工时", descEn: "", remarkZh: "", remarkEn: "", unit: "工时", unitEn: "", quantity: 1, unitPriceJmd: 100, unitDiscountJmd: 0, pendingQuote: false, sourceId: "quotation-line" }];
    },
    (state: LinkedOperationsState) => {
      const order = state.quickOrders[0] as unknown as Record<string, unknown>;
      order.items = [];
      order.chargeContract = "shared_v1";
      order.chargeLines = [{ id: "bad-parking", category: "other_service", pricingMode: "parking_projection", code: "parking_overtime", descZh: "停车", descEn: "", remarkZh: "", remarkEn: "", parkingCaseId: "case", sourceRevision: 1, asOf: "2026-08-21T10:00:00-05:00", amountJmd: 100 }];
    },
    (state: LinkedOperationsState) => {
      const order = state.quickOrders[0] as unknown as Record<string, unknown>;
      order.items = [];
      order.chargeContract = "shared_v1";
      order.chargeLines = [{ id: "ambiguous", category: "labor", pricingMode: "unit", descZh: "工时", descEn: "", remarkZh: "", remarkEn: "", unit: "工时", unitEn: "", quantity: 1, unitPriceJmd: 100, unitDiscountJmd: 1, pendingQuote: false }];
      order.laborDiscountJmd = 1;
    },
  ];
  for (const mutate of malformedCases) {
    const candidate = structuredClone(clean);
    mutate(candidate);
    expect(() => validateLinkedOperationsState(candidate)).toThrow();
  }
});
