import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { api, linkedApiError } from "../../src/lib/api/client";
import {
  createMockLinkedOperationsStore,
  getMockLinkedOperationsStore,
  LINKED_OPERATIONS_STORAGE_KEY,
  LinkedApiDomainError,
  validateLinkedOperationsState,
} from "../../src/lib/api/mock-orders";
import {
  createMockInspectionReportFromInput,
  deriveInspectionCommunicationSummary,
  generateMockInspectionReportFiles,
  getMockInspectionReportGeneratedFile,
  getMockInspectionReports,
  getMockVehicleInspectionReportArchive,
  getMockVehicleInspectionReportPhotos,
  resolveMockInspectionReportPhotoBlob,
  resolveMockVehicleInspectionReportPhotoBlob,
  sendMockInspectionReportNotification,
  recordMockInspectionCustomerResponse,
  updateMockInspectionReportDraft,
  updateMockInspectionReportPhotos,
  updateMockQuotation,
  type IrPdfRenderer,
  type UpdateQuotationLineInput,
} from "../../src/lib/api/mock-inspection-reports";
import { canonicalParkingNoticeFacts } from "../../src/lib/parking/notice";
import { formatIrJamaicaDateTime } from "../../src/lib/orders/ir-communication-time";
import { buildInspectionNotificationMessage } from "../../src/components/orders/ir-communications-section";
import { computeWorkbenchReminders } from "../../src/lib/business/workbench-state";
import {
  createMemoryIrGeneratedFileRepository,
  getIrGeneratedFileRepository,
  type IrGeneratedFileRecord,
} from "../../src/lib/orders/ir-generated-file-cache";
import {
  createMemoryReportPhotoRepository,
  getReportPhotoRepository,
  type ReportPhotoBlobRecord,
  type ReportPhotoRepository,
} from "../../src/lib/attachments/indexeddb-attachment-store";
import type { FixedTotalChargeLine, QuotedChargeLine } from "../../src/lib/billing/quoted-charges";
import {
  mergeQuotationLinesFromParsed,
  parseInspectionNaturalLanguage,
  quotationLinesFromParsed,
} from "../../src/lib/orders/ir-nl-parse";

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

function installBrowser(session: unknown = null, scenario?: unknown): () => void {
  const values = new Map<string, string>();
  if (session !== null) values.set("wh_session", JSON.stringify(session));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage, __WH_LINKED_OPERATIONS_TEST_SCENARIO__: scenario },
  });
  return () => descriptor
    ? Object.defineProperty(globalThis, "window", descriptor)
    : void Reflect.deleteProperty(globalThis, "window");
}

const session = (id: string, role: string, name = "测试用户") => ({ identity: { id, role, name } });
const superadmin = session("emp-001", "superadmin", "LiJian");
const frontdesk = session("emp-003", "frontdesk_admin", "前台");
const finance = session("emp-002", "finance", "财务");
const parts = session("emp-004", "parts", "配件");
const mechanic = session("emp-005", "mechanic", "维修工");
const frontdeskActor = { id: "emp-003", name: "前台", role: "frontdesk_admin" as const };

const RAW_STROKES = [[{ x: 12, y: 18, time: 1 }, { x: 20, y: 24, time: 2 }]] as const;
const PHOTO_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));

function canonicalPayload(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalPayload(record[key])}`).join(",")}}`;
}

function receiptPayloadHash(source: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

test("notification parking copy is absent without a case and uses canonical D/D+1/D+2 facts when present", () => {
  expect(canonicalParkingNoticeFacts(null)).toBeNull();
  expect(canonicalParkingNoticeFacts({
    notificationDate: "2026-08-20",
    pickupDate: undefined,
    dailyRateJmd: 2_500,
  })).toEqual({
    notificationDate: "2026-08-20",
    graceThroughDate: "2026-08-21",
    chargeStartsDate: "2026-08-22",
    dailyRateJmd: 2_500,
    pickupDayExcluded: true,
  });
});

test("Task7 communication timestamps render in Jamaica independently of the browser timezone", () => {
  expect(formatIrJamaicaDateTime("2026-08-20T23:30:00-05:00")).toBe("2026-08-20 23:30");
  expect(formatIrJamaicaDateTime("2026-08-21T04:30:00Z")).toBe("2026-08-20 23:30");
  expect(formatIrJamaicaDateTime("2027-08-21T04:30:00Z")).toBe("2027-08-20 23:30");
});

test("channel-aware customer copy names the exact Email attachment or labelled demo link", () => {
  const detail = {
    id: "inspection-report-copy",
    reportNo: "KGN-WH-IR-COPY",
    customer: { nameZh: "测试客户", nameEn: "Test Customer" },
    vehicle: { plate: "1234 AB", modelZh: "测试车型", modelEn: "Test Model" },
    parkingNotice: {
      notificationDate: "2026-08-20",
      graceThroughDate: "2026-08-21",
      chargeStartsDate: "2026-08-22",
      dailyRateJmd: 2_500,
      pickupDayExcluded: true,
    },
    quotation: {
      activeGeneratedBundle: {
        generation: 2,
        attachments: [{ language: "en", fileName: "KGN-WH-IR-COPY-EN.pdf" }],
      },
    },
  } as unknown as Parameters<typeof buildInspectionNotificationMessage>[0];
  const sms = buildInspectionNotificationMessage(detail, "en", "sms");
  const whatsapp = buildInspectionNotificationMessage(detail, "en", "whatsapp");
  const email = buildInspectionNotificationMessage(detail, "en", "email");
  expect(sms).toContain("Demo report link: https://demo.wholehearted.example/inspection-reports/inspection-report-copy/en");
  expect(whatsapp).toContain("Demo report link: https://demo.wholehearted.example/inspection-reports/inspection-report-copy/en");
  expect(email).toContain("Mock email attachment: V2 · KGN-WH-IR-COPY-EN.pdf.");
  expect(email).not.toContain("demo.wholehearted.example");
  expect(buildInspectionNotificationMessage(detail, "zh", "sms")).toContain("如暂不安排维修，请及时联系前台取车。");
});

test("mechanic reads only the privacy-minimized self intake while generic IR resources remain forbidden", async () => {
  const restore = installBrowser(mechanic);
  try {
    const store = getMockLinkedOperationsStore();
    await store.ready();
    await updateMockInspectionReportPhotos("inspection-report-demo-01", {
      reportId: "inspection-report-demo-01",
      expectedRevision: store.read((state) => state.revision),
      mutationId: "mechanic-intake-current-photo",
      deleteIds: [],
      files: [new File([PHOTO_PNG], "mechanic-current.png", { type: "image/png" })],
    }, frontdeskActor, store, getReportPhotoRepository());
    await store.mutate((state) => {
      const report = state.inspectionReports[0];
      state.inspectionReports[0] = { ...report, inspectorId: "emp-005", inspectorName: "维修工" };
      state.revision += 1;
    });
    const intake = await api.inspectionReports.mechanicIntake();
    expect(intake.items).toHaveLength(1);
    expect(intake.items[0]).toMatchObject({ id: "inspection-report-demo-01", vehicle: { id: expect.any(String), plate: expect.any(String) } });
    expect(intake.items[0].photos.length).toBeGreaterThan(0);
    const photo = intake.items[0].photos[0];
    expect(photo).toEqual({
      id: expect.any(String),
      detectedMediaType: expect.stringMatching(/^image\/(jpeg|png|webp)$/),
      widthPx: expect.any(Number),
      heightPx: expect.any(Number),
    });
    const ownBlob = await api.inspectionReports.mechanicPhotoBlob(intake.items[0].id, photo.id);
    expect(ownBlob.size).toBeGreaterThan(0);
    const serialized = JSON.stringify(intake);
    for (const forbidden of ["customer", "phone", "email", "quotation", "amountJmd", "generated", "notification", "response", "photoIds"]) {
      expect(serialized).not.toContain(`\"${forbidden}\"`);
    }
    await expect(api.inspectionReports.list()).rejects.toMatchObject({ status: 403 });
    await expect(api.inspectionReports.detail("inspection-report-demo-01")).rejects.toMatchObject({ status: 403 });

    const inFlight = api.inspectionReports.mechanicPhotoBlob(intake.items[0].id, photo.id);
    window.localStorage.setItem("wh_session", JSON.stringify(session("emp-006", "mechanic", "另一维修工")));
    await expect(inFlight).rejects.toMatchObject({ status: 403 });
    await expect(api.inspectionReports.mechanicPhotoBlob(intake.items[0].id, photo.id)).rejects.toMatchObject({ status: 404 });

    window.localStorage.setItem("wh_session", JSON.stringify(finance));
    await expect(api.inspectionReports.mechanicIntake()).rejects.toMatchObject({ status: 403 });
  } finally {
    restore();
  }
});

test("vehicle IR archive groups independent report history without mutating the vehicle photo domain", () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const state = store.read((current) => current);
  const report = state.inspectionReports[0];
  const linkedVehiclesBefore = structuredClone(state.vehicles);
  const archive = getMockVehicleInspectionReportArchive(report.vehicleId, store);
  const group = archive.find((candidate) => candidate.reportId === report.id);
  expect(group).toMatchObject({
    reportId: report.id,
    reportNo: report.inspectionReportNo,
    submittedAt: report.submittedAt,
    communicationStatus: "not_notified",
    currentResponse: null,
    generation: null,
  });
  expect(group?.findings.map((finding) => finding.id)).toEqual(report.itemIds);
  expect(group?.quotation.lines.map((line) => line.id)).toEqual(
    state.currentQuotations.find((quotation) => quotation.id === report.quotationId)?.lineIds,
  );
  expect(group?.photos.map((photo) => photo.id)).toEqual(report.photoIds);
  expect(group?.legacyHistory.sourceSchemaVersion).toBe(state.legacyIrHistory.sourceSchemaVersion);
  expect(store.read((current) => current.vehicles)).toEqual(linkedVehiclesBefore);
});

test("list updatedAt follows quotation, photo, and draft mutation receipts instead of only generation or communication", async () => {
  const scenario = { nowMs: Date.parse("2026-08-21T11:00:00-05:00") };
  const restore = installBrowser(frontdesk, scenario);
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const reportId = "inspection-report-demo-03";
    const before = store.read((state) => state);
    const report = before.inspectionReports.find((candidate) => candidate.id === reportId)!;
    const quotation = before.currentQuotations.find((candidate) => candidate.id === report.quotationId)!;
    await updateMockQuotation({
      reportId,
      expectedRevision: before.revision,
      mutationId: "task7-updated-at-quotation",
      noteZh: "list update from quotation",
      noteEn: quotation.noteEn,
      lines: quotation.lineIds.map((id) => editableLine(before.quotedChargeLines.find((line) => line.id === id)!)),
    }, frontdeskActor, store);
    expect(getMockInspectionReports({}, store).items.find((item) => item.id === reportId)?.updatedAt).toBe("2026-08-21T11:00:00.000-05:00");

    scenario.nowMs = Date.parse("2026-08-21T11:01:00-05:00");
    await updateMockInspectionReportPhotos(reportId, {
      reportId,
      expectedRevision: store.read((state) => state.revision),
      mutationId: "task7-updated-at-photo",
      deleteIds: [],
      files: [new File([PHOTO_PNG], "updated-at.png", { type: "image/png" })],
    }, frontdeskActor, store, createMemoryReportPhotoRepository());
    expect(getMockInspectionReports({}, store).items.find((item) => item.id === reportId)?.updatedAt).toBe("2026-08-21T11:01:00.000-05:00");

    scenario.nowMs = Date.parse("2026-08-21T10:00:00-05:00");
    const latest = store.read((state) => state);
    const latestReport = latest.inspectionReports.find((candidate) => candidate.id === reportId)!;
    await updateMockInspectionReportDraft(reportId, {
      expectedRevision: latest.revision,
      mutationId: "task7-updated-at-draft",
      rawText: `${latestReport.rawText}\nfrontdesk clarification`,
      aiDraft: latestReport.aiDraft,
      items: latestReport.itemIds.map((id) => {
        const item = latest.inspectionItems.find((candidate) => candidate.id === id)!;
        return {
          findingZh: item.findingZh,
          findingEn: item.findingEn,
          recommendationZh: item.recommendationZh,
          recommendationEn: item.recommendationEn,
          remarkZh: item.remarkZh,
          remarkEn: item.remarkEn,
          nextStepZh: item.nextStepZh,
          nextStepEn: item.nextStepEn,
        };
      }),
    }, frontdeskActor, store);
    expect(getMockInspectionReports({}, store).items.find((item) => item.id === reportId)?.updatedAt).toBe("2026-08-21T10:00:00.000-05:00");
  } finally {
    restore();
  }
});

const fakePdfRenderer = (calls: Array<{ language: string; version: number; generatedAt: string }> = []): IrPdfRenderer => (
  async (source, language) => {
    calls.push({ language, version: source.generation.version, generatedAt: source.generation.generatedAt });
    const marker = language === "zh" ? 1 : language === "en" ? 2 : 3;
    return {
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, marker, source.generation.version]),
      fileName: `${source.reportNo}-V${source.generation.version}-${language}.pdf`,
    };
  }
);

const generatedRecordBundle = (
  bundleId: string,
  reportId = "inspection-report-demo-01",
  quotationId = "quotation-demo-01",
): IrGeneratedFileRecord[] => (["zh", "en", "bilingual"] as const).map((language, index) => ({
  id: `${bundleId}-${language}`,
  bundleId,
  reportId,
  quotationId,
  language,
  fileName: `${bundleId}-${language}.pdf`,
  mediaType: "application/pdf",
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, index + 1]),
}));

function unitLine(input: {
  id?: string;
  category: "labor" | "parts";
  descZh: string;
  quantity?: number;
  unitPriceJmd: number;
  unitDiscountJmd?: number;
  pendingQuote?: boolean;
}) {
  return {
    ...(input.id ? { id: input.id } : {}),
    category: input.category,
    pricingMode: "unit" as const,
    descZh: input.descZh,
    descEn: "",
    remarkZh: "",
    remarkEn: "",
    unit: input.category === "labor" ? "工时" : "个",
    unitEn: input.category === "labor" ? "hours" : "pcs",
    quantity: input.quantity ?? 1,
    unitPriceJmd: input.unitPriceJmd,
    unitDiscountJmd: input.unitDiscountJmd ?? 0,
    pendingQuote: input.pendingQuote ?? false,
  };
}

function fixedLine(input: { id?: string; descZh: string; amountJmd: number; code?: "towing" | "offsite_service" | "other" }) {
  return {
    ...(input.id ? { id: input.id } : {}),
    category: "other_service" as const,
    pricingMode: "fixed_total" as const,
    code: input.code ?? "other",
    descZh: input.descZh,
    descEn: "",
    remarkZh: "",
    remarkEn: "",
    amountJmd: input.amountJmd,
  };
}

function editableLine(line: QuotedChargeLine): UpdateQuotationLineInput {
  if (line.pricingMode === "parking_projection") throw new Error("IR quotation test fixture cannot contain parking projection");
  const { sourceId: _sourceId, ...editable } = line;
  return editable;
}

test("IR 详情直接暴露 current Quotation 三类收费行与生成计数，legacy versions 不是当前事实", async () => {
  const restore = installBrowser(superadmin);
  try {
    const inspections = await api.inspectionReports.list({ page: 1, pageSize: 50 });
    // 2026-08-20 老板重做演示数据：共 3 份检查结果
    expect(inspections.total).toBe(3);
    expect(inspections.items).toHaveLength(3);
    expect(inspections.items.every((item) => item.reportNo.includes("-IR-"))).toBe(true);
    expect(inspections.items.some((item) => "orderNo" in item)).toBe(false);

    const report = await api.inspectionReports.detail(inspections.items[0].id);
    expect(report.quotation.inspectionReportId).toBe(report.id);
    expect(report.quotation.id).not.toBe(report.id);
    expect(report.quotation.lines[0]).toMatchObject({ pricingMode: "unit", category: "labor" });
    expect(report.quotation).toMatchObject({ generationCounter: expect.any(Number) });
    expect(report.quotation.lines[0]).not.toHaveProperty("inspectionFindingText");
  } finally {
    restore();
  }
});

test("v8 新建检查结果只写 current Quotation，legacy quotation archive 保持逐字段不变", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const before = store.read((state) => ({
    quotations: structuredClone(state.quotations),
    quotationItems: structuredClone(state.quotationItems),
    vehicleId: state.vehicles[0].id,
  }));
  const created = await createMockInspectionReportFromInput({
    vehicleId: before.vehicleId,
    rawText: "检查发现水泵漏水，工时 25000。",
    aiDraft: "更换水泵。",
    items: [{ findingZh: "水泵漏水", recommendationZh: "更换水泵" }],
    quotationItems: [{ descZh: "更换水泵", category: "labor", unitPriceJmd: 25_000 }],
  }, "emp-003", "前台", store);
  const after = store.read((state) => state);

  expect(after.quotations).toEqual(before.quotations);
  expect(after.quotationItems).toEqual(before.quotationItems);
  expect(after.currentQuotations.find((quotation) => quotation.id === created.quotation.id)?.lineIds).toHaveLength(1);
  expect(after.quotedChargeLines).toContainEqual(expect.objectContaining({
    id: created.quotation.lines[0].id,
    pricingMode: "unit",
    category: "labor",
    unitPriceJmd: 25_000,
  }));
});

test("检查结果列表可由后端按来源 Business Order 精确筛选，避免详情页拉取全部记录", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const vehicleId = store.read((state) => state.vehicles[0].id);
  const first = await createMockInspectionReportFromInput({
    vehicleId,
    sourceBusinessOrderId: "business-order-performance-a",
    rawText: "检查制动系统。",
    aiDraft: "检查制动系统。",
    items: [{ findingZh: "制动异响", recommendationZh: "检查制动系统" }],
    quotationItems: [],
  }, "emp-003", "前台", store);
  await createMockInspectionReportFromInput({
    vehicleId,
    sourceBusinessOrderId: "business-order-performance-b",
    rawText: "检查冷却系统。",
    aiDraft: "检查冷却系统。",
    items: [{ findingZh: "冷却液不足", recommendationZh: "检查冷却系统" }],
    quotationItems: [],
  }, "emp-003", "前台", store);

  const result = getMockInspectionReports({ sourceBusinessOrderId: "business-order-performance-a" }, store);
  expect(result.total).toBe(1);
  expect(result.items).toEqual([expect.objectContaining({
    id: first.id,
    sourceBusinessOrderId: "business-order-performance-a",
  })]);
});

test("照片批次只写 Blob metadata，保留重复选择顺序，并以同 mutation 精确 replay", async () => {
  const storage = memoryStorage();
  const store = createMockLinkedOperationsStore(storage);
  let quotaCalls = 0;
  const repository = createMemoryReportPhotoRepository({
    estimateStorage: async () => {
      quotaCalls += 1;
      return { usage: 0, quota: 100_000 };
    },
  });
  const before = store.read((state) => ({
    revision: state.revision,
    photoIds: [...state.inspectionReports.find((report) => report.id === "inspection-report-demo-01")!.photoIds],
    report: structuredClone(state.inspectionReports.find((report) => report.id === "inspection-report-demo-01")),
    quotation: structuredClone(state.currentQuotations.find((quotation) => quotation.inspectionReportId === "inspection-report-demo-01")),
    communications: structuredClone(state.communicationEvents),
    generationEvents: structuredClone(state.generationEvents),
  }));
  expect(before.photoIds).toEqual([]);

  const files = [
    new File([PHOTO_PNG], "bay-left.png", { type: "text/plain" }),
    new File([PHOTO_PNG], "bay-left-copy.jpg", { type: "image/jpeg" }),
  ];
  const first = await updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "inspection-report-demo-01",
    expectedRevision: before.revision,
    mutationId: "ir-photos-upload-duplicate",
    deleteIds: [],
    files,
  }, frontdeskActor, store, repository);

  expect(first.photos.slice(-2).map((photo) => photo.originalName)).toEqual(["bay-left.png", "bay-left-copy.jpg"]);
  expect(first.photos).toHaveLength(2);
  expect(new Set(first.photos.slice(-2).map((photo) => photo.id)).size).toBe(2);
  expect(new Set(first.photos.slice(-2).map((photo) => photo.sha256)).size).toBe(1);
  expect(first.auditEventIds).toHaveLength(2);
  expect((await repository.list()).map((photo) => photo.id)).toEqual(first.photos.slice(-2).map((photo) => photo.id));
  expect(quotaCalls).toBe(1);
  const serialized = storage.getItem(LINKED_OPERATIONS_STORAGE_KEY)!;
  expect(serialized).not.toContain("data:image");
  expect(serialized).not.toContain(Buffer.from(PHOTO_PNG).toString("base64"));

  const replay = await updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "inspection-report-demo-01",
    expectedRevision: before.revision,
    mutationId: "ir-photos-upload-duplicate",
    deleteIds: [],
    files,
  }, frontdeskActor, store, repository);
  expect(replay.photos).toEqual(first.photos);
  expect(replay.revision).toBe(first.revision);
  expect(replay).toEqual(first);
  expect(quotaCalls).toBe(1);
  expect(await repository.list()).toHaveLength(2);

  const after = store.read((state) => ({
    report: state.inspectionReports.find((report) => report.id === "inspection-report-demo-01"),
    quotation: state.currentQuotations.find((quotation) => quotation.inspectionReportId === "inspection-report-demo-01"),
    communications: state.communicationEvents,
    generationEvents: state.generationEvents,
    audits: state.reportAttachmentAuditEvents,
    receipts: state.mutationReceipts.filter((receipt) => receipt.mutationId === "ir-photos-upload-duplicate"),
  }));
  expect({ ...after.report, photoIds: before.report!.photoIds }).toEqual(before.report);
  expect(after.quotation).toEqual(before.quotation);
  expect(after.communications).toEqual(before.communications);
  expect(after.generationEvents).toEqual(before.generationEvents);
  expect(after.audits.slice(-2).map((event) => event.action)).toEqual(["uploaded", "uploaded"]);
  expect(new Set(after.audits.slice(-2).map((event) => event.recordedAt)).size).toBe(1);
  expect(after.audits.slice(-2).every((event) => event.actorId === frontdeskActor.id)).toBe(true);
  expect(after.receipts).toHaveLength(1);

  const report = store.read((state) => state.inspectionReports.find((candidate) => candidate.id === "inspection-report-demo-01")!);
  const vehicleArchive = getMockVehicleInspectionReportPhotos(report.vehicleId, store);
  const group = vehicleArchive.find((candidate) => candidate.reportId === report.id);
  expect(group).toMatchObject({
    reportId: report.id,
    reportNo: report.inspectionReportNo,
    submittedAt: report.submittedAt,
  });
  expect(group?.photos.map((photo) => photo.id)).toEqual(first.photos.map((photo) => photo.id));
});

test("photo response loss replays the same revision photos and auditEventIds without Blob or audit duplication", async () => {
  const restore = installBrowser(frontdesk, {
    failNext: { byAction: { "inspection.photos.write.response": "response lost after photo commit" } },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const repository = createMemoryReportPhotoRepository();
    const revision = store.read((state) => state.revision);
    const input = {
      reportId: "inspection-report-demo-01",
      expectedRevision: revision,
      mutationId: "photo-response-loss",
      deleteIds: [],
      files: [new File([PHOTO_PNG], "response-loss.png", { type: "image/png" })],
    };
    await expect(updateMockInspectionReportPhotos(input.reportId, input, frontdeskActor, store, repository))
      .rejects.toMatchObject({ status: 503 });
    const committed = store.read((state) => ({
      revision: state.revision,
      audits: structuredClone(state.reportAttachmentAuditEvents),
      receipt: structuredClone(state.mutationReceipts.find((receipt) => receipt.mutationId === input.mutationId)),
    }));
    const replay = await updateMockInspectionReportPhotos(input.reportId, input, frontdeskActor, store, repository);
    expect(replay).toEqual(committed.receipt!.result);
    expect(replay.auditEventIds).toEqual(committed.audits.map((audit) => audit.id));
    expect(store.read((state) => state.revision)).toBe(committed.revision);
    expect(store.read((state) => state.reportAttachmentAuditEvents)).toEqual(committed.audits);
    expect(await repository.list()).toHaveLength(1);
  } finally {
    restore();
  }
});

test("authenticated photo resolvers recheck active report and vehicle ownership and fail closed on missing or corrupt bytes", async () => {
  const anonymousRestore = installBrowser();
  try {
    await expect(api.inspectionReports.photoBlob("inspection-report-demo-03", "any-photo"))
      .rejects.toMatchObject({ status: 403 });
    await expect(api.vehicles.inspectionReportPhotoBlob("any-vehicle", "inspection-report-demo-03", "any-photo"))
      .rejects.toMatchObject({ status: 403 });
  } finally {
    anonymousRestore();
  }
  const store = createMockLinkedOperationsStore(memoryStorage());
  const backend = new Map<string, ReportPhotoBlobRecord>();
  const repository = createMemoryReportPhotoRepository({ backend });
  const revision = store.read((state) => state.revision);
  const uploaded = await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: revision,
    mutationId: "photo-resolver-scope",
    deleteIds: [],
    files: [new File([PHOTO_PNG], "resolver.png", { type: "image/png" })],
  }, frontdeskActor, store, repository);
  const photo = uploaded.photos.at(-1)!;

  const reportBlob = await resolveMockInspectionReportPhotoBlob(photo.reportId, photo.id, store, repository);
  const vehicleBlob = await resolveMockVehicleInspectionReportPhotoBlob(photo.vehicleId, photo.reportId, photo.id, store, repository);
  expect(new Uint8Array(await reportBlob.arrayBuffer())).toEqual(PHOTO_PNG);
  expect(new Uint8Array(await vehicleBlob.arrayBuffer())).toEqual(PHOTO_PNG);
  await expect(resolveMockInspectionReportPhotoBlob("inspection-report-demo-02", photo.id, store, repository))
    .rejects.toMatchObject({ status: 404 });
  await expect(resolveMockVehicleInspectionReportPhotoBlob("not-the-owner", photo.reportId, photo.id, store, repository))
    .rejects.toMatchObject({ status: 404 });

  const raceStore = createMockLinkedOperationsStore(memoryStorage());
  const raceRepository = createMemoryReportPhotoRepository();
  const raceUploaded = await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: raceStore.read((state) => state.revision),
    mutationId: "photo-resolver-delete-race-upload",
    deleteIds: [],
    files: [new File([PHOTO_PNG], "resolver-race.png", { type: "image/png" })],
  }, frontdeskActor, raceStore, raceRepository);
  const racePhoto = raceUploaded.photos.at(-1)!;
  let releaseRead!: () => void;
  let markReadStarted!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  const gatedRepository: ReportPhotoRepository = {
    ...raceRepository,
    read: async (id) => {
      const record = await raceRepository.read(id);
      markReadStarted();
      await readGate;
      return record;
    },
  };
  const staleResolver = resolveMockInspectionReportPhotoBlob(
    racePhoto.reportId,
    racePhoto.id,
    raceStore,
    gatedRepository,
);

  await readStarted;
  await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: raceUploaded.revision,
    mutationId: "photo-resolver-delete-race-remove",
    deleteIds: [racePhoto.id],
    files: [],
  }, frontdeskActor, raceStore, raceRepository);
  releaseRead();
  await expect(staleResolver).rejects.toMatchObject({ status: 404 });

  await repository.deleteMany([photo.id]);
  await expect(resolveMockInspectionReportPhotoBlob(photo.reportId, photo.id, store, repository))
    .rejects.toMatchObject({ status: 503 });
  await repository.writeBatch([{
    ...(backend.get(photo.id) ?? {
      id: photo.id,
      reportId: photo.reportId,
      vehicleId: photo.vehicleId,
      originalName: photo.originalName!,
      detectedMediaType: photo.detectedMediaType!,
      widthPx: photo.widthPx!,
      heightPx: photo.heightPx!,
      byteLength: photo.byteLength!,
      sha256: photo.sha256!,
    }),
    blob: new Blob([PHOTO_PNG], { type: "image/png" }),
  } as ReportPhotoBlobRecord]);
  backend.set(photo.id, { ...backend.get(photo.id)!, blob: new Blob([new Uint8Array(PHOTO_PNG.length)], { type: "image/png" }) });
  await expect(resolveMockInspectionReportPhotoBlob(photo.reportId, photo.id, store, repository))
    .rejects.toMatchObject({ status: 503 });
});

test("workbench IR reminders move only on canonical notification and response events", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryIrGeneratedFileRepository();
  const counts = () => store.read((state) => computeWorkbenchReminders(
    state.quickOrders,
    state.inspectionReports,
    state.vehicles,
    state.parkingCases,
    null,
    state,
  ).ir);
  expect(counts()).toEqual({ notNotified: 3, awaitingReply: 0 });
  const generated = await generateMockInspectionReportFiles({
    reportId: "inspection-report-demo-01",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "task7-workbench-generate",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  expect(counts()).toEqual({ notNotified: 3, awaitingReply: 0 });
  await store.mutate((state) => {
    const index = state.inspectionReports.findIndex((report) => report.id === "inspection-report-demo-02");
    state.inspectionReports[index] = { ...state.inspectionReports[index], status: "approved" };
    state.revision += 1;
  });
  expect(counts()).toEqual({ notNotified: 3, awaitingReply: 0 });
  const sent = await sendMockInspectionReportNotification({
    reportId: "inspection-report-demo-01",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "task7-workbench-notification",
    channel: "sms",
    language: "zh",
    message: "工作台事件驱动通知",
  }, frontdeskActor, store, repository);
  expect(counts()).toEqual({ notNotified: 2, awaitingReply: 1 });
  await recordMockInspectionCustomerResponse({
    reportId: "inspection-report-demo-01",
    expectedRevision: sent.revision,
    mutationId: "task7-workbench-response",
    result: "interested",
    note: "工作台闭环",
  }, frontdeskActor, store);
  expect(counts()).toEqual({ notNotified: 2, awaitingReply: 0 });
  expect(generated.bundle.generation).toBe(1);
});

test("Task6 routes bind invocation identity and recheck it before publishing asynchronously resolved Blob bytes", async () => {
  const anonymousRestore = installBrowser();
  try {
    const startedAnonymous = api.inspectionReports.detail("inspection-report-demo-03");
    window.localStorage.setItem("wh_session", JSON.stringify(frontdesk));
    await expect(startedAnonymous).rejects.toMatchObject({ status: 403 });
  } finally {
    anonymousRestore();
  }

  const partsRestore = installBrowser(parts);
  try {
    const startedParts = api.vehicles.inspectionReportPhotos("vehicle-001");
    window.localStorage.setItem("wh_session", JSON.stringify(superadmin));
    await expect(startedParts).rejects.toMatchObject({ status: 403 });
  } finally {
    partsRestore();
  }

  const authorizedRestore = installBrowser(frontdesk);
  const repository = getReportPhotoRepository();
  const store = getMockLinkedOperationsStore();
  const uploaded = await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: store.read((state) => state.revision),
    mutationId: `photo-api-session-race-${Date.now()}`,
    deleteIds: [],
    files: [new File([PHOTO_PNG], "session-race.png", { type: "image/png" })],
  }, frontdeskActor, store, repository);
  const photo = uploaded.photos.at(-1)!;
  const originalRead = repository.read.bind(repository);
  let releaseRead!: () => void;
  let markReadStarted!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
  repository.read = async (id) => {
    const record = await originalRead(id);
    markReadStarted();
    await readGate;
    return record;
  };
  try {
    const blobRequest = api.inspectionReports.photoBlob(photo.reportId, photo.id);
    await readStarted;
    window.localStorage.removeItem("wh_session");
    releaseRead();
    await expect(blobRequest).rejects.toMatchObject({ status: 403 });
  } finally {
    repository.read = originalRead;
    releaseRead?.();
    authorizedRestore();
  }
});

test("照片写入 stale、closed input、权限和 mutation drift 都在 Blob/canonical 前失败", async () => {
  const storage = memoryStorage();
  const store = createMockLinkedOperationsStore(storage);
  const repository = createMemoryReportPhotoRepository();
  const revision = store.read((state) => state.revision);
  const file = new File([PHOTO_PNG], "closed.png", { type: "image/png" });
  const snapshot = () => ({
    state: store.read((state) => state),
    blobs: repository.list(),
  });
  const before = snapshot();

  await expect(updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "inspection-report-demo-01", expectedRevision: revision + 1,
    mutationId: "photo-stale", deleteIds: [], files: [file],
  }, frontdeskActor, store, repository)).rejects.toMatchObject({ status: 409 });
  await expect(updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "different-report", expectedRevision: revision,
    mutationId: "photo-path-drift", deleteIds: [], files: [file],
  }, frontdeskActor, store, repository)).rejects.toMatchObject({ status: 400 });
  await expect(updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "inspection-report-demo-01", expectedRevision: revision,
    mutationId: "photo-spoof", deleteIds: [], files: [file], actorId: "spoof",
  } as never, frontdeskActor, store, repository)).rejects.toMatchObject({ status: 400 });
  await expect(updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "inspection-report-demo-01", expectedRevision: revision,
    mutationId: "photo-finance", deleteIds: [], files: [file],
  }, { id: "emp-002", name: "财务", role: "finance" } as never, store, repository)).rejects.toMatchObject({ status: 403 });
  expect(store.read((state) => state)).toEqual(before.state);
  expect(await before.blobs).toEqual(await repository.list());

  const committed = await updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "inspection-report-demo-01", expectedRevision: revision,
    mutationId: "photo-drift", deleteIds: [], files: [file],
  }, frontdeskActor, store, repository);
  await expect(updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "inspection-report-demo-01", expectedRevision: revision,
    mutationId: "photo-drift", deleteIds: [],
    files: [new File([PHOTO_PNG], "changed-name.png", { type: "image/png" })],
  }, frontdeskActor, store, repository)).rejects.toMatchObject({ status: 409 });
  expect(store.read((state) => state.revision)).toBe(committed.revision);
  expect(await repository.list()).toHaveLength(1);
});

test("删除照片先提交 canonical/audit，再清理 Blob；cleanup 失败不恢复 active reference", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryReportPhotoRepository();
  const revision = store.read((state) => state.revision);
  const uploaded = await updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "inspection-report-demo-01", expectedRevision: revision,
    mutationId: "photo-for-delete", deleteIds: [],
    files: [new File([PHOTO_PNG], "delete-me.png", { type: "image/png" })],
  }, frontdeskActor, store, repository);
  const target = uploaded.photos.at(-1)!;
  repository.failNextDelete(new Error("cleanup unavailable"));
  const deleted = await updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "inspection-report-demo-01", expectedRevision: uploaded.revision,
    mutationId: "photo-delete", deleteIds: [target.id], files: [],
  }, frontdeskActor, store, repository);

  expect(deleted.photos.some((photo) => photo.id === target.id)).toBe(false);
  expect(await repository.read(target.id)).not.toBeNull();
  const state = store.read((current) => current);
  expect(state.reportAttachments.find((attachment) => attachment.id === target.id)).toMatchObject({
    lifecycle: "deleted", activeSequence: null,
  });
  expect(state.reportAttachmentAuditEvents.at(-1)).toMatchObject({ attachmentId: target.id, action: "deleted" });

  const canonicalAfterCleanupFailure = structuredClone(state);
  const replay = await updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "inspection-report-demo-01", expectedRevision: uploaded.revision,
    mutationId: "photo-delete", deleteIds: [target.id], files: [],
  }, frontdeskActor, store, repository);
  expect(replay).toEqual(deleted);
  expect(await repository.read(target.id)).toBeNull();
  expect(store.read((current) => current)).toEqual(canonicalAfterCleanupFailure);

  const beforeInvalid = structuredClone(state);
  await expect(updateMockInspectionReportPhotos("inspection-report-demo-01", {
    reportId: "inspection-report-demo-01", expectedRevision: deleted.revision,
    mutationId: "photo-delete-unknown", deleteIds: ["unknown-photo"], files: [],
  }, frontdeskActor, store, repository)).rejects.toMatchObject({ status: 400 });
  expect(store.read((current) => current)).toEqual(beforeInvalid);
});

test("real photo metadata and payload stay outside all three customer PDFs and photo writes never touch the generated-file repository", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const photoRepository = createMemoryReportPhotoRepository();
  const generatedBackend = new Map<string, IrGeneratedFileRecord>();
  const generatedRepository = createMemoryIrGeneratedFileRepository({ backend: generatedBackend });
  const uploaded = await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "pdf-photo-exclusion-upload",
    deleteIds: [],
    files: [new File([PHOTO_PNG], "PHOTO-NAME-SENTINEL.png", { type: "image/png" })],
  }, frontdeskActor, store, photoRepository);
  const photo = uploaded.photos[0];
  const sourceSnapshots: string[] = [];
  const generated = await generateMockInspectionReportFiles({
    reportId: "inspection-report-demo-03",
    expectedRevision: uploaded.revision,
    mutationId: "pdf-photo-exclusion-generate",
  }, frontdeskActor, store, generatedRepository, async (source, language) => {
    const sourceSnapshot = JSON.stringify(source);
    sourceSnapshots.push(sourceSnapshot);
    return {
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new TextEncoder().encode(`${language}:${sourceSnapshot}`)]),
      fileName: `${language}.pdf`,
    };
  });
  const forbidden = [photo.id, photo.originalName!, photo.sha256!, "PHOTO-NAME-SENTINEL"];
  expect(sourceSnapshots).toHaveLength(3);
  for (const source of sourceSnapshots) for (const sentinel of forbidden) expect(source).not.toContain(sentinel);
  for (const record of generatedBackend.values()) {
    const bytes = new TextDecoder().decode(record.bytes);
    for (const sentinel of forbidden) expect(bytes).not.toContain(sentinel);
  }
  const generatedSnapshot = structuredClone([...generatedBackend.entries()]);
  const quotationBeforeSecondPhoto = store.read((state) => structuredClone(
    state.currentQuotations.find((quotation) => quotation.inspectionReportId === "inspection-report-demo-03")!,
  ));
  await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: generated.revision,
    mutationId: "pdf-photo-exclusion-second-upload",
    deleteIds: [],
    files: [new File([PHOTO_PNG], "second-photo.png", { type: "image/png" })],
  }, frontdeskActor, store, photoRepository);
  const quotationAfterSecondPhoto = store.read((state) => (
    state.currentQuotations.find((quotation) => quotation.inspectionReportId === "inspection-report-demo-03")!
  ));
  expect(quotationAfterSecondPhoto).toEqual(quotationBeforeSecondPhoto);
  expect(quotationAfterSecondPhoto.activeGeneratedBundle?.id).toBe(generated.bundle.id);
  expect([...generatedBackend.entries()]).toEqual(generatedSnapshot);
});

test("current Quotation accepts three closed charge groups and arbitrary manual per-unit discounts", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const before = await api.inspectionReports.detail("inspection-report-demo-01");
    await api.inspectionReports.updateQuotation({
      reportId: before.id,
      expectedRevision: before.revision,
      mutationId: "qt-three-groups",
      noteZh: "客户已知拆解后可能另行报价。",
      noteEn: "Further costs may be quoted after teardown.",
      lines: [
        unitLine({ category: "labor", descZh: "拆解发动机", quantity: 2, unitPriceJmd: 25_000, unitDiscountJmd: 1_251 }),
        unitLine({ category: "parts", descZh: "发动机修理包", unitPriceJmd: 0, pendingQuote: true }),
        fixedLine({ descZh: "拖车费", code: "towing", amountJmd: 7_500 }),
      ],
    });

    const after = await api.inspectionReports.detail(before.id);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.quotation).toMatchObject({
      noteZh: "客户已知拆解后可能另行报价。",
      noteEn: "Further costs may be quoted after teardown.",
    });
    expect(after.quotation.lines).toEqual([
      expect.objectContaining({ pricingMode: "unit", category: "labor", unitDiscountJmd: 1_251 }),
      expect.objectContaining({ pricingMode: "unit", category: "parts", pendingQuote: true, unitPriceJmd: 0 }),
      expect.objectContaining({ pricingMode: "fixed_total", category: "other_service", code: "towing", amountJmd: 7_500 }),
    ]);
    expect(after.quotation.lines[2]).not.toHaveProperty("quantity");
    expect(after.quotation.lines[2]).not.toHaveProperty("unitDiscountJmd");
  } finally {
    restore();
  }
});

test("direct Quotation update rejects pending labor without changing canonical state or receipts", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const before = store.read((state) => state);
  const report = before.inspectionReports[0];
  const quotation = before.currentQuotations.find((item) => item.id === report.quotationId)!;
  const currentLines = quotation.lineIds.map((lineId) => before.quotedChargeLines.find((line) => line.id === lineId)!);
  const pendingLaborLines = currentLines.map((line) => {
    const editable = editableLine(line);
    return editable.pricingMode === "unit" && editable.category === "labor"
      ? { ...editable, unitPriceJmd: 0, unitDiscountJmd: 0, pendingQuote: true }
      : editable;
  });

  await expect(updateMockQuotation({
    reportId: report.id,
    expectedRevision: before.revision,
    mutationId: "reject-pending-labor",
    noteZh: quotation.noteZh,
    noteEn: quotation.noteEn,
    lines: pendingLaborLines,
  }, frontdeskActor, store)).rejects.toMatchObject({ status: 400 });
  expect(store.read((state) => state)).toEqual(before);
  expect(store.read((state) => state.mutationReceipts)).toEqual(before.mutationReceipts);
});

test("Quotation preserves existing IDs through reorder/edit and never reuses a deleted new-row ID", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const before = await api.inspectionReports.detail("inspection-report-demo-01");
    const original = before.quotation.lines;
    const sourceById = new Map(original.map((line) => [line.id, line.sourceId]));
    const first = await api.inspectionReports.updateQuotation({
      reportId: before.id,
      expectedRevision: before.revision,
      mutationId: "qt-id-cycle-a",
      noteZh: before.quotation.noteZh,
      noteEn: before.quotation.noteEn,
      lines: [
        ...original.toReversed().map((line) => {
          const editable = editableLine(line);
          return editable.pricingMode === "unit" && !editable.pendingQuote
            ? { ...editable, unitPriceJmd: editable.unitPriceJmd + 101 }
            : editable;
        }),
        fixedLine({ descZh: "外派服务", code: "offsite_service", amountJmd: 6_000 }),
      ],
    });
    const reordered = await api.inspectionReports.detail(before.id);
    expect(reordered.quotation.lines.slice(0, original.length).map((line) => line.id))
      .toEqual(original.toReversed().map((line) => line.id));
    for (const line of reordered.quotation.lines.slice(0, original.length)) {
      expect(line.sourceId).toBe(sourceById.get(line.id));
    }
    const firstNewId = first.lineIds.at(-1)!;

    await api.inspectionReports.updateQuotation({
      reportId: before.id,
      expectedRevision: reordered.revision,
      mutationId: "qt-id-cycle-delete",
      noteZh: reordered.quotation.noteZh,
      noteEn: reordered.quotation.noteEn,
      lines: reordered.quotation.lines.filter((line) => line.id !== firstNewId).map(editableLine),
    });
    const deleted = await api.inspectionReports.detail(before.id);
    const recreated = await api.inspectionReports.updateQuotation({
      reportId: before.id,
      expectedRevision: deleted.revision,
      mutationId: "qt-id-cycle-b",
      noteZh: deleted.quotation.noteZh,
      noteEn: deleted.quotation.noteEn,
      lines: [...deleted.quotation.lines.map(editableLine), fixedLine({ descZh: "外派服务", code: "offsite_service", amountJmd: 6_000 })],
    });
    expect(recreated.lineIds.at(-1)).not.toBe(firstNewId);
  } finally {
    restore();
  }
});

test("Quotation rejects forbidden fixed-total/unit fields and stale revisions without partial writes", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const stateBefore = store.read((state) => structuredClone(state));
  const report = stateBefore.inspectionReports.find((candidate) => candidate.id === "inspection-report-demo-01")!;
  const quotation = stateBefore.currentQuotations.find((candidate) => candidate.id === report.quotationId)!;
  const before = {
    id: report.id,
    revision: stateBefore.revision,
    quotation: {
      noteZh: quotation.noteZh,
      noteEn: quotation.noteEn,
      lines: quotation.lineIds.map((id) => stateBefore.quotedChargeLines.find((line) => line.id === id)!),
    },
  };
    const forbiddenFixedFields = [
      { quantity: 0 },
      { pendingQuote: false },
      { unitDiscountJmd: 0 },
      { unitPriceJmd: 0 },
      { unit: "" },
    ];
    for (const [index, forbidden] of forbiddenFixedFields.entries()) {
      await expect(updateMockQuotation({
        reportId: before.id,
        expectedRevision: before.revision,
        mutationId: `qt-invalid-fixed-${index}`,
        noteZh: "不应保存",
        noteEn: before.quotation.noteEn,
        lines: [{ ...fixedLine({ descZh: "拖车费", code: "towing", amountJmd: 7_500 }), ...forbidden }],
      } as never, frontdeskActor, store)).rejects.toMatchObject({ status: 400 });
    }
    for (const [index, id] of [123, "", "   "].entries()) {
      await expect(updateMockQuotation({
        reportId: before.id,
        expectedRevision: before.revision,
        mutationId: `qt-invalid-id-${index}`,
        noteZh: before.quotation.noteZh,
        noteEn: before.quotation.noteEn,
        lines: [{ ...unitLine({ category: "labor", descZh: "工时", unitPriceJmd: 1_000 }), id }],
      } as never, frontdeskActor, store)).rejects.toMatchObject({ status: 400 });
    }
    await expect(updateMockQuotation({
      reportId: before.id,
      expectedRevision: before.revision + 1,
      mutationId: "qt-stale",
      noteZh: "陈旧页面",
      noteEn: before.quotation.noteEn,
      lines: before.quotation.lines.map(editableLine),
    }, frontdeskActor, store)).rejects.toMatchObject({ status: 409 });
    expect(store.read((state) => state)).toEqual(stateBefore);
});

test("20% labor and 12.5% parts equality do not sign; strict exceed consumes one raw-stroke signature", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const before = await api.inspectionReports.detail("inspection-report-demo-01");
    const equalityLines = [
      unitLine({ category: "labor", descZh: "工时", unitPriceJmd: 10_000, unitDiscountJmd: 2_000 }),
      unitLine({ category: "parts", descZh: "配件", unitPriceJmd: 8_000, unitDiscountJmd: 1_000 }),
    ];
    await api.inspectionReports.updateQuotation({
      reportId: before.id,
      expectedRevision: before.revision,
      mutationId: "qt-threshold-equality",
      noteZh: before.quotation.noteZh,
      noteEn: before.quotation.noteEn,
      lines: equalityLines,
    });
    const equality = await api.inspectionReports.detail(before.id);
    expect(getMockLinkedOperationsStore().read((state) => state.discountSignatureEvents)).toHaveLength(0);

    const exceededLines = [
      { ...editableLine(equality.quotation.lines[0]), unitDiscountJmd: 2_001 },
      { ...editableLine(equality.quotation.lines[1]), unitDiscountJmd: 1_001 },
    ];
    const exceededInput = {
      reportId: before.id,
      expectedRevision: equality.revision,
      mutationId: "qt-threshold-exceed",
      noteZh: equality.quotation.noteZh,
      noteEn: equality.quotation.noteEn,
      lines: exceededLines,
    };
    await expect(api.inspectionReports.updateQuotation(exceededInput)).rejects.toMatchObject({ status: 400 });
    const signed = await api.inspectionReports.updateQuotation({
      ...exceededInput,
      signature: { rawStrokes: RAW_STROKES },
    });
    const events = getMockLinkedOperationsStore().read((state) => state.discountSignatureEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      document: { kind: "quotation", id: before.quotation.id },
      operationAccount: { id: "emp-003", name: "前台" },
      rawStrokes: RAW_STROKES,
      mutationId: "qt-threshold-exceed",
      categoryRatios: {
        labor: { exceedsThreshold: true },
        parts: { exceedsThreshold: true },
      },
    });
    expect(signed.signatureEventId).toBe(events[0].mutationId);

    const high = await api.inspectionReports.detail(before.id);
    await api.inspectionReports.updateQuotation({
      reportId: before.id,
      expectedRevision: high.revision,
      mutationId: "qt-high-notes-fixed-only",
      noteZh: "只改备注和一口价",
      noteEn: high.quotation.noteEn,
      lines: [...high.quotation.lines.map(editableLine), fixedLine({ descZh: "拖车费", code: "towing", amountJmd: 5_000 })],
    });
    expect(getMockLinkedOperationsStore().read((state) => state.discountSignatureEvents)).toHaveLength(1);
  } finally {
    restore();
  }
});

test("no-op or below-threshold Quotation rejects supplied strokes before receipt creation so the same intent can retry without them", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const before = store.read((state) => structuredClone(state));
  const report = before.inspectionReports[0];
  const quotation = before.currentQuotations.find((item) => item.id === report.quotationId)!;
  const input = {
    reportId: report.id,
    expectedRevision: before.revision,
    mutationId: "qt-unused-strokes",
    noteZh: quotation.noteZh,
    noteEn: quotation.noteEn,
    lines: quotation.lineIds.map((id) => editableLine(before.quotedChargeLines.find((line) => line.id === id)!)),
  };

  await expect(updateMockQuotation({ ...input, signature: { rawStrokes: RAW_STROKES } }, frontdeskActor, store))
    .rejects.toMatchObject({ status: 400 });
  expect(store.read((state) => state)).toEqual(before);

  const retried = await updateMockQuotation(input, frontdeskActor, store);
  expect(retried.signatureEventId).toBeNull();
  expect(retried.contentChanged).toBe(false);
  expect(store.read((state) => state.discountSignatureEvents)).toHaveLength(0);
  expect(store.read((state) => state.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId))).toHaveLength(1);
  expect(JSON.stringify(store.read((state) => state.mutationReceipts))).not.toContain("rawStrokes");
});

test("successful Quotation mutation replays once; changed payload with the same mutationId is 409", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const before = await api.inspectionReports.detail("inspection-report-demo-01");
    const input = {
      reportId: before.id,
      expectedRevision: before.revision,
      mutationId: "qt-replay-once",
      noteZh: "幂等保存",
      noteEn: before.quotation.noteEn,
      lines: [unitLine({ category: "labor", descZh: "工时", unitPriceJmd: 10_000, unitDiscountJmd: 2_001 })],
      signature: { rawStrokes: RAW_STROKES },
    };
    const first = await api.inspectionReports.updateQuotation(input);
    const replay = await api.inspectionReports.updateQuotation(input);
    expect(replay).toEqual(first);
    expect(getMockLinkedOperationsStore().read((state) => state.discountSignatureEvents)).toHaveLength(1);
    await expect(api.inspectionReports.updateQuotation({ ...input, noteZh: "不同载荷" }))
      .rejects.toMatchObject({ status: 409 });
    expect((await api.inspectionReports.detail(before.id)).quotation.noteZh).toBe("幂等保存");
  } finally {
    restore();
  }
});

test("one raw-strokes signature digest can be consumed by only one successful mutation", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const before = await api.inspectionReports.detail("inspection-report-demo-01");
    await api.inspectionReports.updateQuotation({
      reportId: before.id,
      expectedRevision: before.revision,
      mutationId: "qt-stroke-first",
      noteZh: before.quotation.noteZh,
      noteEn: before.quotation.noteEn,
      lines: [unitLine({ category: "labor", descZh: "工时", unitPriceJmd: 10_000, unitDiscountJmd: 2_001 })],
      signature: { rawStrokes: RAW_STROKES },
    });
    const signed = await api.inspectionReports.detail(before.id);
    await expect(api.inspectionReports.updateQuotation({
      reportId: before.id,
      expectedRevision: signed.revision,
      mutationId: "qt-stroke-reused",
      noteZh: signed.quotation.noteZh,
      noteEn: signed.quotation.noteEn,
      lines: [unitLine({
        id: signed.quotation.lines[0].id,
        category: "labor",
        descZh: "工时",
        unitPriceJmd: 10_001,
        unitDiscountJmd: 2_002,
      })],
      signature: { rawStrokes: RAW_STROKES },
    })).rejects.toMatchObject({ status: 409 });
    const after = await api.inspectionReports.detail(before.id);
    expect(after.revision).toBe(signed.revision);
    expect(after.quotation.lines[0]).toMatchObject({ unitPriceJmd: 10_000, unitDiscountJmd: 2_001 });
    expect(getMockLinkedOperationsStore().read((state) => state.discountSignatureEvents)).toHaveLength(1);
  } finally {
    restore();
  }
});

test("new Quotation IDs remain non-reusable after canonical reload and deletion", async () => {
  const storage = memoryStorage();
  const firstStore = createMockLinkedOperationsStore(storage);
  const before = firstStore.read((state) => state);
  const report = before.inspectionReports[0];
  const quotation = before.currentQuotations.find((item) => item.id === report.quotationId)!;
  const first = await updateMockQuotation({
    reportId: report.id,
    expectedRevision: before.revision,
    mutationId: "qt-reload-new-a",
    noteZh: quotation.noteZh,
    noteEn: quotation.noteEn,
    lines: [fixedLine({ descZh: "拖车费", code: "towing", amountJmd: 7_500 })],
  }, frontdeskActor, firstStore);
  const firstId = first.lineIds[0];

  const reloadedStore = createMockLinkedOperationsStore(storage);
  await reloadedStore.ready();
  await updateMockQuotation({
    reportId: report.id,
    expectedRevision: first.revision,
    mutationId: "qt-reload-delete",
    noteZh: quotation.noteZh,
    noteEn: quotation.noteEn,
    lines: [],
  }, frontdeskActor, reloadedStore);
  const recreated = await updateMockQuotation({
    reportId: report.id,
    expectedRevision: first.revision + 1,
    mutationId: "qt-reload-new-b",
    noteZh: quotation.noteZh,
    noteEn: quotation.noteEn,
    lines: [fixedLine({ descZh: "拖车费", code: "towing", amountJmd: 7_500 })],
  }, frontdeskActor, reloadedStore);
  expect(recreated.lineIds[0]).not.toBe(firstId);
});

test("generated counters and immutable legacy quotation archives never block current edits", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.mutate((state) => {
    const current = state.currentQuotations[0];
    state.currentQuotations[0] = {
      ...current,
      generationCounter: 9,
      lastGeneratedAt: "2026-08-20T10:00:00-05:00",
      generatedFromRevision: state.revision,
    };
  });
  const before = store.read((state) => ({
    revision: state.revision,
    report: structuredClone(state.inspectionReports[0]),
    current: structuredClone(state.currentQuotations[0]),
    legacyQuotations: structuredClone(state.quotations),
    legacyItems: structuredClone(state.quotationItems),
    lines: state.currentQuotations[0].lineIds.map((id) => structuredClone(state.quotedChargeLines.find((line) => line.id === id)!)),
  }));
  await updateMockQuotation({
    reportId: before.report.id,
    expectedRevision: before.revision,
    mutationId: "qt-after-generation",
    noteZh: "生成后仍可继续编辑",
    noteEn: before.current.noteEn,
    lines: before.lines.map(editableLine),
  }, frontdeskActor, store);
  const after = store.read((state) => state);
  expect(after.currentQuotations[0]).toMatchObject({ generationCounter: 9, noteZh: "生成后仍可继续编辑" });
  expect(after.quotations).toEqual(before.legacyQuotations);
  expect(after.quotationItems).toEqual(before.legacyItems);
});

test("前台代录草稿拒绝陈旧 revision，失败时原文、检查项和报价均不半写", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const before = store.read((state) => structuredClone(state));
  const report = before.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!;
  const quotation = before.currentQuotations.find((item) => item.id === report.quotationId)!;
  const quotationLines = quotation.lineIds.map((id) => editableLine(before.quotedChargeLines.find((item) => item.id === id)!));

  await expect(updateMockInspectionReportDraft(report.id, {
    expectedRevision: before.revision - 1,
    mutationId: "ir-draft-stale",
    rawText: "陈旧页面试图覆盖",
    aiDraft: "陈旧 AI 草稿",
    items: [{ findingZh: "陈旧发现", recommendationZh: "陈旧建议" }],
    quotationLines,
  }, frontdeskActor, store)).rejects.toMatchObject({ status: 409 });

  expect(store.read((state) => state)).toEqual(before);
});

test("IR parser carries only explicit labor/parts prices, keeps unpriced parts pending, and requires explicit fixed totals", () => {
  const parsed = parseInspectionNaturalLanguage([
    "检查发动机异响，诊断工时 15,000",
    "原厂刹车片 2套 配件 12,000",
    "拖车费 7,500",
    "外派服务费用待确认",
  ].join("\n"));
  const lines = quotationLinesFromParsed(parsed.items) as ReadonlyArray<Omit<QuotedChargeLine, "id">>;

  expect(lines).toEqual([
    expect.objectContaining({ category: "labor", pricingMode: "unit", unitPriceJmd: 15_000, pendingQuote: false }),
    expect.objectContaining({ category: "parts", pricingMode: "unit", quantity: 2, unitPriceJmd: 12_000, pendingQuote: false }),
    expect.objectContaining({ category: "other_service", pricingMode: "fixed_total", code: "towing", amountJmd: 7_500 }),
  ]);
  expect(lines).toHaveLength(3);

  const pending = quotationLinesFromParsed(parseInspectionNaturalLanguage("需要更换水泵配件，数量2").items);
  expect(pending).toEqual([
    expect.objectContaining({ category: "parts", pricingMode: "unit", quantity: 2, unitPriceJmd: 0, unitDiscountJmd: 0, pendingQuote: true }),
  ]);

  expect(parseInspectionNaturalLanguage("拖车费 7.5").items).toEqual([]);
  expect(quotationLinesFromParsed(parseInspectionNaturalLanguage("4个刹车片 配件 12000").items)).toEqual([
    expect.objectContaining({ category: "parts", pricingMode: "unit", quantity: 4, unitPriceJmd: 12_000 }),
  ]);
});

test("AI draft merge preserves manual fields and stable IDs while appending new explicit charge facts", () => {
  const current: QuotedChargeLine[] = [
    { ...unitLine({ id: "manual-labor", category: "labor", descZh: "拆解发动机", unitPriceJmd: 200_000, unitDiscountJmd: 1_250 }), descEn: "Manual engine teardown" } as QuotedChargeLine,
    fixedLine({ id: "manual-towing", descZh: "人工拖车费", code: "towing", amountJmd: 7_500 }) as QuotedChargeLine,
  ];
  const parsed = parseInspectionNaturalLanguage("二次诊断工时 2工时 15000\n外派服务 6000");
  const merged = mergeQuotationLinesFromParsed(current, parsed.items);

  expect(merged.slice(0, 2)).toEqual(current.map(editableLine));
  expect(merged).toEqual(expect.arrayContaining([
    expect.objectContaining({ pricingMode: "unit", category: "labor", quantity: 2, unitPriceJmd: 15_000 }),
    expect.objectContaining({ pricingMode: "fixed_total", category: "other_service", code: "offsite_service", amountJmd: 6_000 }),
  ]));
  expect(merged).toHaveLength(4);
});

test("AI draft merge fills only blank translation and pending price on an exact stable-ID match", () => {
  const current = [{
    ...unitLine({ id: "pending-part", category: "parts", descZh: "配件清单（待报价）：水泵配件", unitPriceJmd: 0, pendingQuote: true }),
    remarkZh: "人工备注保留",
  } as QuotedChargeLine];
  const merged = mergeQuotationLinesFromParsed(current, [{
    findingZh: "水泵配件",
    findingEn: "Water pump part",
    recommendationZh: "配件清单（待报价）：水泵配件",
    recommendationEn: "Water pump part",
    pricingMode: "unit",
    category: "parts",
    quantity: 1,
    amountJmd: 12_000,
    pendingQuote: false,
  }]);

  expect(merged).toEqual([expect.objectContaining({
    id: "pending-part",
    descEn: "Water pump part",
    remarkZh: "人工备注保留",
    unitPriceJmd: 12_000,
    pendingQuote: false,
  })]);
});

test("AI draft merge preserves explicit manual JMD zero for labor, nonpending parts, and fixed totals", () => {
  const current: QuotedChargeLine[] = [
    unitLine({ id: "free-labor", category: "labor", descZh: "施工建议：免费诊断", unitPriceJmd: 0, pendingQuote: false }) as QuotedChargeLine,
    unitLine({ id: "free-part", category: "parts", descZh: "配件清单（待报价）：赠送清洗剂", unitPriceJmd: 0, pendingQuote: false }) as QuotedChargeLine,
    fixedLine({ id: "free-towing", descZh: "拖车费", code: "towing", amountJmd: 0 }) as QuotedChargeLine,
  ];
  const merged = mergeQuotationLinesFromParsed(current, [
    { findingZh: "免费诊断", recommendationZh: "施工建议：免费诊断", pricingMode: "unit", category: "labor", quantity: 1, amountJmd: 10_000, pendingQuote: false },
    { findingZh: "赠送清洗剂", recommendationZh: "配件清单（待报价）：赠送清洗剂", pricingMode: "unit", category: "parts", quantity: 1, amountJmd: 2_000, pendingQuote: false },
    { findingZh: "拖车费", recommendationZh: "拖车费", pricingMode: "fixed_total", category: "other_service", code: "towing", amountJmd: 7_500, pendingQuote: false },
  ]);

  expect(merged).toEqual([
    expect.objectContaining({ id: "free-labor", unitPriceJmd: 0, pendingQuote: false }),
    expect.objectContaining({ id: "free-part", unitPriceJmd: 0, pendingQuote: false }),
    expect.objectContaining({ id: "free-towing", amountJmd: 0 }),
  ]);
});

test("Quotation content revision changes only for normalized customer-file content, never for no-op or unrelated communication", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const before = store.read((state) => state);
  const report = before.inspectionReports[0];
  const quotation = before.currentQuotations.find((item) => item.id === report.quotationId)!;
  const lines = quotation.lineIds.map((id) => before.quotedChargeLines.find((line) => line.id === id)!).map(editableLine);
  expect(quotation.contentRevision).toBe(1);

  const noOp = await updateMockQuotation({
    reportId: report.id,
    expectedRevision: before.revision,
    mutationId: "content-token-noop",
    noteZh: `  ${quotation.noteZh}  `,
    noteEn: quotation.noteEn,
    lines,
  }, frontdeskActor, store);
  expect(noOp.contentRevision).toBe(1);
  expect(store.read((state) => state.currentQuotations.find((item) => item.id === quotation.id)!.contentRevision)).toBe(1);

  const changed = await updateMockQuotation({
    reportId: report.id,
    expectedRevision: noOp.revision,
    mutationId: "content-token-change",
    noteZh: "客户文件内容已变化",
    noteEn: quotation.noteEn,
    lines: [...lines, fixedLine({ descZh: "内部分类测试费", amountJmd: 7_500, code: "towing" })],
  }, frontdeskActor, store);
  expect(changed.contentRevision).toBe(2);

  await recordMockInspectionCustomerResponse({
    reportId: report.id,
    expectedRevision: changed.revision,
    mutationId: "content-token-response",
    result: "interested",
    note: "仅用于证明全局写入不改变报价内容 token",
  }, frontdeskActor, store);
  expect(store.read((state) => state.currentQuotations.find((item) => item.id === quotation.id)!.contentRevision)).toBe(2);

  const repository = createMemoryIrGeneratedFileRepository();
  const revisionBeforeGeneration = store.read((state) => state.revision);
  const generated = await generateMockInspectionReportFiles({
    reportId: report.id,
    expectedRevision: revisionBeforeGeneration,
    mutationId: "content-token-code-projection-v1",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  const beforeCodeChange = store.read((state) => state);
  const currentQuotation = beforeCodeChange.currentQuotations.find((item) => item.id === quotation.id)!;
  const currentLines = currentQuotation.lineIds.map((id) => beforeCodeChange.quotedChargeLines.find((line) => line.id === id)!).map(editableLine);
  const fixedIndex = currentLines.findIndex((line) => line.pricingMode === "fixed_total");
  expect(fixedIndex).toBeGreaterThanOrEqual(0);
  const fixedBefore = currentLines[fixedIndex];
  if (fixedBefore.pricingMode !== "fixed_total") throw new Error("expected fixed-total fixture");
  const nextCode: FixedTotalChargeLine["code"] = fixedBefore.code === "towing" ? "other" : "towing";
  const codeOnlyLines = currentLines.map((line, index) => (
    index === fixedIndex && line.pricingMode === "fixed_total" ? { ...line, code: nextCode } : line
  ));
  const codeOnly = await updateMockQuotation({
    reportId: report.id,
    expectedRevision: generated.revision,
    mutationId: "content-token-code-only",
    noteZh: "客户文件内容已变化",
    noteEn: quotation.noteEn,
    lines: codeOnlyLines,
  }, frontdeskActor, store);
  expect(codeOnly.contentChanged).toBe(true);
  expect(codeOnly.contentRevision).toBe(2);
  expect(codeOnly.revision).toBe(generated.revision + 1);
  const afterCodeChange = store.read((state) => state);
  const updatedQuotation = afterCodeChange.currentQuotations.find((item) => item.id === quotation.id)!;
  const fixedAfter = afterCodeChange.quotedChargeLines.find((line) => line.id === fixedBefore.id);
  expect(fixedAfter).toMatchObject({
    code: nextCode,
    descZh: fixedBefore.descZh,
    descEn: fixedBefore.descEn,
    remarkZh: fixedBefore.remarkZh,
    remarkEn: fixedBefore.remarkEn,
    amountJmd: fixedBefore.amountJmd,
  });
  expect(updatedQuotation.activeGeneratedBundle?.id).toBe(generated.bundle.id);
  expect(updatedQuotation.activeGeneratedBundle?.contentRevision).toBe(updatedQuotation.contentRevision);
  expect(afterCodeChange.mutationReceipts.some((receipt) => (
    receipt.mutationId === "content-token-code-only" && receipt.operation === "inspection.quotation.update"
  ))).toBe(true);
  await expect(getMockInspectionReportGeneratedFile(report.id, "zh", store, repository)).resolves.toMatchObject({
    metadata: { id: generated.bundle.attachments.find((attachment) => attachment.language === "zh")!.id },
  });
});

test("V1 remains resolvable and becomes stale after a real edit; failed V2 leaves it active; retry replaces all three atomically", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryIrGeneratedFileRepository();
  const calls: Array<{ language: string; version: number; generatedAt: string }> = [];
  const before = store.read((state) => state);
  const report = before.inspectionReports[0];

  const v1 = await generateMockInspectionReportFiles({
    reportId: report.id,
    expectedRevision: before.revision,
    mutationId: "generate-v1",
  }, frontdeskActor, store, repository, fakePdfRenderer(calls));
  expect(v1.bundle.generation).toBe(1);
  expect(v1.bundle.generatedAt).toMatch(/-05:00$/);
  expect(v1.bundle.attachments.map((item) => item.language)).toEqual(["zh", "en", "bilingual"]);
  expect(new Set(calls.map((call) => `${call.version}:${call.generatedAt}`)).size).toBe(1);

  const v1Zh = await getMockInspectionReportGeneratedFile(report.id, "zh", store, repository);
  expect(v1Zh.metadata.id).toBe(v1.bundle.attachments[0].id);
  expect([...v1Zh.bytes]).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 1]);

  const saved = store.read((state) => state);
  const current = saved.currentQuotations.find((item) => item.id === report.quotationId)!;
  const currentLines = current.lineIds.map((id) => saved.quotedChargeLines.find((line) => line.id === id)!).map(editableLine);
  const edit = await updateMockQuotation({
    reportId: report.id,
    expectedRevision: saved.revision,
    mutationId: "edit-after-v1",
    noteZh: `${current.noteZh} 已修改`,
    noteEn: current.noteEn,
    lines: currentLines,
  }, frontdeskActor, store);
  const stale = store.read((state) => state.currentQuotations.find((item) => item.id === current.id)!);
  expect(stale.contentRevision).toBe(v1.bundle.contentRevision + 1);
  expect(stale.activeGeneratedBundle).toEqual(v1.bundle);
  expect((await getMockInspectionReportGeneratedFile(report.id, "zh", store, repository)).bytes).toEqual(v1Zh.bytes);

  const failingRenderer: IrPdfRenderer = async (source, language) => {
    if (language === "en") throw new Error("English renderer failed");
    return fakePdfRenderer()(source, language);
  };
  await expect(generateMockInspectionReportFiles({
    reportId: report.id,
    expectedRevision: edit.revision,
    mutationId: "generate-v2",
  }, frontdeskActor, store, repository, failingRenderer)).rejects.toThrow("English renderer failed");
  expect(store.read((state) => state.currentQuotations.find((item) => item.id === current.id)!.generationCounter)).toBe(1);
  expect(store.read((state) => state.generationEvents)).toHaveLength(1);
  expect((await getMockInspectionReportGeneratedFile(report.id, "zh", store, repository)).metadata.id).toBe(v1Zh.metadata.id);

  const v2 = await generateMockInspectionReportFiles({
    reportId: report.id,
    expectedRevision: edit.revision,
    mutationId: "generate-v2",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  expect(v2.bundle.generation).toBe(2);
  expect(v2.bundle.attachments.map((item) => item.id)).not.toEqual(v1.bundle.attachments.map((item) => item.id));
  expect(store.read((state) => state.generationEvents)).toHaveLength(2);
  await expect(getMockInspectionReportGeneratedFile(report.id, "zh", store, repository)).resolves.toMatchObject({
    metadata: { id: v2.bundle.attachments[0].id },
  });
  expect(await repository.readBundle(v1.bundle.attachments.map((item) => item.id))).toBeNull();
});

test("generated-file resolution rejects a coherent same-length foreign bundle stored under every canonical attachment key", async () => {
  const backend = new Map<string, IrGeneratedFileRecord>();
  const repository = createMemoryIrGeneratedFileRepository({ backend });
  const store = createMockLinkedOperationsStore(memoryStorage());
  const before = store.read((state) => state);
  const report = before.inspectionReports[0];
  const generated = await generateMockInspectionReportFiles({
    reportId: report.id,
    expectedRevision: before.revision,
    mutationId: "foreign-bundle-guard",
  }, frontdeskActor, store, repository, fakePdfRenderer());

  for (const attachment of generated.bundle.attachments) {
    const original = backend.get(attachment.id)!;
    backend.set(attachment.id, {
      ...original,
      bundleId: "foreign-bundle",
      reportId: "foreign-report",
      quotationId: "foreign-quotation",
      fileName: `foreign-${attachment.language}.pdf`,
      bytes: original.bytes.slice(),
    });
  }

  await expect(getMockInspectionReportGeneratedFile(report.id, "zh", store, repository))
    .rejects.toMatchObject({ status: 409 });
});

test("canonical validator closes active attachment identities and binds only the latest new-format generation event", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryIrGeneratedFileRepository();
  const report = store.read((state) => state.inspectionReports[0]);
  await generateMockInspectionReportFiles({
    reportId: report.id,
    expectedRevision: store.read((state) => state.revision),
    mutationId: "validator-v1",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  await generateMockInspectionReportFiles({
    reportId: report.id,
    expectedRevision: store.read((state) => state.revision),
    mutationId: "validator-v2",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  const valid = store.read((state) => state);
  expect(() => validateLinkedOperationsState(valid)).not.toThrow();

  const duplicateBundleAttachment = structuredClone(valid) as any;
  const quotation = duplicateBundleAttachment.currentQuotations.find((item: any) => item.id === report.quotationId)!;
  quotation.activeGeneratedBundle!.attachments[1] = {
    ...quotation.activeGeneratedBundle!.attachments[1],
    id: quotation.activeGeneratedBundle!.attachments[0].id,
  };
  expect(() => validateLinkedOperationsState(duplicateBundleAttachment)).toThrow(/BUNDLE|ATTACHMENT|ID/iu);

  const duplicateEventAttachment = structuredClone(valid) as any;
  const duplicateEvent = duplicateEventAttachment.generationEvents.at(-1)!;
  duplicateEvent.attachmentIds = [duplicateEvent.attachmentIds[0], duplicateEvent.attachmentIds[0], duplicateEvent.attachmentIds[2]];
  expect(() => validateLinkedOperationsState(duplicateEventAttachment)).toThrow(/GENERATION|ATTACHMENT/iu);

  for (const mutate of [
    (state: any) => { state.generationEvents.at(-1)!.generatedAt = "2026-08-21T12:00:00.000-05:00"; },
    (state: any) => { state.generationEvents.at(-1)!.rendererVersion = "foreign-renderer"; },
    (state: any) => { state.generationEvents.at(-1)!.contentRevision += 1; },
    (state: any) => { state.generationEvents.at(-1)!.attachmentIds = [...state.generationEvents[0].attachmentIds]; },
  ]) {
    const corrupted = structuredClone(valid) as any;
    mutate(corrupted);
    expect(() => validateLinkedOperationsState(corrupted)).toThrow(/GENERATION|BUNDLE/iu);
  }

  const legacyCompatible = createMockLinkedOperationsStore(memoryStorage()).read((state) => state);
  const legacyQuotation = legacyCompatible.currentQuotations[0];
  legacyCompatible.generationEvents.push({
    id: "legacy-generation-event",
    reportId: legacyQuotation.inspectionReportId,
    quotationId: legacyQuotation.id,
    generation: 1,
    contentRevision: 1,
    actorId: "legacy-actor",
    generatedAt: "2026-08-18T10:00:00.000-05:00",
    rendererVersion: "legacy-unavailable",
    attachmentIds: [],
  });
  expect(() => validateLinkedOperationsState(legacyCompatible)).not.toThrow();
});

test("canonical validator rejects active bundle and attachment identities shared across reports", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryIrGeneratedFileRepository();
  const reports = store.read((state) => state.inspectionReports.slice(0, 2));
  await generateMockInspectionReportFiles({
    reportId: reports[0].id,
    expectedRevision: store.read((state) => state.revision),
    mutationId: "validator-global-a-v1",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  await generateMockInspectionReportFiles({
    reportId: reports[1].id,
    expectedRevision: store.read((state) => state.revision),
    mutationId: "validator-global-b-v1",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  const valid = store.read((state) => state);
  expect(() => validateLinkedOperationsState(valid)).not.toThrow();

  const bundleCollision = structuredClone(valid) as any;
  const bundleOwners = bundleCollision.currentQuotations.filter((quotation: any) => quotation.activeGeneratedBundle !== null);
  bundleOwners[1].activeGeneratedBundle!.id = bundleOwners[0].activeGeneratedBundle!.id;
  expect(() => validateLinkedOperationsState(bundleCollision)).toThrow(/BUNDLE.*(?:DUPLICATE|OWNER|GLOBAL)/iu);

  const attachmentCollision = structuredClone(valid) as any;
  const attachmentOwners = attachmentCollision.currentQuotations.filter((quotation: any) => quotation.activeGeneratedBundle !== null);
  const sharedAttachmentId = attachmentOwners[0].activeGeneratedBundle!.attachments[0].id;
  attachmentOwners[1].activeGeneratedBundle!.attachments[0] = {
    ...attachmentOwners[1].activeGeneratedBundle!.attachments[0],
    id: sharedAttachmentId,
  };
  const secondLatestEvent = attachmentCollision.generationEvents.find((event: any) => (
    event.quotationId === attachmentOwners[1].id
    && event.generation === attachmentOwners[1].activeGeneratedBundle!.generation
  ))!;
  secondLatestEvent.attachmentIds = [sharedAttachmentId, ...secondLatestEvent.attachmentIds.slice(1)];
  expect(() => validateLinkedOperationsState(attachmentCollision)).toThrow(/ATTACHMENT.*(?:DUPLICATE|OWNER|GLOBAL)/iu);
});

test("failed first logo fetch leaves generation uncommitted and the same intent retries as V1 after recovery", async () => {
  const originalFetch = globalThis.fetch;
  const logoBytes = readFileSync(join(process.cwd(), "public/logo-icon.png"));
  const fontBytes = readFileSync(join(process.cwd(), "public/fonts/NotoSansSC-Regular-wh.ttf"));
  let logoAvailable = false;
  let logoFetches = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/logo-icon.png")) {
      logoFetches += 1;
      return logoAvailable
        ? new Response(logoBytes, { status: 200 })
        : new Response("logo unavailable", { status: 503 });
    }
    if (url.endsWith("/fonts/NotoSansSC-Regular-wh.ttf")) {
      return new Response(fontBytes, { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const backend = new Map<string, IrGeneratedFileRecord>();
    const repository = createMemoryIrGeneratedFileRepository({ backend });
    const before = store.read((state) => state);
    const report = before.inspectionReports[0];
    const input = {
      reportId: report.id,
      expectedRevision: before.revision,
      mutationId: "logo-recovery-same-intent",
    };

    await expect(generateMockInspectionReportFiles(input, frontdeskActor, store, repository))
      .rejects.toThrow("Logo resource failed (503)");
    expect(store.read((state) => state)).toEqual(before);
    expect(backend.size).toBe(0);
    expect(logoFetches).toBe(1);

    logoAvailable = true;
    const recovered = await generateMockInspectionReportFiles(input, frontdeskActor, store, repository);
    expect(recovered.replayed).toBe(false);
    expect(recovered.bundle.generation).toBe(1);
    expect(recovered.bundle.attachments).toHaveLength(3);
    expect(logoFetches).toBe(2);
    const after = store.read((state) => state);
    expect(after.currentQuotations.find((quotation) => quotation.id === report.quotationId)!.generationCounter).toBe(1);
    expect(after.generationEvents).toHaveLength(1);
    expect(after.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId)).toHaveLength(1);
    expect(backend.size).toBe(3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repository and canonical generation failures leave counter, event, receipt, metadata and old bytes unchanged", async () => {
  const restore = installBrowser(frontdesk, { failNext: { byAction: { "inspection.files.generate.write": "canonical failed" } } });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const backend = new Map<string, IrGeneratedFileRecord>();
    const repository = createMemoryIrGeneratedFileRepository({ backend });
    const before = store.read((state) => state);
    const report = before.inspectionReports[0];

    repository.failNextWrite(new Error("repository failed"));
    await expect(generateMockInspectionReportFiles({
      reportId: report.id, expectedRevision: before.revision, mutationId: "repo-failure",
    }, frontdeskActor, store, repository, fakePdfRenderer())).rejects.toThrow("repository failed");
    expect(store.read((state) => state.generationEvents)).toHaveLength(0);
    expect(store.read((state) => state.mutationReceipts.some((item) => item.mutationId === "repo-failure"))).toBe(false);

    await expect(generateMockInspectionReportFiles({
      reportId: report.id, expectedRevision: before.revision, mutationId: "canonical-failure",
    }, frontdeskActor, store, repository, fakePdfRenderer())).rejects.toMatchObject({ status: 503 });
    const after = store.read((state) => state);
    const quotation = after.currentQuotations.find((item) => item.id === report.quotationId)!;
    expect(quotation.generationCounter).toBe(0);
    expect(quotation.activeGeneratedBundle).toBeNull();
    expect(after.generationEvents).toHaveLength(0);
    expect(after.mutationReceipts.some((item) => item.mutationId === "canonical-failure")).toBe(false);
    expect(backend.size).toBe(3);
    expect(new Set([...backend.values()].map((file) => file.bundleId))).toEqual(new Set([
      "ir-generated-bundle-canonical-failure",
    ]));

    const recovered = await generateMockInspectionReportFiles({
      reportId: report.id,
      expectedRevision: before.revision,
      mutationId: "canonical-failure-retry",
    }, frontdeskActor, store, repository, fakePdfRenderer());
    expect(backend.size).toBe(3);
    expect(new Set([...backend.values()].map((file) => file.bundleId))).toEqual(new Set([recovered.bundle.id]));
  } finally {
    restore();
  }
});

test("generation cleanup keeps other reports active, removes prior orphans, and remains best-effort on cleanup failure", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const backend = new Map<string, IrGeneratedFileRecord>();
  const repository = createMemoryIrGeneratedFileRepository({ backend });
  const reports = store.read((state) => state.inspectionReports.slice(0, 2));
  const first = await generateMockInspectionReportFiles({
    reportId: reports[0].id,
    expectedRevision: store.read((state) => state.revision),
    mutationId: "multi-report-a-v1",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  const second = await generateMockInspectionReportFiles({
    reportId: reports[1].id,
    expectedRevision: store.read((state) => state.revision),
    mutationId: "multi-report-b-v1",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  await repository.writeBundle(generatedRecordBundle("prior-orphan"));

  const regenerated = await generateMockInspectionReportFiles({
    reportId: reports[0].id,
    expectedRevision: store.read((state) => state.revision),
    mutationId: "multi-report-a-v2",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  expect(await repository.readBundle(generatedRecordBundle("prior-orphan").map((file) => file.id))).toBeNull();
  await expect(getMockInspectionReportGeneratedFile(reports[0].id, "zh", store, repository)).resolves.toMatchObject({
    metadata: { id: regenerated.bundle.attachments[0].id },
  });
  await expect(getMockInspectionReportGeneratedFile(reports[1].id, "zh", store, repository)).resolves.toMatchObject({
    metadata: { id: second.bundle.attachments[0].id },
  });
  expect(await repository.readBundle(first.bundle.attachments.map((file) => file.id))).toBeNull();

  await repository.writeBundle(generatedRecordBundle("cleanup-failure-orphan"));
  repository.failNextCleanup(new Error("cleanup unavailable"));
  const afterCleanupFailure = await generateMockInspectionReportFiles({
    reportId: reports[1].id,
    expectedRevision: store.read((state) => state.revision),
    mutationId: "multi-report-b-v2",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  await expect(getMockInspectionReportGeneratedFile(reports[1].id, "en", store, repository)).resolves.toMatchObject({
    metadata: { id: afterCleanupFailure.bundle.attachments[1].id },
  });
});

test("generation is closed, session-bound and idempotent across replay, response loss and concurrency", async () => {
  const restore = installBrowser(frontdesk, { nowMs: Date.parse("2026-08-21T15:25:00Z") });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const repository = createMemoryIrGeneratedFileRepository();
    const calls: Array<{ language: string; version: number; generatedAt: string }> = [];
    const revision = store.read((state) => state.revision);
    const input = { reportId: "inspection-report-demo-01", expectedRevision: revision, mutationId: "exact-replay" };
    const first = await generateMockInspectionReportFiles(input, frontdeskActor, store, repository, fakePdfRenderer(calls));
    const replay = await generateMockInspectionReportFiles(input, frontdeskActor, store, repository, fakePdfRenderer(calls));
    expect(replay.bundle).toEqual(first.bundle);
    expect(calls).toHaveLength(3);
    expect(first.bundle.generatedAt).toBe("2026-08-21T10:25:00.000-05:00");
    expect(store.read((state) => state.generationEvents[0].actorId)).toBe(frontdeskActor.id);

    await expect(generateMockInspectionReportFiles({ ...input, expectedRevision: revision + 1 }, frontdeskActor, store, repository, fakePdfRenderer()))
      .rejects.toMatchObject({ status: 409 });
    await expect(api.inspectionReports.generateFiles({ ...input, actorId: "spoof", generatedAt: "2099-01-01", version: 99 } as never))
      .rejects.toMatchObject({ status: 400 });

    const now = store.read((state) => state.revision);
    const outcomes = await Promise.allSettled([
      generateMockInspectionReportFiles({ reportId: input.reportId, expectedRevision: now, mutationId: "concurrent-a" }, frontdeskActor, store, repository, fakePdfRenderer()),
      generateMockInspectionReportFiles({ reportId: input.reportId, expectedRevision: now, mutationId: "concurrent-b" }, frontdeskActor, store, repository, fakePdfRenderer()),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(store.read((state) => state.generationEvents)).toHaveLength(2);
  } finally {
    restore();
  }
});

test("generation response loss commits once and exact retry replays the same bundle and bytes without rendering or incrementing V", async () => {
  const restore = installBrowser(frontdesk, {
    failNext: { byAction: { "inspection.files.generate.response": "response lost after commit" } },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const repository = createMemoryIrGeneratedFileRepository();
    const calls: Array<{ language: string; version: number; generatedAt: string }> = [];
    const before = store.read((state) => state);
    const report = before.inspectionReports[0];
    const input = {
      reportId: report.id,
      expectedRevision: before.revision,
      mutationId: "generation-response-loss",
    };

    await expect(generateMockInspectionReportFiles(
      input,
      frontdeskActor,
      store,
      repository,
      fakePdfRenderer(calls),
    )).rejects.toMatchObject({ status: 503 });
    const committed = store.read((state) => state);
    const active = committed.currentQuotations.find((item) => item.id === report.quotationId)!.activeGeneratedBundle!;
    const committedBytes = await repository.readBundle(active.attachments.map((attachment) => attachment.id));
    expect(active.generation).toBe(1);
    expect(committed.generationEvents).toHaveLength(1);
    expect(committed.mutationReceipts.filter((item) => item.mutationId === input.mutationId)).toHaveLength(1);
    expect(committedBytes).toHaveLength(3);
    expect(calls).toHaveLength(3);

    const replay = await generateMockInspectionReportFiles(
      input,
      frontdeskActor,
      store,
      repository,
      fakePdfRenderer(calls),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.bundle).toEqual(active);
    expect(calls).toHaveLength(3);
    expect(store.read((state) => state.generationEvents)).toHaveLength(1);
    expect(store.read((state) => state.currentQuotations.find((item) => item.id === report.quotationId)!.generationCounter)).toBe(1);
    expect(await repository.readBundle(active.attachments.map((attachment) => attachment.id))).toEqual(committedBytes);

    await expect(generateMockInspectionReportFiles(
      { ...input, expectedRevision: before.revision + 1 },
      frontdeskActor,
      store,
      repository,
      fakePdfRenderer(calls),
    )).rejects.toMatchObject({ status: 409 });
    expect(calls).toHaveLength(3);
  } finally {
    restore();
  }
});

test("Task6 indexed attachments tombstones and receipts require their inverse audit evidence", async () => {
  const uploadStore = createMockLinkedOperationsStore(memoryStorage());
  const uploadRepository = createMemoryReportPhotoRepository();
  const uploaded = await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: uploadStore.read((state) => state.revision),
    mutationId: "inverse-audit-upload",
    deleteIds: [],
    files: [new File([PHOTO_PNG], "inverse.png", { type: "image/png" })],
  }, frontdeskActor, uploadStore, uploadRepository);
  const uploadedId = uploaded.photos[0].id;
  const withoutUploadAudit = uploadStore.read((state) => structuredClone(state));
  withoutUploadAudit.reportAttachmentAuditEvents = withoutUploadAudit.reportAttachmentAuditEvents
    .filter((event) => event.attachmentId !== uploadedId);
  expect(() => validateLinkedOperationsState(withoutUploadAudit)).toThrow();
  const receiptDrift = uploadStore.read((state) => structuredClone(state));
  const uploadReceipt = receiptDrift.mutationReceipts.find((receipt) => receipt.mutationId === "inverse-audit-upload")!;
  (uploadReceipt as unknown as { result: unknown }).result = {
    ...(uploadReceipt.result as Record<string, unknown>),
    auditEventIds: ["missing-audit"],
  };
  expect(() => validateLinkedOperationsState(receiptDrift)).toThrow();
  const primitivePhoto = uploadStore.read((state) => structuredClone(state));
  const primitiveReceipt = primitivePhoto.mutationReceipts.find((receipt) => receipt.mutationId === "inverse-audit-upload")!;
  (primitiveReceipt.result as { photos: unknown[] }).photos = [1];
  expect(() => validateLinkedOperationsState(primitivePhoto)).toThrow(/PHOTO_MUTATION_RESULT_PHOTO/);
  const leakedPhotoField = uploadStore.read((state) => structuredClone(state));
  const leakedReceipt = leakedPhotoField.mutationReceipts.find((receipt) => receipt.mutationId === "inverse-audit-upload")!;
  const leakedSnapshot = (leakedReceipt.result as { photos: Array<Record<string, unknown>> }).photos[0]!;
  leakedSnapshot.dataUrl = "data:image/png;base64,forbidden";
  expect(() => validateLinkedOperationsState(leakedPhotoField)).toThrow(/PHOTO_MUTATION_RESULT_PHOTO/);
  const wrongPhotoOwner = uploadStore.read((state) => structuredClone(state));
  const wrongOwnerReceipt = wrongPhotoOwner.mutationReceipts.find((receipt) => receipt.mutationId === "inverse-audit-upload")!;
  (wrongOwnerReceipt.result as { photos: Array<{ reportId: string }> }).photos[0]!.reportId = "inspection-report-demo-02";
  expect(() => validateLinkedOperationsState(wrongPhotoOwner)).toThrow(/PHOTO_MUTATION_RESULT_PHOTO/);
  const wrongPhotoMetadata = uploadStore.read((state) => structuredClone(state));
  const wrongMetadataReceipt = wrongPhotoMetadata.mutationReceipts.find((receipt) => receipt.mutationId === "inverse-audit-upload")!;
  (wrongMetadataReceipt.result as { photos: Array<{ sha256: string | null }> }).photos[0]!.sha256 = "sha256-bytes-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  expect(() => validateLinkedOperationsState(wrongPhotoMetadata)).toThrow(/PHOTO_MUTATION_RESULT_PHOTO/);
  const missingUploadedSnapshot = uploadStore.read((state) => structuredClone(state));
  const missingUploadedReceipt = missingUploadedSnapshot.mutationReceipts.find((receipt) => receipt.mutationId === "inverse-audit-upload")!;
  (missingUploadedReceipt.result as { photos: unknown[] }).photos = [];
  expect(() => validateLinkedOperationsState(missingUploadedSnapshot)).toThrow(/PHOTO_MUTATION_RESULT_EFFECT/);
  const withoutUploadReceipt = uploadStore.read((state) => structuredClone(state));
  withoutUploadReceipt.mutationReceipts = withoutUploadReceipt.mutationReceipts
    .filter((receipt) => receipt.mutationId !== "inverse-audit-upload");
  expect(() => validateLinkedOperationsState(withoutUploadReceipt)).toThrow();

  await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: uploaded.revision,
    mutationId: "inverse-audit-delete",
    deleteIds: [uploadedId],
    files: [],
  }, frontdeskActor, uploadStore, uploadRepository);
  const withoutDeleteAudit = uploadStore.read((state) => structuredClone(state));
  withoutDeleteAudit.reportAttachmentAuditEvents = withoutDeleteAudit.reportAttachmentAuditEvents
    .filter((event) => !(event.attachmentId === uploadedId && event.action === "deleted"));
  expect(() => validateLinkedOperationsState(withoutDeleteAudit)).toThrow();
  const deletedStillReturned = uploadStore.read((state) => structuredClone(state));
  const firstReceipt = deletedStillReturned.mutationReceipts.find((receipt) => receipt.mutationId === "inverse-audit-upload")!;
  const deleteReceipt = deletedStillReturned.mutationReceipts.find((receipt) => receipt.mutationId === "inverse-audit-delete")!;
  (deleteReceipt.result as { photos: unknown[] }).photos = structuredClone(
    (firstReceipt.result as { photos: unknown[] }).photos,
  );
  expect(() => validateLinkedOperationsState(deletedStillReturned)).toThrow(/PHOTO_MUTATION_RESULT_EFFECT/);

});

test("photo mutation receipt payload is closed, hashed, revision-bound, and matches uploaded facts", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryReportPhotoRepository();
  await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "photo-payload-closure",
    deleteIds: [],
    files: [new File([PHOTO_PNG], "payload-proof.png", { type: "image/png" })],
  }, frontdeskActor, store, repository);

  const mutatePayload = (mutate: (payload: Record<string, unknown>) => void, rehash = true) => {
    const changed = store.read((state) => structuredClone(state));
    const receipt = changed.mutationReceipts.find((candidate) => candidate.mutationId === "photo-payload-closure")!;
    const payload = JSON.parse(receipt.payloadCanonical!) as Record<string, unknown>;
    mutate(payload);
    const mutableReceipt = receipt as unknown as { payloadCanonical: string; payloadHash: string };
    mutableReceipt.payloadCanonical = canonicalPayload(payload);
    if (rehash) mutableReceipt.payloadHash = receiptPayloadHash(mutableReceipt.payloadCanonical);
    return changed;
  };

  const invalidStates = [
    mutatePayload((payload) => { payload.actorId = "spoofed"; }),
    mutatePayload((payload) => { payload.mutationId = "drifted-mutation"; }),
    mutatePayload((payload) => { payload.expectedRevision = Number(payload.expectedRevision) - 1; }),
    mutatePayload((payload) => {
      ((payload.files as Array<Record<string, unknown>>)[0]!).originalName = "forged-name.png";
    }),
    mutatePayload((payload) => {
      ((payload.files as Array<Record<string, unknown>>)[0]!).sha256 = `sha256-bytes-v1:${"a".repeat(64)}`;
    }),
    mutatePayload(() => {}, false),
  ];
  (invalidStates.at(-1)!.mutationReceipts.find((candidate) => candidate.mutationId === "photo-payload-closure") as unknown as {
    payloadHash: string;
  }).payloadHash = "fnv1a64:0000000000000000";

  for (const invalid of invalidStates) {
    expect(() => validateLinkedOperationsState(invalid)).toThrow(/PHOTO_MUTATION_PAYLOAD/);
  }
});

test("photo delete IDs are normalized before duplicate detection and reject without state or Blob writes", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryReportPhotoRepository();
  const uploaded = await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "photo-delete-trim-upload",
    deleteIds: [],
    files: [new File([PHOTO_PNG], "trim-delete.png", { type: "image/png" })],
  }, frontdeskActor, store, repository);
  const photoId = uploaded.photos[0]!.id;
  const beforeState = store.read((state) => structuredClone(state));
  const beforeRecords = await repository.list();

  await expect(updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: uploaded.revision,
    mutationId: "photo-delete-trim-duplicate",
    deleteIds: [photoId, ` ${photoId}`],
    files: [],
  }, frontdeskActor, store, repository)).rejects.toMatchObject({ status: 400 });

  expect(store.read((state) => state)).toEqual(beforeState);
  expect(await repository.list()).toEqual(beforeRecords);
});

test("photo mutation receipts preserve the complete active snapshot at their own committed revision", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryReportPhotoRepository();
  const first = await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "photo-snapshot-m1",
    deleteIds: [],
    files: [new File([PHOTO_PNG], "snapshot-a.png", { type: "image/png" })],
  }, frontdeskActor, store, repository);
  const second = await updateMockInspectionReportPhotos("inspection-report-demo-03", {
    reportId: "inspection-report-demo-03",
    expectedRevision: first.revision,
    mutationId: "photo-snapshot-m2",
    deleteIds: [],
    files: [new File([PHOTO_PNG], "snapshot-b.png", { type: "image/png" })],
  }, frontdeskActor, store, repository);
  expect(second.photos).toHaveLength(2);

  const futurePhoto = store.read((state) => structuredClone(state));
  const futureM1 = futurePhoto.mutationReceipts.find((receipt) => receipt.mutationId === "photo-snapshot-m1")!;
  (futureM1.result as { photos: unknown[] }).photos = structuredClone(second.photos);
  expect(() => validateLinkedOperationsState(futurePhoto)).toThrow(/PHOTO_MUTATION_RESULT_SNAPSHOT/);

  const omittedExisting = store.read((state) => structuredClone(state));
  const omittedM2 = omittedExisting.mutationReceipts.find((receipt) => receipt.mutationId === "photo-snapshot-m2")!;
  (omittedM2.result as { photos: unknown[] }).photos = [structuredClone(second.photos[1])];
  expect(() => validateLinkedOperationsState(omittedExisting)).toThrow(/PHOTO_MUTATION_RESULT_SNAPSHOT/);

  const reordered = store.read((state) => structuredClone(state));
  const reorderedM2 = reordered.mutationReceipts.find((receipt) => receipt.mutationId === "photo-snapshot-m2")!;
  (reorderedM2.result as { photos: unknown[] }).photos = structuredClone([...second.photos].reverse());
  expect(() => validateLinkedOperationsState(reordered)).toThrow(/PHOTO_MUTATION_RESULT_SNAPSHOT/);
});

test("explicit priced parts and fixed-total parser output flows through create and draft DTOs", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const vehicleId = store.read((state) => state.vehicles[0].id);
  const parsedCreate = parseInspectionNaturalLanguage("水泵配件 12000\n拖车费 7500");
  const created = await createMockInspectionReportFromInput({
    vehicleId,
    rawText: "水泵配件 12000\n拖车费 7500",
    aiDraft: parsedCreate.aiDraft,
    items: parsedCreate.items.filter((item) => item.pricingMode === "unit").map((item) => ({
      findingZh: item.findingZh,
      recommendationZh: item.recommendationZh,
    })),
    quotationLines: quotationLinesFromParsed(parsedCreate.items),
  }, frontdeskActor.id, frontdeskActor.name, store);
  expect(created.quotation.lines).toEqual([
    expect.objectContaining({ category: "parts", pricingMode: "unit", unitPriceJmd: 12_000, pendingQuote: false }),
    expect.objectContaining({ category: "other_service", pricingMode: "fixed_total", code: "towing", amountJmd: 7_500 }),
  ]);

  const parsedDraft = parseInspectionNaturalLanguage("诊断工时 15000\n外派服务 6000");
  const drafted = await updateMockInspectionReportDraft(created.id, {
    expectedRevision: created.revision,
    mutationId: "ir-draft-three-lines",
    rawText: "诊断工时 15000\n外派服务 6000",
    aiDraft: parsedDraft.aiDraft,
    items: parsedDraft.items.filter((item) => item.pricingMode === "unit").map((item) => ({
      findingZh: item.findingZh,
      recommendationZh: item.recommendationZh,
    })),
    quotationLines: quotationLinesFromParsed(parsedDraft.items),
  }, frontdeskActor, store);
  expect(drafted.quotation.lines).toEqual([
    expect.objectContaining({ category: "labor", pricingMode: "unit", unitPriceJmd: 15_000 }),
    expect.objectContaining({ category: "other_service", pricingMode: "fixed_total", code: "offsite_service", amountJmd: 6_000 }),
  ]);
});

test("drafting inspection facts without quotation lines preserves manual quotation facts and stable IDs", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const before = store.read((state) => {
    const report = state.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!;
    const quotation = state.currentQuotations.find((item) => item.id === report.quotationId)!;
    return {
      id: report.id,
      revision: state.revision,
      noteZh: quotation.noteZh,
      noteEn: quotation.noteEn,
      lines: quotation.lineIds.map((id) => structuredClone(state.quotedChargeLines.find((line) => line.id === id)!)),
    };
  });
  const fixed = fixedLine({ descZh: "人工拖车费", code: "towing", amountJmd: 7_500 });
  const editableFirst = editableLine(before.lines[0]);
  if (editableFirst.pricingMode !== "unit") throw new Error("expected first fixture line to be unit-priced");
  await updateMockQuotation({
    reportId: before.id,
    expectedRevision: before.revision,
    mutationId: "qt-before-redraft-preserve",
    noteZh: "人工报价备注",
    noteEn: "Manual quotation note",
    lines: [
      { ...editableFirst, descEn: "Manual translation", unitDiscountJmd: 1_250 },
      ...before.lines.slice(1).map(editableLine),
      fixed,
    ],
  }, frontdeskActor, store);
  const manual = store.read((state) => {
    const report = state.inspectionReports.find((item) => item.id === before.id)!;
    const quotation = state.currentQuotations.find((item) => item.id === report.quotationId)!;
    return {
      revision: state.revision,
      noteZh: quotation.noteZh,
      noteEn: quotation.noteEn,
      lines: quotation.lineIds.map((id) => structuredClone(state.quotedChargeLines.find((line) => line.id === id)!)),
    };
  });

  const drafted = await updateMockInspectionReportDraft(before.id, {
    expectedRevision: manual.revision,
    mutationId: "ir-redraft-preserve-quotation",
    rawText: "二次检查：只更新检查事实",
    aiDraft: "已重新整理检查事实",
    items: [{ findingZh: "二次检查", recommendationZh: "继续诊断" }],
  }, frontdeskActor, store);

  expect(drafted.quotation.lines).toEqual(manual.lines);
  expect(drafted.quotation.noteZh).toBe("人工报价备注");
  expect(drafted.quotation.noteEn).toBe("Manual quotation note");
});

test("quotation API rejects fractional quantities and JMD values instead of truncating", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const before = store.read((state) => {
    const report = state.inspectionReports.find((item) => item.id === "inspection-report-demo-01")!;
    const quotation = state.currentQuotations.find((item) => item.id === report.quotationId)!;
    return { id: report.id, revision: state.revision, noteZh: quotation.noteZh, noteEn: quotation.noteEn };
  });
  const variants = [
    unitLine({ category: "labor", descZh: "小数数量", quantity: 1.5, unitPriceJmd: 100 }),
    unitLine({ category: "labor", descZh: "小数单价", unitPriceJmd: 100.5 }),
    unitLine({ category: "labor", descZh: "小数优惠", unitPriceJmd: 100, unitDiscountJmd: 0.5 }),
    fixedLine({ descZh: "小数固定费用", amountJmd: 50.5 }),
  ];
  for (const [index, line] of variants.entries()) {
    await expect(updateMockQuotation({
      reportId: before.id,
      expectedRevision: before.revision,
      mutationId: `qt-fractional-${index}`,
      noteZh: before.noteZh,
      noteEn: before.noteEn,
      lines: [line],
    }, frontdeskActor, store)).rejects.toMatchObject({ status: 400 });
  }
  expect(store.read((state) => state).revision).toBe(before.revision);
});

test("draft update cannot bypass the quotation mutation and high-discount signature gate", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const before = store.read((state) => structuredClone(state));
  const report = before.inspectionReports[0];
  const quotation = before.currentQuotations.find((item) => item.id === report.quotationId)!;
  const lineId = quotation.lineIds[0];
  await expect(updateMockInspectionReportDraft(report.id, {
    expectedRevision: before.revision,
    mutationId: "ir-draft-cannot-bypass-signature",
    rawText: "试图通过草稿写高优惠",
    aiDraft: "试图通过草稿写高优惠",
    items: [{ findingZh: "高优惠", recommendationZh: "高优惠工时" }],
    quotationLines: [unitLine({
      id: lineId,
      category: "labor",
      descZh: "高优惠工时",
      unitPriceJmd: 10_000,
      unitDiscountJmd: 2_001,
    })],
  }, frontdeskActor, store)).rejects.toMatchObject({ status: 400 });
  expect(store.read((state) => state)).toEqual(before);
});

test("injected Quotation write failure consumes no signature, receipt, or canonical fact and exact retry succeeds", async () => {
  const restore = installBrowser(frontdesk, {
    failNext: { byAction: { "inspection.quotation.update.write": "报价写入故障" } },
  });
  try {
    const before = await api.inspectionReports.detail("inspection-report-demo-01");
    const input = {
      reportId: before.id,
      expectedRevision: before.revision,
      mutationId: "qt-write-failure-retry",
      noteZh: "失败时不能半写",
      noteEn: before.quotation.noteEn,
      lines: [unitLine({ category: "labor", descZh: "工时", unitPriceJmd: 10_000, unitDiscountJmd: 2_001 })],
      signature: { rawStrokes: RAW_STROKES },
    };
    await expect(api.inspectionReports.updateQuotation(input)).rejects.toMatchObject({ status: 503 });
    const failedState = getMockLinkedOperationsStore().read((state) => state);
    expect(failedState.revision).toBe(before.revision);
    expect(failedState.discountSignatureEvents).toHaveLength(0);
    expect(failedState.mutationReceipts.find((receipt) => receipt.mutationId === input.mutationId)).toBeUndefined();
    expect((await api.inspectionReports.detail(before.id)).quotation.noteZh).toBe(before.quotation.noteZh);

    await expect(api.inspectionReports.updateQuotation(input)).resolves.toMatchObject({
      revision: before.revision + 1,
      signatureEventId: input.mutationId,
    });
    expect(getMockLinkedOperationsStore().read((state) => state.discountSignatureEvents)).toHaveLength(1);
  } finally {
    restore();
  }
});

test("IR 三态只从 canonical 沟通事实派生，并守恒读取 legacy communications", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const store = getMockLinkedOperationsStore();
    const initial = await api.inspectionReports.detail("inspection-report-demo-01") as any;
    expect(initial.communicationStatus).toBe("not_notified");
    expect(initial.currentResponse).toBeNull();

    await store.mutate((state) => {
      state.communications.push({
        id: "legacy-communication-report-sent",
        reportId: "inspection-report-demo-01",
        contentKind: "report",
        channel: "sms",
        target: "+1 876 555 0101",
        delivery: "sent",
        response: "no_response",
        note: "legacy report send stays byte-for-byte readable",
        actorId: "emp-003",
        recordedAt: "2026-08-18T12:00:00-05:00",
      });
      state.revision += 1;
    });
    const sent = await api.inspectionReports.detail("inspection-report-demo-01") as any;
    expect(sent.communicationStatus).toBe("awaiting_reply");
    expect(sent.currentResponse).toBeNull();
    expect(sent.lastNotification).toMatchObject({ channel: "sms", recordedAt: "2026-08-18T12:00:00-05:00" });
    expect(sent.legacyCommunications).toContainEqual(expect.objectContaining({ id: "legacy-communication-report-sent" }));

    await store.mutate((state) => {
      state.communications.push({
        id: "legacy-communication-reply-declined",
        reportId: "inspection-report-demo-01",
        contentKind: "reply",
        channel: "in_person",
        target: "front desk",
        delivery: "delivered",
        response: "declined",
        note: "legacy decline",
        actorId: "emp-003",
        recordedAt: "2026-08-18T13:00:00-05:00",
      });
      state.revision += 1;
    });
    const closed = await api.inspectionReports.detail("inspection-report-demo-01") as any;
    expect(closed.communicationStatus).toBe("closed");
    expect(closed.currentResponse).toBe("not_interested");
    expect(closed.legacyCommunications.map((event: { id: string }) => event.id)).toEqual([
      "legacy-communication-report-sent",
      "legacy-communication-reply-declined",
    ]);
  } finally {
    restore();
  }
});

test("current formal notification participates in status while real legacy deferred/no_response facts never close the IR", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const store = getMockLinkedOperationsStore();
    const state = store.read((current) => current);
    state.communicationEvents.push({
        id: "current-formal-notification",
        reportId: "inspection-report-demo-02",
        eventKind: "formal_report_notification",
        channel: "email",
        language: "en",
        target: "customer@example.test",
        message: "Please review the attached inspection report.",
        subject: "Inspection report",
        providerMode: "mock_email",
        providerResult: "accepted",
        providerReference: "mock-email-selector-fixture",
        actorId: "emp-003",
        actorName: "前台",
        recordedAt: "2026-08-18T12:00:00-05:00",
        mutationId: "current-formal-notification",
        fileName: "inspection-report-en.pdf",
      });
    state.communications.push({
        id: "legacy-communication-deferred",
        reportId: "inspection-report-demo-02",
        contentKind: "reply",
        channel: "in_person",
        target: "front desk",
        delivery: "delivered",
        response: "deferred",
        note: "legacy deferred remains unclassified",
        actorId: "emp-003",
        recordedAt: "2026-08-18T13:00:00-05:00",
      });
    state.communications.push({
        id: "legacy-communication-no-response",
        reportId: "inspection-report-demo-02",
        contentKind: "reply",
        channel: "sms",
        target: "+1 876 555 0101",
        delivery: "sent",
        response: "no_response",
        note: "legacy no response is not a reply",
        actorId: "emp-003",
        recordedAt: "2026-08-18T13:30:00-05:00",
      });
    const awaiting = deriveInspectionCommunicationSummary(state, "inspection-report-demo-02");
    expect(awaiting.communicationStatus).toBe("awaiting_reply");
    expect(awaiting.currentResponse).toBeNull();
    expect(awaiting.legacyCommunications.map((event: { id: string }) => event.id)).toEqual([
      "legacy-communication-deferred",
      "legacy-communication-no-response",
    ]);

    state.responseEvents.push({
        id: "current-classified-response",
        reportId: "inspection-report-demo-02",
        eventKind: "customer_response",
        recordedAt: "2026-08-18T14:00:00-05:00",
        actorId: "emp-003",
        actorName: "前台",
        result: "interested",
        note: "front desk classified",
        mutationId: "current-classified-response",
      });
    const closed = deriveInspectionCommunicationSummary(state, "inspection-report-demo-02");
    expect(closed.communicationStatus).toBe("closed");
    expect(closed.currentResponse).toBe("interested");
  } finally {
    restore();
  }
});

test("formal Email derives target, consumes the exact current PDF, and exact replay bypasses Blob/provider/revision", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryIrGeneratedFileRepository();
  const generated = await generateMockInspectionReportFiles({
    reportId: "inspection-report-demo-01",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "task7-email-files",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  const providerCalls: Array<{ idempotencyKey: string; target: string; fileName: string; bytes: number[] }> = [];
  const provider = {
    sendSms: async () => ({ providerReference: "unused" }),
    sendEmail: async (input: { idempotencyKey: string; target: string; fileName: string; bytes: Uint8Array }) => {
      providerCalls.push({ ...input, bytes: [...input.bytes] });
      return { providerReference: "mock-email-accepted-1" };
    },
  };
  const input = {
    reportId: "inspection-report-demo-01",
    expectedRevision: generated.revision,
    mutationId: "task7-email-send",
    channel: "email" as const,
    language: "en" as const,
    message: "Please review this inspection report and reply.",
    subject: "Your inspection report",
  };
  const first = await sendMockInspectionReportNotification(input, frontdeskActor, store, repository, provider);
  expect(first.replayed).toBe(false);
  expect(first.event).toMatchObject({
    eventKind: "formal_report_notification",
    channel: "email",
    language: "en",
    target: expect.stringMatching(/@/),
    providerMode: "mock_email",
    providerResult: "accepted",
    providerReference: "mock-email-accepted-1",
    actorId: frontdeskActor.id,
    actorName: frontdeskActor.name,
    recordedAt: expect.stringMatching(/-05:00$/),
    mutationId: input.mutationId,
  });
  expect(first.event).not.toHaveProperty("bundleId");
  expect(first.event).not.toHaveProperty("attachmentId");
  expect(first.event).not.toHaveProperty("version");
  expect(providerCalls).toEqual([expect.objectContaining({
    idempotencyKey: input.mutationId,
    target: first.event.target,
    fileName: first.event.fileName,
    bytes: [0x25, 0x50, 0x44, 0x46, 0x2d, 2, 1],
  })]);

  const replay = await sendMockInspectionReportNotification(input, frontdeskActor, store, {
    ...repository,
    readBundle: async () => { throw new Error("exact replay must not read generated Blob"); },
  }, {
    sendSms: async () => { throw new Error("exact replay must not call provider"); },
    sendEmail: async () => { throw new Error("exact replay must not call provider"); },
  });
  expect(replay).toEqual({ ...first, replayed: true });
  expect(store.read((state) => state.communicationEvents.filter((event) => event.id === first.event.id))).toHaveLength(1);
  await expect(sendMockInspectionReportNotification({ ...input, message: `${input.message} drift` }, frontdeskActor, store, repository, provider))
    .rejects.toMatchObject({ status: 409 });
});

test("a modern notification event cannot clone a committed mutation receipt under a new event id", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryIrGeneratedFileRepository();
  const generated = await generateMockInspectionReportFiles({
    reportId: "inspection-report-demo-01",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "task7-clone-event-files",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  await sendMockInspectionReportNotification({
    reportId: "inspection-report-demo-01",
    expectedRevision: generated.revision,
    mutationId: "task7-clone-event-send",
    channel: "sms",
    language: "zh",
    message: "请查看客户文件。",
  }, frontdeskActor, store, repository);
  const before = store.read((state) => state);
  await expect(store.mutate((state) => {
    const event = state.communicationEvents.find((candidate) => candidate.eventKind === "formal_report_notification")!;
    state.communicationEvents.push({ ...event, id: `${event.id}-clone` });
  })).rejects.toThrow(/IR_COMMUNICATION_EVENT_RECEIPT|IR_COMMUNICATION/);
  expect(store.read((state) => state)).toEqual(before);
});

test("WhatsApp confirmation is true in the committed intent and false tampering fails closed", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryIrGeneratedFileRepository();
  const generated = await generateMockInspectionReportFiles({
    reportId: "inspection-report-demo-01",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "task7-whatsapp-files",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  const sent = await sendMockInspectionReportNotification({
    reportId: "inspection-report-demo-01",
    expectedRevision: generated.revision,
    mutationId: "task7-whatsapp-send",
    channel: "whatsapp",
    language: "bilingual",
    message: "请查收 / Please review.",
    confirmedSent: true,
  }, frontdeskActor, store, repository);
  expect(sent.event).toMatchObject({ channel: "whatsapp", providerResult: "confirmed_sent" });
  const tampered = store.read((state) => state);
  const receiptIndex = tampered.mutationReceipts.findIndex((candidate) => candidate.mutationId === "task7-whatsapp-send");
  const receipt = tampered.mutationReceipts[receiptIndex];
  const payload = JSON.parse(receipt.payloadCanonical!) as Record<string, unknown>;
  payload.confirmedSent = false;
  const payloadCanonical = canonicalPayload(payload);
  tampered.mutationReceipts[receiptIndex] = {
    ...receipt,
    payloadCanonical,
    payloadHash: receiptPayloadHash(payloadCanonical),
  };
  expect(() => validateLinkedOperationsState(tampered)).toThrow(/IR_NOTIFICATION_RECEIPT|IR_COMMUNICATION_RECEIPT/);
});

test("stale notification and response errors expose the latest revision and communication summary without partial write", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryIrGeneratedFileRepository();
  const originalRevision = store.read((state) => state.revision);
  const generated = await generateMockInspectionReportFiles({
    reportId: "inspection-report-demo-01",
    expectedRevision: originalRevision,
    mutationId: "task7-stale-details-files",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  const beforeSend = store.read((state) => state);
  await expect(sendMockInspectionReportNotification({
    reportId: "inspection-report-demo-01",
    expectedRevision: originalRevision,
    mutationId: "task7-stale-details-send",
    channel: "sms",
    language: "zh",
    message: "stale",
  }, frontdeskActor, store, repository)).rejects.toMatchObject({
    status: 409,
    details: {
      code: "INSPECTION_COMMUNICATION_STALE",
      latestRevision: generated.revision,
      summary: { communicationStatus: "not_notified", currentResponse: null },
    },
  });
  expect(store.read((state) => state)).toEqual(beforeSend);

  const first = await recordMockInspectionCustomerResponse({
    reportId: "inspection-report-demo-01",
    expectedRevision: generated.revision,
    mutationId: "task7-stale-details-first-response",
    result: "interested",
    note: "first",
  }, frontdeskActor, store);
  const beforeStaleResponse = store.read((state) => state);
  await expect(recordMockInspectionCustomerResponse({
    reportId: "inspection-report-demo-01",
    expectedRevision: generated.revision,
    mutationId: "task7-stale-details-response",
    result: "not_interested",
    note: "stale",
  }, frontdeskActor, store)).rejects.toMatchObject({
    status: 409,
    details: {
      code: "INSPECTION_COMMUNICATION_STALE",
      latestRevision: first.revision,
      summary: { communicationStatus: "closed", currentResponse: "interested" },
    },
  });
  expect(store.read((state) => state)).toEqual(beforeStaleResponse);
});

test("client error mapping preserves closed stale communication details", () => {
  const details = {
    code: "INSPECTION_COMMUNICATION_STALE" as const,
    latestRevision: 23,
    summary: {
      communicationStatus: "awaiting_reply" as const,
      currentResponse: null,
      lastNotification: null,
      notificationHistory: [],
      responseHistory: [],
      legacyCommunications: [],
    },
  };
  expect(linkedApiError(new LinkedApiDomainError("Inspection Report 版本已变化，请刷新", 409, details), "fallback"))
    .toMatchObject({ status: 409, details });
});

test("provider acceptance followed by canonical write failure retries one idempotent delivery and one event", async () => {
  const restore = installBrowser(frontdesk, {
    failNext: { byAction: { "inspection.notification.send.write": "canonical write failed" } },
  });
  try {
    const store = getMockLinkedOperationsStore();
    const repository = createMemoryIrGeneratedFileRepository();
    const generated = await generateMockInspectionReportFiles({
      reportId: "inspection-report-demo-01",
      expectedRevision: store.read((state) => state.revision),
      mutationId: "task7-sms-files",
    }, frontdeskActor, store, repository, fakePdfRenderer());
    const attempts: string[] = [];
    const deliveries = new Map<string, string>();
    const provider = {
      sendEmail: async () => ({ providerReference: "unused" }),
      sendSms: async ({ idempotencyKey }: { idempotencyKey: string }) => {
        attempts.push(idempotencyKey);
        const providerReference = deliveries.get(idempotencyKey) ?? `mock-sms-${deliveries.size + 1}`;
        deliveries.set(idempotencyKey, providerReference);
        return { providerReference };
      },
    };
    const input = {
      reportId: "inspection-report-demo-01",
      expectedRevision: generated.revision,
      mutationId: "task7-sms-send-after-write-failure",
      channel: "sms" as const,
      language: "zh" as const,
      message: "请查看检查报告并回复。",
    };
    const before = store.read((state) => state);
    await expect(sendMockInspectionReportNotification(input, frontdeskActor, store, repository, provider))
      .rejects.toMatchObject({ status: 503 });
    expect(store.read((state) => state)).toEqual(before);
    const retried = await sendMockInspectionReportNotification(input, frontdeskActor, store, repository, provider);
    expect(attempts).toEqual([input.mutationId, input.mutationId]);
    expect(deliveries).toEqual(new Map([[input.mutationId, "mock-sms-1"]]));
    expect(retried.event).toMatchObject({ providerReference: "mock-sms-1", channel: "sms" });
    expect(store.read((state) => state.communicationEvents)).toHaveLength(1);
    expect(store.read((state) => state.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId))).toHaveLength(1);
  } finally {
    restore();
  }
});

test("notification closed input and missing/stale/corrupt/contact prerequisites fail before provider with zero canonical write", async () => {
  const providerCalls: string[] = [];
  const provider = {
    sendEmail: async () => { providerCalls.push("email"); return { providerReference: "unexpected" }; },
    sendSms: async () => { providerCalls.push("sms"); return { providerReference: "unexpected" }; },
  };
  const baseInput = {
    reportId: "inspection-report-demo-01",
    mutationId: "task7-prerequisite",
    channel: "sms" as const,
    language: "zh" as const,
    message: "请查看检查报告并回复。",
  };

  {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const before = store.read((state) => state);
    await expect(sendMockInspectionReportNotification({
      ...baseInput,
      expectedRevision: before.revision,
      target: "+1 876 spoofed",
    } as never, frontdeskActor, store, createMemoryIrGeneratedFileRepository(), provider)).rejects.toMatchObject({ status: 400 });
    expect(store.read((state) => state)).toEqual(before);
  }
  {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const before = store.read((state) => state);
    await expect(sendMockInspectionReportNotification({ ...baseInput, expectedRevision: before.revision }, frontdeskActor, store, createMemoryIrGeneratedFileRepository(), provider))
      .rejects.toMatchObject({ status: 409 });
    expect(store.read((state) => state)).toEqual(before);
  }
  {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const backend = new Map<string, IrGeneratedFileRecord>();
    const repository = createMemoryIrGeneratedFileRepository({ backend });
    const generated = await generateMockInspectionReportFiles({
      reportId: baseInput.reportId,
      expectedRevision: store.read((state) => state.revision),
      mutationId: "task7-corrupt-files",
    }, frontdeskActor, store, repository, fakePdfRenderer());
    const selected = [...backend.values()].find((record) => record.language === "zh")!;
    backend.set(selected.id, { ...selected, fileName: "tampered.pdf" });
    const before = store.read((state) => state);
    await expect(sendMockInspectionReportNotification({ ...baseInput, expectedRevision: generated.revision }, frontdeskActor, store, repository, provider))
      .rejects.toMatchObject({ status: 409 });
    expect(store.read((state) => state)).toEqual(before);
  }
  {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const repository = createMemoryIrGeneratedFileRepository();
    const generated = await generateMockInspectionReportFiles({
      reportId: baseInput.reportId,
      expectedRevision: store.read((state) => state.revision),
      mutationId: "task7-stale-files",
    }, frontdeskActor, store, repository, fakePdfRenderer());
    const detail = store.read((state) => {
      const report = state.inspectionReports.find((candidate) => candidate.id === baseInput.reportId)!;
      const quotation = state.currentQuotations.find((candidate) => candidate.id === report.quotationId)!;
      return { quotation, lines: quotation.lineIds.map((id) => state.quotedChargeLines.find((line) => line.id === id)!) };
    });
    const updated = await updateMockQuotation({
      reportId: baseInput.reportId,
      expectedRevision: generated.revision,
      mutationId: "task7-make-file-stale",
      noteZh: `${detail.quotation.noteZh} 已更新`,
      noteEn: detail.quotation.noteEn,
      lines: detail.lines.map(editableLine),
    }, frontdeskActor, store);
    const before = store.read((state) => state);
    await expect(sendMockInspectionReportNotification({ ...baseInput, expectedRevision: updated.revision }, frontdeskActor, store, repository, provider))
      .rejects.toMatchObject({ status: 409 });
    expect(store.read((state) => state)).toEqual(before);
  }
  {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const repository = createMemoryIrGeneratedFileRepository();
    const generated = await generateMockInspectionReportFiles({
      reportId: baseInput.reportId,
      expectedRevision: store.read((state) => state.revision),
      mutationId: "task7-no-email-files",
    }, frontdeskActor, store, repository, fakePdfRenderer());
    await store.mutate((state) => {
      const report = state.inspectionReports.find((candidate) => candidate.id === baseInput.reportId)!;
      state.customers.find((candidate) => candidate.id === report.customerId)!.email = null;
      state.revision += 1;
    });
    const before = store.read((state) => state);
    await expect(sendMockInspectionReportNotification({
      ...baseInput,
      expectedRevision: before.revision,
      mutationId: "task7-no-email-send",
      channel: "email",
      language: "en",
      subject: "Inspection report",
    }, frontdeskActor, store, repository, provider)).rejects.toMatchObject({ status: 409 });
    expect(store.read((state) => state)).toEqual(before);
    expect(generated.bundle).toBeTruthy();
  }
  expect(providerCalls).toEqual([]);
});

test("provider failure writes nothing, while response loss replays the committed notification without Blob/provider work", async () => {
  const restore = installBrowser(frontdesk, {
    failNext: { byAction: { "inspection.notification.send.response": "notification response lost" } },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const repository = createMemoryIrGeneratedFileRepository();
    const generated = await generateMockInspectionReportFiles({
      reportId: "inspection-report-demo-01",
      expectedRevision: store.read((state) => state.revision),
      mutationId: "task7-response-loss-files",
    }, frontdeskActor, store, repository, fakePdfRenderer());
    const failedBefore = store.read((state) => state);
    await expect(sendMockInspectionReportNotification({
      reportId: "inspection-report-demo-01",
      expectedRevision: generated.revision,
      mutationId: "task7-provider-failure",
      channel: "sms",
      language: "zh",
      message: "provider failure",
    }, frontdeskActor, store, repository, {
      sendEmail: async () => ({ providerReference: "unused" }),
      sendSms: async () => { throw new Error("mock provider rejected"); },
    })).rejects.toThrow("mock provider rejected");
    expect(store.read((state) => state)).toEqual(failedBefore);

    let deliveries = 0;
    const input = {
      reportId: "inspection-report-demo-01",
      expectedRevision: generated.revision,
      mutationId: "task7-notification-response-loss",
      channel: "sms" as const,
      language: "zh" as const,
      message: "response loss",
    };
    await expect(sendMockInspectionReportNotification(input, frontdeskActor, store, repository, {
      sendEmail: async () => ({ providerReference: "unused" }),
      sendSms: async () => { deliveries += 1; return { providerReference: "mock-sms-response-loss" }; },
    })).rejects.toMatchObject({ status: 503 });
    expect(deliveries).toBe(1);
    const committed = store.read((state) => state);
    expect(committed.communicationEvents).toHaveLength(1);
    expect(committed.mutationReceipts.filter((receipt) => receipt.mutationId === input.mutationId)).toHaveLength(1);
    const replay = await sendMockInspectionReportNotification(input, frontdeskActor, store, {
      ...repository,
      readBundle: async () => { throw new Error("replay must skip Blob"); },
    }, {
      sendEmail: async () => { throw new Error("replay must skip provider"); },
      sendSms: async () => { throw new Error("replay must skip provider"); },
    });
    expect(replay.replayed).toBe(true);
    expect(replay.event.providerReference).toBe("mock-sms-response-loss");
    expect(store.read((state) => state)).toEqual(committed);
  } finally {
    restore();
  }
});

test("Task7 routes capture invocation identity, keep finance read-only, and reject parts/anonymous without state changes", async () => {
  {
    const restore = installBrowser(finance);
    try {
      await expect(api.inspectionReports.list()).resolves.toMatchObject({ items: expect.any(Array) });
      const store = getMockLinkedOperationsStore();
      const before = store.read((state) => state);
      await expect(api.inspectionReports.recordResponse({
        reportId: "inspection-report-demo-01",
        expectedRevision: before.revision,
        mutationId: "task7-finance-forbidden",
        result: "interested",
        note: "finance cannot classify",
      })).rejects.toMatchObject({ status: 403 });
      expect(store.read((state) => state)).toEqual(before);
    } finally {
      restore();
    }
  }
  {
    const restore = installBrowser(parts);
    try {
      await expect(api.inspectionReports.list()).rejects.toMatchObject({ status: 403 });
    } finally {
      restore();
    }
  }
  {
    const restore = installBrowser(null);
    try {
      const request = api.inspectionReports.recordResponse({
        reportId: "inspection-report-demo-01",
        expectedRevision: 1,
        mutationId: "task7-anonymous-start",
        result: "interested",
        note: "must not inherit later admin",
      });
      window.localStorage.setItem("wh_session", JSON.stringify(frontdesk));
      await expect(request).rejects.toMatchObject({ status: 403 });
      expect(getMockLinkedOperationsStore().read((state) => state.responseEvents)).toEqual([]);
    } finally {
      restore();
    }
  }
  {
    const restore = installBrowser(frontdesk);
    try {
      const store = getMockLinkedOperationsStore();
      const before = store.read((state) => state);
      const request = api.inspectionReports.recordResponse({
        reportId: "inspection-report-demo-01",
        expectedRevision: before.revision,
        mutationId: "task7-authorized-session-switch",
        result: "interested",
        note: "late response cannot commit under old identity",
      });
      window.localStorage.removeItem("wh_session");
      await expect(request).rejects.toMatchObject({ status: 403 });
      expect(store.read((state) => state)).toEqual(before);
    } finally {
      restore();
    }
  }
});

test("generated PDF read captures invocation identity and rechecks it after the asynchronous Blob boundary", async () => {
  const restore = installBrowser(finance);
  const store = getMockLinkedOperationsStore();
  const repository = getIrGeneratedFileRepository();
  const generated = await generateMockInspectionReportFiles({
    reportId: "inspection-report-demo-01",
    expectedRevision: store.read((state) => state.revision),
    mutationId: `task7-finance-file-session-${Date.now()}`,
  }, frontdeskActor, store, repository, fakePdfRenderer());
  const originalReadBundle = repository.readBundle.bind(repository);
  let releaseRead!: () => void;
  let announceRead!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const readStarted = new Promise<void>((resolve) => { announceRead = resolve; });
  repository.readBundle = async (ids) => {
    const records = await originalReadBundle(ids);
    announceRead();
    await readGate;
    return records;
  };
  try {
    const request = api.inspectionReports.generatedFile("inspection-report-demo-01", "zh");
    await readStarted;
    window.localStorage.removeItem("wh_session");
    releaseRead();
    await expect(request).rejects.toMatchObject({ status: 403 });
    expect(store.read((state) => state.revision)).toBe(generated.revision);
  } finally {
    repository.readBundle = originalReadBundle;
    releaseRead?.();
    restore();
  }
});

test("notification rechecks captured request identity after the asynchronous generated-Blob boundary", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryIrGeneratedFileRepository();
  const generated = await generateMockInspectionReportFiles({
    reportId: "inspection-report-demo-01",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "task7-session-blob-files",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  let releaseRead!: () => void;
  let announceRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { announceRead = resolve; });
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  let sameIdentity = true;
  let providerCalls = 0;
  const before = store.read((state) => state);
  const request = sendMockInspectionReportNotification({
    reportId: "inspection-report-demo-01",
    expectedRevision: generated.revision,
    mutationId: "task7-session-switch-during-blob",
    channel: "sms",
    language: "zh",
    message: "must not commit after identity changes",
  }, frontdeskActor, store, {
    ...repository,
    readBundle: async (ids) => {
      announceRead();
      await readGate;
      return repository.readBundle(ids);
    },
  }, {
    sendEmail: async () => ({ providerReference: "unused" }),
    sendSms: async () => { providerCalls += 1; return { providerReference: "unexpected" }; },
  }, () => {
    if (!sameIdentity) throw new LinkedApiDomainError("request identity changed", 403);
  });
  await readStarted;
  sameIdentity = false;
  releaseRead();
  await expect(request).rejects.toMatchObject({ status: 403 });
  expect(providerCalls).toBe(0);
  expect(store.read((state) => state)).toEqual(before);
});

test("classified responses append and revision points only to the immediately current response", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const first = await recordMockInspectionCustomerResponse({
    reportId: "inspection-report-demo-01",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "task7-response-first",
    result: "interested",
    note: "Customer plans to return.",
  }, frontdeskActor, store);
  expect(first.event.supersedesEventId).toBeUndefined();
  const revised = await recordMockInspectionCustomerResponse({
    reportId: "inspection-report-demo-01",
    expectedRevision: first.revision,
    mutationId: "task7-response-revision",
    result: "not_interested",
    note: "Customer later declined.",
  }, frontdeskActor, store);
  expect(revised.event.supersedesEventId).toBe(first.event.id);
  expect(deriveInspectionCommunicationSummary(store.read((state) => state), "inspection-report-demo-01")).toMatchObject({
    communicationStatus: "closed",
    currentResponse: "not_interested",
  });
  await expect(recordMockInspectionCustomerResponse({
    reportId: "inspection-report-demo-01",
    expectedRevision: first.revision,
    mutationId: "task7-response-invalid-chain",
    result: "interested",
    note: "stale concurrent revision",
  }, frontdeskActor, store)).rejects.toMatchObject({ status: 409 });
  expect(store.read((state) => state.responseEvents)).toHaveLength(2);
  await expect(recordMockInspectionCustomerResponse({
    reportId: "inspection-report-demo-01",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "task7-response-first",
    result: "interested",
    note: "payload drift",
  }, frontdeskActor, store)).rejects.toMatchObject({ status: 409 });
});

test("canonical append order outranks future legacy clocks and remains the supersedes predecessor", async () => {
  const recordedAt = "2099-08-21T10:00:00-05:00";
  const scenario = { nowMs: Date.parse("2026-08-21T10:00:00-05:00") };
  const restore = installBrowser(frontdesk, scenario);
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    await store.mutate((state) => {
      state.communications.push({
        id: "task7-same-ms-legacy-declined",
        reportId: "inspection-report-demo-01",
        contentKind: "report",
        channel: "in_person",
        target: "+1 876-555-0101",
        delivery: "delivered",
        response: "declined",
        note: "legacy answer with a future clock",
        actorId: "emp-003",
        recordedAt,
      });
      state.revision += 1;
    });
    const repository = createMemoryIrGeneratedFileRepository();
    const generated = await generateMockInspectionReportFiles({
      reportId: "inspection-report-demo-01",
      expectedRevision: store.read((state) => state.revision),
      mutationId: "task7-same-ms-files",
    }, frontdeskActor, store, repository, fakePdfRenderer());
    const notification = await sendMockInspectionReportNotification({
      reportId: "inspection-report-demo-01",
      expectedRevision: generated.revision,
      mutationId: "task7-same-ms-notification",
      channel: "sms",
      language: "zh",
      message: "current notification",
    }, frontdeskActor, store, repository, {
      sendEmail: async () => ({ providerReference: "unused" }),
      sendSms: async () => ({ providerReference: "task7-same-ms-sms" }),
    });
    const afterNotification = deriveInspectionCommunicationSummary(store.read((state) => state), "inspection-report-demo-01");
    expect(afterNotification.lastNotification).toMatchObject({
      id: notification.event.id,
      channel: "sms",
    });
    expect(afterNotification.notificationHistory.map((event) => event.id).at(-1)).toBe(notification.event.id);
    const first = await recordMockInspectionCustomerResponse({
      reportId: "inspection-report-demo-01",
      expectedRevision: notification.revision,
      mutationId: "task7-same-ms-current-first",
      result: "interested",
      note: "current answer",
    }, frontdeskActor, store);
    expect(first.event.supersedesEventId).toBe("task7-same-ms-legacy-declined");
    const afterFirst = deriveInspectionCommunicationSummary(store.read((state) => state), "inspection-report-demo-01");
    expect(afterFirst.currentResponse).toBe("interested");
    expect(afterFirst.responseHistory.map((event) => event.id).at(-1)).toBe(first.event.id);
    scenario.nowMs = Date.parse("2026-08-21T09:00:00-05:00");
    const second = await recordMockInspectionCustomerResponse({
      reportId: "inspection-report-demo-01",
      expectedRevision: first.revision,
      mutationId: "task7-same-ms-current-second",
      result: "not_interested",
      note: "new current answer",
    }, frontdeskActor, store);
    expect(second.event.supersedesEventId).toBe(first.event.id);
    const afterSecond = deriveInspectionCommunicationSummary(store.read((state) => state), "inspection-report-demo-01");
    expect(afterSecond.currentResponse).toBe("not_interested");
    expect(afterSecond.responseHistory.map((event) => event.id).slice(-2)).toEqual([first.event.id, second.event.id]);
  } finally {
    restore();
  }
});

test("concurrent response intents at one revision have one winner and one stale loser", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const expectedRevision = store.read((state) => state.revision);
  const attempts = await Promise.allSettled([
    recordMockInspectionCustomerResponse({
      reportId: "inspection-report-demo-01",
      expectedRevision,
      mutationId: "task7-concurrent-response-a",
      result: "interested",
      note: "A",
    }, frontdeskActor, store),
    recordMockInspectionCustomerResponse({
      reportId: "inspection-report-demo-01",
      expectedRevision,
      mutationId: "task7-concurrent-response-b",
      result: "not_interested",
      note: "B",
    }, frontdeskActor, store),
  ]);
  expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(attempts.filter((result) => result.status === "rejected")).toEqual([
    expect.objectContaining({ reason: expect.objectContaining({ status: 409 }) }),
  ]);
  expect(store.read((state) => state.responseEvents)).toHaveLength(1);
  expect(store.read((state) => state.mutationReceipts.filter((receipt) => receipt.operation === "inspection.response.record"))).toHaveLength(1);
});

test("response-loss retry returns the first classified response without a duplicate event", async () => {
  const restore = installBrowser(frontdesk, {
    failNext: { byAction: { "inspection.response.record.response": "response classification response lost" } },
  });
  try {
    const store = createMockLinkedOperationsStore(memoryStorage());
    const input = {
      reportId: "inspection-report-demo-01",
      expectedRevision: store.read((state) => state.revision),
      mutationId: "task7-classification-response-loss",
      result: "interested" as const,
      note: "customer plans to return",
    };
    await expect(recordMockInspectionCustomerResponse(input, frontdeskActor, store)).rejects.toMatchObject({ status: 503 });
    const committed = store.read((state) => state);
    expect(committed.responseEvents).toHaveLength(1);
    const replay = await recordMockInspectionCustomerResponse(input, frontdeskActor, store);
    expect(replay.replayed).toBe(true);
    expect(replay.event).toEqual(committed.responseEvents[0]);
    expect(store.read((state) => state)).toEqual(committed);
  } finally {
    restore();
  }
});

test("a new classified response supersedes the latest classified legacy communication", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  await store.mutate((state) => {
    state.communications.push({
      id: "legacy-declined-before-task7",
      reportId: "inspection-report-demo-02",
      contentKind: "reply",
      channel: "in_person",
      target: "+1 876 555 0102",
      delivery: "delivered",
      response: "declined",
      note: "customer originally declined",
      actorId: "emp-003",
      recordedAt: "2026-08-20T10:00:00-05:00",
    });
    state.revision += 1;
  });
  const result = await recordMockInspectionCustomerResponse({
    reportId: "inspection-report-demo-02",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "task7-response-after-legacy",
    result: "interested",
    note: "customer changed their mind",
  }, frontdeskActor, store);
  expect(result.event.supersedesEventId).toBe("legacy-declined-before-task7");
  expect(deriveInspectionCommunicationSummary(store.read((state) => state), "inspection-report-demo-02").currentResponse).toBe("interested");
});

test("current notification/response events and receipts are inverse-closed and response chains reject tampering", async () => {
  const store = createMockLinkedOperationsStore(memoryStorage());
  const repository = createMemoryIrGeneratedFileRepository();
  const generated = await generateMockInspectionReportFiles({
    reportId: "inspection-report-demo-01",
    expectedRevision: store.read((state) => state.revision),
    mutationId: "task7-inverse-files",
  }, frontdeskActor, store, repository, fakePdfRenderer());
  const notification = await sendMockInspectionReportNotification({
    reportId: "inspection-report-demo-01",
    expectedRevision: generated.revision,
    mutationId: "task7-inverse-notification",
    channel: "sms",
    language: "bilingual",
    message: "请查看检查报告并回复。 Please review and reply.",
  }, frontdeskActor, store, repository, {
    sendEmail: async () => ({ providerReference: "unused" }),
    sendSms: async () => ({ providerReference: "mock-sms-inverse" }),
  });
  const whatsappNotification = await sendMockInspectionReportNotification({
    reportId: "inspection-report-demo-01",
    expectedRevision: notification.revision,
    mutationId: "task7-inverse-notification-whatsapp",
    channel: "whatsapp",
    language: "zh",
    message: "WhatsApp 二次通知。",
    confirmedSent: true,
  }, frontdeskActor, store, repository);
  const firstResponse = await recordMockInspectionCustomerResponse({
    reportId: "inspection-report-demo-01",
    expectedRevision: whatsappNotification.revision,
    mutationId: "task7-inverse-response-1",
    result: "interested",
    note: "returning",
  }, frontdeskActor, store);
  await recordMockInspectionCustomerResponse({
    reportId: "inspection-report-demo-01",
    expectedRevision: firstResponse.revision,
    mutationId: "task7-inverse-response-2",
    result: "not_interested",
    note: "declined",
  }, frontdeskActor, store);
  const archiveGroup = getMockVehicleInspectionReportArchive(
    store.read((state) => state.inspectionReports.find((report) => report.id === "inspection-report-demo-01")!.vehicleId),
    store,
  ).find((group) => group.reportId === "inspection-report-demo-01");
  expect(archiveGroup?.notificationHistory.map((event) => ({
    id: event.id,
    channel: event.channel,
    message: event.message,
    providerResult: event.providerResult,
  }))).toEqual([
    {
      id: notification.event.id,
      channel: "sms",
      message: "请查看检查报告并回复。 Please review and reply.",
      providerResult: "accepted",
    },
    {
      id: whatsappNotification.event.id,
      channel: "whatsapp",
      message: "WhatsApp 二次通知。",
      providerResult: "confirmed_sent",
    },
  ]);
  expect(archiveGroup?.responseHistory.map((event) => ({
    id: event.id,
    result: event.result,
    note: event.note,
    supersedesEventId: event.supersedesEventId,
  }))).toEqual([
    { id: firstResponse.event.id, result: "interested", note: "returning", supersedesEventId: null },
    {
      id: `ir-response-${encodeURIComponent("task7-inverse-response-2")}`,
      result: "not_interested",
      note: "declined",
      supersedesEventId: firstResponse.event.id,
    },
  ]);
  const canonical = store.read((state) => state);

  for (const tamper of [
    (state: any) => { state.mutationReceipts = state.mutationReceipts.filter((receipt: any) => receipt.mutationId !== "task7-inverse-notification"); },
    (state: any) => { state.communicationEvents = state.communicationEvents.filter((event: any) => event.mutationId !== "task7-inverse-notification"); },
    (state: any) => { state.mutationReceipts.find((receipt: any) => receipt.mutationId === "task7-inverse-response-1").result.event.note = "receipt drift"; },
    (state: any) => { state.responseEvents.at(-1).supersedesEventId = "ir-response-task7-inverse-response-2"; },
  ]) {
    await expect(store.mutate((state) => {
      tamper(state);
      state.revision += 1;
    })).rejects.toMatchObject({ status: 500 });
    expect(store.read((state) => state)).toEqual(canonical);
  }
});

test("retired communications writer returns 410 and never appends to the legacy array", async () => {
  const restore = installBrowser(frontdesk);
  try {
    const before = await api.inspectionReports.detail("inspection-report-demo-01");
    const canonical = getMockLinkedOperationsStore().read((state) => state);
    await expect(api.inspectionReports.recordCommunication({
      reportId: before.id,
      expectedRevision: before.revision,
      expectedSourceVersion: before.sourceVersion,
      channel: "email",
      target: "customer@example.com",
      delivery: "delivered",
      response: "deferred",
      followupDate: "2026-08-20",
      note: "retired writer must not append",
    })).rejects.toMatchObject({ status: 410 });
    expect(getMockLinkedOperationsStore().read((state) => state)).toEqual(canonical);
  } finally {
    restore();
  }
});

test("IR 读权限复用现有会话能力，财务可读但越权写和无会话读取都拒绝", async () => {
  const restoreFinance = installBrowser(finance);
  try {
    const detail = await api.inspectionReports.detail("inspection-report-demo-01");
    await expect(api.inspectionReports.recordResponse({
      reportId: detail.id,
      expectedRevision: detail.revision,
      mutationId: "finance-forbidden-response",
      result: "interested",
      note: "越权",
    })).rejects.toThrow(/无权|前台/);
  } finally {
    restoreFinance();
  }

  for (const denied of [null, parts]) {
    const restore = installBrowser(denied);
    try {
      await expect(api.inspectionReports.list()).rejects.toThrow(/无权/);
    } finally {
      restore();
    }
  }
});

test("IR scenario 支持慢读、一次性读失败和一次性写失败后重试", async () => {
  const restore = installBrowser(frontdesk, {
    delayMs: { read: 25 },
    failNext: { read: "可重试 IR 读取故障", write: "可重试 IR 写入故障" },
  });
  try {
    await expect(api.inspectionReports.list()).rejects.toThrow("Inspection Report 查询失败");
    const report = await api.inspectionReports.detail("inspection-report-demo-01");
    const input = {
      reportId: report.id,
      expectedRevision: report.revision,
      mutationId: "task7-retry-write-failure",
      result: "interested" as const,
      note: "客户计划回厂",
    };
    await expect(api.inspectionReports.recordResponse(input)).rejects.toThrow("客户回应记录失败");
    expect((await api.inspectionReports.detail(report.id)).responseHistory).toHaveLength(0);
    await expect(api.inspectionReports.recordResponse(input)).resolves.toMatchObject({ event: { result: "interested" } });
  } finally {
    restore();
  }
});

test("IR API 保留 404/409/400/503，scoped detail 故障不被 list 消费", async () => {
  const restore = installBrowser(frontdesk, {
    failNext: { byAction: { "inspection.detail.read": "IR 详情短暂读取故障" } },
  });
  try {
    await expect(api.inspectionReports.list()).resolves.toBeTruthy();
    await expect(api.inspectionReports.detail("inspection-report-demo-01"))
      .rejects.toMatchObject({ status: 503 });
    const report = await api.inspectionReports.detail("inspection-report-demo-01");
    await expect(api.inspectionReports.recordResponse({
      reportId: report.id,
      expectedRevision: report.revision + 1,
      mutationId: "task7-stale-response",
      result: "interested",
      note: "stale",
    })).rejects.toMatchObject({ status: 409 });
    await expect(api.inspectionReports.detail("inspection-report-missing"))
      .rejects.toMatchObject({ status: 404 });
    await expect(api.inspectionReports.recordResponse({
      reportId: report.id,
      expectedRevision: report.revision,
      mutationId: "task7-invalid-response",
      result: "deferred",
      note: "invalid result",
    } as never)).rejects.toMatchObject({ status: 400 });
  } finally {
    restore();
  }
});
