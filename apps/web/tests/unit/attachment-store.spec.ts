import { expect, test } from "@playwright/test";
import {
  IR_REPORT_PHOTOS_DB_NAME,
  IR_REPORT_PHOTOS_STORE_NAME,
  createIndexedDbReportPhotoRepository,
  createMemoryReportPhotoRepository,
  inspectReportPhotoFile,
  resolveVerifiedReportPhoto,
  type ReportPhotoBlobRecord,
} from "../../src/lib/attachments/indexeddb-attachment-store";

const PNG_1X1 = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));

const JPEG_2X1 = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x02, 0x03,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
  0x00,
  0xff, 0xd9,
]);

const WEBP_3X2 = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x00,
  0x01, 0x00, 0x00,
  0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00,
  0x2f, 0x02, 0x40, 0x00, 0x00, 0x00,
]);

const WEBP_LOSSLESS_1X1 = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00,
  0x2f, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const WEBP_LOSSY_2X3 = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20, 0x0a, 0x00, 0x00, 0x00,
  0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x02, 0x00, 0x03, 0x00,
]);

const JPEG_SOF_WITHOUT_SCAN = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x02, 0x03,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  0xff, 0xd9,
]);
const WEBP_VP8X_WITHOUT_IMAGE_CHUNK = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x00,
  0x01, 0x00, 0x00,
]);

const WEBP_VP8X_LOSSLESS_ALPHA_1X1 = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00,
  0x10, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00,
  0x00, 0x00, 0x00,
  0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00,
  0x2f, 0x00, 0x00, 0x00, 0x10, 0x00,
]);

const WEBP_ANIMATED_1X1 = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x4a, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00,
  0x00, 0x00, 0x00,
  0x41, 0x4e, 0x49, 0x4d, 0x06, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x41, 0x4e, 0x4d, 0x46, 0x1e, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00,
  0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00,
  0x2f, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function asFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes], name, { type });
}

function record(
  id: string,
  inspected: Awaited<ReturnType<typeof inspectReportPhotoFile>>,
): ReportPhotoBlobRecord {
  return {
    id,
    reportId: "inspection-report-demo-01",
    vehicleId: "VEH-UAT-002",
    ...inspected,
  };
}

type StrictFailure = { kind: "sync" | "async"; index: number; error: Error };

function strictIndexedDbFactory() {
  const records = new Map<string, ReportPhotoBlobRecord>();
  const events: string[] = [];
  let storeExists = false;
  let nextFailure: StrictFailure | null = null;
  let abortCalls = 0;

  const request = <T,>() => ({
    result: undefined as T,
    error: null as DOMException | null,
    onsuccess: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
  });

  const makeTransaction = (mode: IDBTransactionMode) => {
    let active = true;
    let yielded = false;
    let handlingRequest = false;
    let pending = 0;
    let writeIndex = 0;
    let completionQueued = false;
    const staged = new Map(records);
    const originalIds = new Set(records.keys());
    const exclusiveAddedIds = new Set<string>();
    const tx = {
      error: null as DOMException | null,
      oncomplete: null as ((event: Event) => void) | null,
      onabort: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      abort() {
        if (!active) return;
        abortCalls += 1;
        active = false;
        queueMicrotask(() => tx.onabort?.({} as Event));
      },
      objectStore(name: string) {
        events.push(`store:${mode}:${name}`);
        if (name !== IR_REPORT_PHOTOS_STORE_NAME) throw new Error("unexpected store");
        const completeWhenIdle = () => {
          if (!active || pending !== 0 || completionQueued) return;
          completionQueued = true;
          queueMicrotask(() => {
            if (!active || pending !== 0) return;
            if ([...exclusiveAddedIds].some((id) => records.has(id) && !originalIds.has(id))) {
              tx.error = new DOMException("stable ID already won by another transaction", "ConstraintError");
              active = false;
              tx.onabort?.({} as Event);
              return;
            }
            active = false;
            if (mode === "readwrite") {
              records.clear();
              for (const [id, value] of staged) records.set(id, structuredClone(value));
            }
            tx.oncomplete?.({} as Event);
          });
        };
        const read = <T,>(value: T) => {
          const candidate = request<T>();
          pending += 1;
          queueMicrotask(() => {
            if (!active) return;
            candidate.result = structuredClone(value);
            handlingRequest = true;
            try {
              candidate.onsuccess?.({} as Event);
            } finally {
              handlingRequest = false;
            }
            pending -= 1;
            completeWhenIdle();
          });
          return candidate;
        };
        const write = (value: ReportPhotoBlobRecord, exclusive: boolean) => {
          if (!active || (yielded && !handlingRequest)) throw new Error("transaction auto-closed before synchronous enqueue");
          const index = writeIndex;
          writeIndex += 1;
          if (nextFailure?.kind === "sync" && nextFailure.index === index) {
            const failure = nextFailure.error;
            nextFailure = null;
            throw failure;
          }
          const candidate = request<IDBValidKey>();
          pending += 1;
          if (exclusive) exclusiveAddedIds.add(value.id);
          staged.set(value.id, structuredClone(value));
          queueMicrotask(() => {
            if (!active) return;
            if (exclusive && records.has(value.id) && !originalIds.has(value.id)) {
              tx.error = new DOMException("stable ID already won by another transaction", "ConstraintError");
              active = false;
              tx.onabort?.({} as Event);
              return;
            }
            if (nextFailure?.kind === "async" && nextFailure.index === index) {
              const failure = nextFailure.error;
              nextFailure = null;
              tx.error = new DOMException(failure.message, "AbortError");
              active = false;
              tx.onabort?.({} as Event);
              return;
            }
            candidate.result = value.id;
            handlingRequest = true;
            try {
              candidate.onsuccess?.({} as Event);
            } finally {
              handlingRequest = false;
            }
            pending -= 1;
            completeWhenIdle();
          });
          return candidate;
        };
        return {
          get: (id: string) => read(staged.get(id)),
          getAll: () => read([...staged.values()]),
          getAllKeys: () => read([...staged.keys()]),
          put: (value: ReportPhotoBlobRecord) => write(value, false),
          add: (value: ReportPhotoBlobRecord) => write(value, true),
          delete: (id: string) => {
            if (!active || (yielded && !handlingRequest)) throw new Error("transaction auto-closed before synchronous delete");
            staged.delete(id);
            const candidate = request<undefined>();
            pending += 1;
            queueMicrotask(() => {
              if (!active) return;
              candidate.result = undefined;
              candidate.onsuccess?.({} as Event);
              pending -= 1;
              completeWhenIdle();
            });
            return candidate;
          },
        };
      },
    };
    queueMicrotask(() => { yielded = true; });
    return tx;
  };

  const database = {
    objectStoreNames: { contains: (name: string) => storeExists && name === IR_REPORT_PHOTOS_STORE_NAME },
    createObjectStore(name: string) {
      events.push(`create:${name}`);
      storeExists = true;
      return {};
    },
    transaction(name: string, mode: IDBTransactionMode) {
      events.push(`tx:${mode}:${name}`);
      if (name !== IR_REPORT_PHOTOS_STORE_NAME) throw new Error("unexpected transaction store");
      return makeTransaction(mode);
    },
    close() { events.push("close"); },
  };

  const factory = {
    open(name: string) {
      events.push(`open:${name}`);
      if (name !== IR_REPORT_PHOTOS_DB_NAME) throw new Error("unexpected database");
      const candidate = request<IDBDatabase>();
      queueMicrotask(() => {
        candidate.result = database as unknown as IDBDatabase;
        if (!storeExists) candidate.onupgradeneeded?.({} as IDBVersionChangeEvent);
        candidate.onsuccess?.({} as Event);
      });
      return candidate;
    },
  } as unknown as IDBFactory;

  return {
    factory,
    records,
    events,
    get abortCalls() { return abortCalls; },
    failNext(failure: StrictFailure) { nextFailure = failure; },
  };
}

function trackedThreeDatabaseFactory() {
  const photo = strictIndexedDbFactory();
  const opens: string[] = [];
  const deletes: string[] = [];
  const foreignDatabases = new Map<string, Map<string, Map<string, Uint8Array>>>([
    ["wh_linked_operations_assets_v1", new Map([
      ["migrationProtection", new Map([["task2-sentinel", Uint8Array.from([0x54, 0x32, 0x00, 0xff])]])],
    ])],
    ["wh_ir_generated_files_v1", new Map([
      ["files", new Map([["task5-sentinel", Uint8Array.from([0x54, 0x35, 0x01, 0xfe])]])],
    ])],
  ]);
  const request = <T,>() => ({
    result: undefined as T,
    error: null as DOMException | null,
    onsuccess: null as ((event: Event) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
  });
  const foreignDatabase = (name: string, stores: Map<string, Map<string, Uint8Array>>) => ({
    name,
    objectStoreNames: { contains: (storeName: string) => stores.has(storeName) },
    createObjectStore: () => { throw new Error(`unexpected upgrade of ${name}`); },
    transaction: () => { throw new Error(`unexpected transaction in ${name}`); },
    close() {},
  });
  const factory = {
    open(name: string, version?: number) {
      opens.push(`${name}@${version ?? "current"}`);
      if (name === IR_REPORT_PHOTOS_DB_NAME) return photo.factory.open(name, version);
      const stores = foreignDatabases.get(name);
      if (!stores) throw new Error(`unexpected database ${name}`);
      const candidate = request<IDBDatabase>();
      queueMicrotask(() => {
        candidate.result = foreignDatabase(name, stores) as unknown as IDBDatabase;
        candidate.onsuccess?.({} as Event);
      });
      return candidate;
    },
    deleteDatabase(name: string) {
      deletes.push(name);
      const candidate = request<undefined>();
      queueMicrotask(() => candidate.onsuccess?.({} as Event));
      return candidate;
    },
  } as unknown as IDBFactory;
  const snapshotForeign = () => [...foreignDatabases].map(([databaseName, stores]) => [
    databaseName,
    [...stores].map(([storeName, rows]) => [
      storeName,
      [...rows].map(([id, bytes]) => [id, [...bytes]]),
    ]),
  ]);
  return { factory, photo, opens, deletes, snapshotForeign };
}

test("photo repository is physically isolated from migration protection and generated PDF stores", () => {
  expect(IR_REPORT_PHOTOS_DB_NAME).toBe("wh_ir_report_photos_v1");
  expect(IR_REPORT_PHOTOS_STORE_NAME).toBe("photos");
  expect(IR_REPORT_PHOTOS_DB_NAME).not.toBe("wh_linked_operations_assets_v1");
  expect(IR_REPORT_PHOTOS_DB_NAME).not.toBe("wh_ir_generated_files_v1");
});

test("one tracked IndexedDB factory leaves pre-existing Task2 and Task5 rows byte-identical across photo write read and cleanup", async () => {
  const tracked = trackedThreeDatabaseFactory();
  const before = tracked.snapshotForeign();
  const repository = createIndexedDbReportPhotoRepository(tracked.factory, async () => ({ usage: 0, quota: 100_000 }));
  const keep = record("three-db-keep", await inspectReportPhotoFile(asFile(PNG_1X1, "keep.png", "image/png")));
  const remove = record("three-db-remove", await inspectReportPhotoFile(asFile(JPEG_2X1, "remove.jpg", "image/jpeg")));

  await repository.writeBatch([keep, remove]);
  expect((await repository.read(keep.id))?.sha256).toBe(keep.sha256);
  await repository.cleanupExceptIds([keep.id]);

  expect((await repository.list()).map((item) => item.id)).toEqual([keep.id]);
  expect(tracked.opens.length).toBeGreaterThan(0);
  expect(tracked.opens.every((name) => name.startsWith(`${IR_REPORT_PHOTOS_DB_NAME}@`))).toBe(true);
  expect(tracked.deletes).toEqual([]);
  expect(tracked.photo.events.filter((event) => event.startsWith("create:"))).toEqual([
    `create:${IR_REPORT_PHOTOS_STORE_NAME}`,
  ]);
  expect(tracked.snapshotForeign()).toEqual(before);
});

test("JPEG PNG and WebP are detected from exact bytes despite lying extension and MIME", async () => {
  const inspected = await Promise.all([
    inspectReportPhotoFile(asFile(JPEG_2X1, "camera.txt", "image/png")),
    inspectReportPhotoFile(asFile(PNG_1X1, "diagram.jpeg", "text/plain")),
    inspectReportPhotoFile(asFile(WEBP_3X2, "photo.png", "image/jpeg")),
  ]);

  expect(inspected.map(({ detectedMediaType, widthPx, heightPx, byteLength }) => ({
    detectedMediaType, widthPx, heightPx, byteLength,
  }))).toEqual([
    { detectedMediaType: "image/jpeg", widthPx: 2, heightPx: 1, byteLength: JPEG_2X1.byteLength },
    { detectedMediaType: "image/png", widthPx: 1, heightPx: 1, byteLength: PNG_1X1.byteLength },
    { detectedMediaType: "image/webp", widthPx: 3, heightPx: 2, byteLength: WEBP_3X2.byteLength },
  ]);
  expect(inspected.every((item) => /^sha256-bytes-v1:[a-f0-9]{64}$/.test(item.sha256))).toBe(true);
  expect(await inspected[0].blob.arrayBuffer()).toEqual(JPEG_2X1.buffer);
  expect(await inspected[1].blob.arrayBuffer()).toEqual(PNG_1X1.buffer);
  expect(await inspected[2].blob.arrayBuffer()).toEqual(WEBP_3X2.buffer);
});

test("invalid member and quota failure reject a whole batch without changing existing records", async () => {
  const repository = createMemoryReportPhotoRepository({
    estimateStorage: async () => ({ usage: 0, quota: 10_000 }),
  });
  const existing = record("ir-photo-existing", await inspectReportPhotoFile(asFile(PNG_1X1, "existing.png", "image/png")));
  await repository.writeBatch([existing]);
  const before = await repository.list();

  await expect(inspectReportPhotoFile(asFile(new Uint8Array([0x89, 0x50, 0x4e]), "truncated.png", "image/png")))
    .rejects.toThrow(/格式|signature|image/iu);
  expect(await repository.list()).toEqual(before);

  repository.setStorageEstimate({ usage: 99, quota: 100 });
  const next = record("ir-photo-next", await inspectReportPhotoFile(asFile(PNG_1X1, "next.png", "image/png")));
  await expect(repository.writeBatch([next])).rejects.toThrow(/空间|quota|storage/iu);
  expect(await repository.list()).toEqual(before);
});

test("duplicate bytes keep ordered occurrence IDs and injected mid-batch failure is atomic", async () => {
  const repository = createMemoryReportPhotoRepository({
    estimateStorage: async () => ({ usage: 0, quota: 100_000 }),
  });
  const first = record("ir-photo-001", await inspectReportPhotoFile(asFile(PNG_1X1, "first.png", "image/png")));
  const duplicate = record("ir-photo-002", await inspectReportPhotoFile(asFile(PNG_1X1, "duplicate.png", "image/png")));
  await repository.writeBatch([first, duplicate]);

  expect((await repository.list()).map((item) => item.id)).toEqual(["ir-photo-001", "ir-photo-002"]);
  expect(first.sha256).toBe(duplicate.sha256);
  expect(await (await repository.read(first.id))?.blob.arrayBuffer()).toEqual(PNG_1X1.buffer);

  repository.failNextWriteAt(1, new Error("mid-batch transaction failed"));
  const third = record("ir-photo-003", await inspectReportPhotoFile(asFile(JPEG_2X1, "third.jpg", "image/jpeg")));
  const fourth = record("ir-photo-004", await inspectReportPhotoFile(asFile(WEBP_3X2, "fourth.webp", "image/webp")));
  await expect(repository.writeBatch([third, fourth])).rejects.toThrow("mid-batch transaction failed");
  expect((await repository.list()).map((item) => item.id)).toEqual(["ir-photo-001", "ir-photo-002"]);
});

test("all WebP dimension branches are strict and malformed RIFF PNG and JPEG boundaries are rejected", async () => {
  const [lossy, lossless] = await Promise.all([
    inspectReportPhotoFile(asFile(WEBP_LOSSY_2X3, "lossy.webp", "image/webp")),
    inspectReportPhotoFile(asFile(WEBP_LOSSLESS_1X1, "lossless.webp", "image/webp")),
  ]);
  expect([lossy.widthPx, lossy.heightPx, lossless.widthPx, lossless.heightPx]).toEqual([2, 3, 1, 1]);

  const badRiff = WEBP_3X2.slice();
  badRiff[4] = 0;
  await expect(inspectReportPhotoFile(asFile(badRiff, "bad-riff.webp", "image/webp"))).rejects.toThrow(/WebP|结构/iu);

  const badVp8xReserved = WEBP_3X2.slice();
  badVp8xReserved[21] = 1;
  await expect(inspectReportPhotoFile(asFile(badVp8xReserved, "reserved.webp", "image/webp"))).rejects.toThrow(/WebP|结构/iu);
  const badVp8lVersion = WEBP_LOSSLESS_1X1.slice();
  badVp8lVersion[24] = 0xe0;
  await expect(inspectReportPhotoFile(asFile(badVp8lVersion, "version.webp", "image/webp"))).rejects.toThrow(/WebP|结构/iu);
  const interFrameVp8 = WEBP_LOSSY_2X3.slice();
  interFrameVp8[20] = 1;
  await expect(inspectReportPhotoFile(asFile(interFrameVp8, "inter-frame.webp", "image/webp"))).rejects.toThrow(/WebP|结构/iu);

  const zeroPng = PNG_1X1.slice();
  zeroPng.fill(0, 16, 20);
  await expect(inspectReportPhotoFile(asFile(zeroPng, "zero.png", "image/png"))).rejects.toThrow(/尺寸/iu);

  const wrongIhdr = PNG_1X1.slice();
  wrongIhdr[15] = 0;
  await expect(inspectReportPhotoFile(asFile(wrongIhdr, "wrong-ihdr.png", "image/png"))).rejects.toThrow(/PNG|结构/iu);
  await expect(inspectReportPhotoFile(asFile(PNG_1X1.slice(0, 24), "truncated-ihdr.png", "image/png"))).rejects.toThrow(/PNG|格式|结构/iu);
  await expect(inspectReportPhotoFile(asFile(PNG_1X1.slice(0, 33), "ihdr-only.png", "image/png"))).rejects.toThrow(/PNG|格式|结构|截断/iu);

  await expect(inspectReportPhotoFile(asFile(JPEG_2X1.slice(0, -2), "no-eoi.jpg", "image/jpeg"))).rejects.toThrow(/JPEG|结构|截断/iu);
  await expect(inspectReportPhotoFile(asFile(JPEG_SOF_WITHOUT_SCAN, "sof-without-scan.jpg", "image/jpeg")))
    .rejects.toThrow(/JPEG|SOS|scan|结构|截断/iu);
  await expect(inspectReportPhotoFile(asFile(WEBP_VP8X_WITHOUT_IMAGE_CHUNK, "vp8x-without-image.webp", "image/webp")))
    .rejects.toThrow(/WebP|image|结构|截断/iu);
  const zeroJpeg = JPEG_2X1.slice();
  zeroJpeg[9] = 0;
  zeroJpeg[10] = 0;
  await expect(inspectReportPhotoFile(asFile(zeroJpeg, "zero.jpg", "image/jpeg"))).rejects.toThrow(/尺寸/iu);

  const zeroSofComponents = JPEG_2X1.slice();
  zeroSofComponents[11] = 0;
  await expect(inspectReportPhotoFile(asFile(zeroSofComponents, "zero-sof-components.jpg", "image/jpeg")))
    .rejects.toThrow(/JPEG|SOF|结构/iu);
  const zeroSosComponents = JPEG_2X1.slice();
  zeroSosComponents[25] = 0;
  await expect(inspectReportPhotoFile(asFile(zeroSosComponents, "zero-sos-components.jpg", "image/jpeg")))
    .rejects.toThrow(/JPEG|SOS|结构/iu);
  const invalidVp8Version = WEBP_LOSSY_2X3.slice();
  invalidVp8Version[20] = 0x1e;
  await expect(inspectReportPhotoFile(asFile(invalidVp8Version, "invalid-vp8-version.webp", "image/webp")))
    .rejects.toThrow(/WebP|VP8|结构/iu);
  const missingIccpChunk = WEBP_3X2.slice();
  missingIccpChunk[20] = 0x20;
  await expect(inspectReportPhotoFile(asFile(missingIccpChunk, "missing-iccp.webp", "image/webp")))
    .rejects.toThrow(/WebP|ICCP|结构/iu);
});

test("VP8X accepts lossless alpha and animated frames while rejecting their feature-bit drift", async () => {
  const [alpha, animated] = await Promise.all([
    inspectReportPhotoFile(asFile(WEBP_VP8X_LOSSLESS_ALPHA_1X1, "alpha.webp", "image/webp")),
    inspectReportPhotoFile(asFile(WEBP_ANIMATED_1X1, "animated.webp", "image/webp")),
  ]);
  expect([alpha.widthPx, alpha.heightPx, animated.widthPx, animated.heightPx]).toEqual([1, 1, 1, 1]);

  const missingLosslessAlphaFlag = WEBP_VP8X_LOSSLESS_ALPHA_1X1.slice();
  missingLosslessAlphaFlag[20] = 0;
  await expect(inspectReportPhotoFile(asFile(missingLosslessAlphaFlag, "alpha-drift.webp", "image/webp")))
    .rejects.toThrow(/WebP|ALPH|flag|structure/iu);

  const missingAnimationFlag = WEBP_ANIMATED_1X1.slice();
  missingAnimationFlag[20] = 0;
  await expect(inspectReportPhotoFile(asFile(missingAnimationFlag, "animation-drift.webp", "image/webp")))
    .rejects.toThrow(/WebP|ANIM|flag|structure/iu);
});

test("quota reject missing and non-finite estimates are no-write and invalid metadata fails before estimate", async () => {
  const inspected = await inspectReportPhotoFile(asFile(PNG_1X1, "quota.png", "image/png"));
  const candidate = record("quota-photo", inspected);
  for (const estimateStorage of [
    async () => { throw new Error("estimate unavailable"); },
    async () => ({ usage: undefined, quota: 1000 }),
    async () => ({ usage: 0, quota: Number.POSITIVE_INFINITY }),
    async () => ({ usage: -1, quota: 1000 }),
    async () => ({ usage: 100, quota: 99 }),
  ]) {
    const repository = createMemoryReportPhotoRepository({ estimateStorage });
    await expect(repository.writeBatch([candidate])).rejects.toThrow(/空间|storage/iu);
    expect(await repository.list()).toEqual([]);
  }

  let estimateCalls = 0;
  const repository = createMemoryReportPhotoRepository({
    estimateStorage: async () => {
      estimateCalls += 1;
      return { usage: 0, quota: 1000 };
    },
  });
  await expect(repository.writeBatch([{ ...candidate, widthPx: candidate.widthPx + 1 }]))
    .rejects.toThrow(/integrity|不一致/iu);
  expect(estimateCalls).toBe(0);
  expect(await repository.list()).toEqual([]);
});

test("verified resolver rejects every canonical identity or integrity mismatch and returns defensive Blob copies", async () => {
  const repository = createMemoryReportPhotoRepository();
  const stored = record("verified-photo", await inspectReportPhotoFile(asFile(PNG_1X1, "verified.png", "image/png")));
  await repository.writeBatch([stored]);
  const expected = {
    id: stored.id,
    reportId: stored.reportId,
    vehicleId: stored.vehicleId,
    originalName: stored.originalName,
    detectedMediaType: stored.detectedMediaType,
    widthPx: stored.widthPx,
    heightPx: stored.heightPx,
    byteLength: stored.byteLength,
    sha256: stored.sha256,
  };

  expect((await resolveVerifiedReportPhoto(repository, expected)).id).toBe(stored.id);
  for (const drift of [
    { id: "missing-photo" },
    { reportId: "other-report" },
    { vehicleId: "other-vehicle" },
    { originalName: "other.png" },
    { detectedMediaType: "image/jpeg" as const },
    { widthPx: 99 },
    { heightPx: 99 },
    { byteLength: stored.byteLength + 1 },
    { sha256: `sha256-bytes-v1:${"0".repeat(64)}` as const },
  ]) {
    await expect(resolveVerifiedReportPhoto(repository, { ...expected, ...drift })).rejects.toThrow(/缺失|完整|integrity/iu);
  }

  const first = await resolveVerifiedReportPhoto(repository, expected);
  const mutated = new Uint8Array(await first.blob.arrayBuffer());
  mutated[0] = 0;
  expect(new Uint8Array(await (await resolveVerifiedReportPhoto(repository, expected)).blob.arrayBuffer())[0]).toBe(PNG_1X1[0]);
});

test("tampered stored Blob is neither resolved nor silently overwritten by same-ID retry", async () => {
  const backend = new Map<string, ReportPhotoBlobRecord>();
  const repository = createMemoryReportPhotoRepository({ backend });
  const valid = record("tampered-photo", await inspectReportPhotoFile(asFile(PNG_1X1, "tampered.png", "image/png")));
  await repository.writeBatch([valid]);
  backend.set(valid.id, { ...valid, blob: new Blob([new Uint8Array(valid.byteLength)], { type: valid.detectedMediaType }) });

  await expect(resolveVerifiedReportPhoto(repository, valid)).rejects.toThrow(/完整|integrity|格式/iu);
  await expect(repository.writeBatch([valid])).rejects.toThrow(/完整|integrity|占用|格式/iu);
  expect(new Uint8Array(await backend.get(valid.id)!.blob.arrayBuffer())).toEqual(new Uint8Array(valid.byteLength));
});

test("strict IndexedDB queues every put synchronously and isolates its physical database and store", async () => {
  const strict = strictIndexedDbFactory();
  const repository = createIndexedDbReportPhotoRepository(strict.factory, async () => {
    strict.events.push("estimate");
    return { usage: 0, quota: 100_000 };
  });
  const candidates = await Promise.all([
    record("strict-a", await inspectReportPhotoFile(asFile(PNG_1X1, "a.png", "image/png"))),
    record("strict-b", await inspectReportPhotoFile(asFile(JPEG_2X1, "b.jpg", "image/jpeg"))),
    record("strict-c", await inspectReportPhotoFile(asFile(WEBP_3X2, "c.webp", "image/webp"))),
  ]);
  await repository.writeBatch(candidates);
  expect([...strict.records.keys()]).toEqual(candidates.map((candidate) => candidate.id));
  expect(strict.events.filter((event) => event.startsWith("open:"))).toEqual([
    `open:${IR_REPORT_PHOTOS_DB_NAME}`,
  ]);
  expect(strict.events.every((event) => !event.includes("wh_linked_operations_assets_v1") && !event.includes("wh_ir_generated_files_v1"))).toBe(true);
  expect(strict.events.indexOf("estimate")).toBeLessThan(strict.events.indexOf(`tx:readwrite:${IR_REPORT_PHOTOS_STORE_NAME}`));
});

for (const failureKind of ["sync", "async"] as const) {
  for (const failureIndex of [0, 1, 2]) {
    test(`strict IndexedDB ${failureKind} put failure at ${failureIndex} aborts the whole batch`, async () => {
      const strict = strictIndexedDbFactory();
      const repository = createIndexedDbReportPhotoRepository(strict.factory, async () => ({ usage: 0, quota: 100_000 }));
      const existing = record("strict-existing", await inspectReportPhotoFile(asFile(PNG_1X1, "existing.png", "image/png")));
      await repository.writeBatch([existing]);
      const existingBytes = new Uint8Array(await strict.records.get(existing.id)!.blob.arrayBuffer());
      const candidates = await Promise.all([
        record("strict-next-a", await inspectReportPhotoFile(asFile(PNG_1X1, "a.png", "image/png"))),
        record("strict-next-b", await inspectReportPhotoFile(asFile(JPEG_2X1, "b.jpg", "image/jpeg"))),
        record("strict-next-c", await inspectReportPhotoFile(asFile(WEBP_3X2, "c.webp", "image/webp"))),
      ]);
      strict.failNext({ kind: failureKind, index: failureIndex, error: new Error(`${failureKind}-${failureIndex}`) });
      await expect(repository.writeBatch(candidates)).rejects.toThrow(new RegExp(`${failureKind}-${failureIndex}|aborted`, "i"));
      expect([...strict.records.keys()]).toEqual([existing.id]);
      expect(new Uint8Array(await strict.records.get(existing.id)!.blob.arrayBuffer())).toEqual(existingBytes);
      if (failureKind === "sync") expect(strict.abortCalls).toBe(1);
    });
  }
}

test("strict IndexedDB cleanup reads keys before opening a fresh synchronous delete transaction", async () => {
  const strict = strictIndexedDbFactory();
  const repository = createIndexedDbReportPhotoRepository(strict.factory, async () => ({ usage: 0, quota: 100_000 }));
  const candidates = await Promise.all([
    record("keep", await inspectReportPhotoFile(asFile(PNG_1X1, "keep.png", "image/png"))),
    record("remove-a", await inspectReportPhotoFile(asFile(JPEG_2X1, "a.jpg", "image/jpeg"))),
    record("remove-b", await inspectReportPhotoFile(asFile(WEBP_3X2, "b.webp", "image/webp"))),
  ]);
  await repository.writeBatch(candidates);
  await repository.cleanupExceptIds(["keep"]);
  expect([...strict.records.keys()]).toEqual(["keep"]);
  expect(strict.events.slice(-5)).toContain(`tx:readonly:${IR_REPORT_PHOTOS_STORE_NAME}`);
  expect(strict.events.slice(-5)).toContain(`tx:readwrite:${IR_REPORT_PHOTOS_STORE_NAME}`);
});

test("concurrent different bytes under one stable ID never overwrite the winning IndexedDB owner", async () => {
  const strict = strictIndexedDbFactory();
  let estimateArrivals = 0;
  let releaseEstimates!: () => void;
  const estimateBarrier = new Promise<void>((resolve) => { releaseEstimates = resolve; });
  const repository = createIndexedDbReportPhotoRepository(strict.factory, async () => {
    estimateArrivals += 1;
    if (estimateArrivals === 2) releaseEstimates();
    await estimateBarrier;
    return { usage: 0, quota: 100_000 };
  });
  const png = record("stable-race", await inspectReportPhotoFile(asFile(PNG_1X1, "race.png", "image/png")));
  const jpeg = record("stable-race", await inspectReportPhotoFile(asFile(JPEG_2X1, "race.jpg", "image/jpeg")));
  const outcomes = await Promise.allSettled([repository.writeBatch([png]), repository.writeBatch([jpeg])]);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  const winner = await repository.read("stable-race");
  expect([png.sha256, jpeg.sha256]).toContain(winner?.sha256);
  const beforeRetry = winner?.sha256;
  const loser = winner?.sha256 === png.sha256 ? jpeg : png;
  await expect(repository.writeBatch([loser])).rejects.toThrow(/occup|integrity|占用|Constraint/iu);
  expect((await repository.read("stable-race"))?.sha256).toBe(beforeRetry);
});

test("concurrent exact retries under one stable ID both resolve after verifying the winning owner", async () => {
  const strict = strictIndexedDbFactory();
  let estimateArrivals = 0;
  let releaseEstimates!: () => void;
  const estimateBarrier = new Promise<void>((resolve) => { releaseEstimates = resolve; });
  const repository = createIndexedDbReportPhotoRepository(strict.factory, async () => {
    estimateArrivals += 1;
    if (estimateArrivals === 2) releaseEstimates();
    await estimateBarrier;
    return { usage: 0, quota: 100_000 };
  });
  const candidate = record("stable-exact-race", await inspectReportPhotoFile(asFile(PNG_1X1, "race.png", "image/png")));

  const outcomes = await Promise.allSettled([
    repository.writeBatch([candidate]),
    repository.writeBatch([candidate]),
  ]);

  expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
  expect((await repository.read(candidate.id))?.sha256).toBe(candidate.sha256);
  expect([...strict.records.keys()].filter((id) => id === candidate.id)).toHaveLength(1);
});

test("IndexedDB refuses an under-counted batch when an existing row disappears at the quota barrier", async () => {
  const strict = strictIndexedDbFactory();
  let deleteAtEstimate = false;
  let requiredBytes = 0;
  const repository = createIndexedDbReportPhotoRepository(strict.factory, async () => {
    if (deleteAtEstimate) strict.records.delete("stable-existing");
    return { usage: 0, quota: requiredBytes };
  });
  const existing = record("stable-existing", await inspectReportPhotoFile(asFile(PNG_1X1, "existing.png", "image/png")));
  const added = record("stable-added", await inspectReportPhotoFile(asFile(JPEG_2X1, "added.jpg", "image/jpeg")));
  requiredBytes = existing.byteLength;
  await repository.writeBatch([existing]);
  deleteAtEstimate = true;
  requiredBytes = added.byteLength;
  await expect(repository.writeBatch([existing, added])).rejects.toThrow(/quota|space|storage|空间|变化/iu);
  expect(await repository.read(existing.id)).toBeNull();
  expect(await repository.read(added.id)).toBeNull();
});

test("memory repository refuses an under-counted batch when an existing row disappears during quota", async () => {
  const backend = new Map<string, ReportPhotoBlobRecord>();
  let deleteAtEstimate = false;
  let requiredBytes = 0;
  const repository = createMemoryReportPhotoRepository({
    backend,
    estimateStorage: async () => {
      if (deleteAtEstimate) backend.delete("memory-existing");
      return { usage: 0, quota: requiredBytes };
    },
  });
  const existing = record("memory-existing", await inspectReportPhotoFile(asFile(PNG_1X1, "existing.png", "image/png")));
  const added = record("memory-added", await inspectReportPhotoFile(asFile(JPEG_2X1, "added.jpg", "image/jpeg")));
  requiredBytes = existing.byteLength;
  await repository.writeBatch([existing]);
  deleteAtEstimate = true;
  requiredBytes = added.byteLength;
  await expect(repository.writeBatch([existing, added])).rejects.toThrow(/quota|space|storage|空间|变化/iu);
  expect(await repository.list()).toEqual([]);
});

test("memory repository concurrent different bytes under one stable ID has one immutable winner", async () => {
  let estimateArrivals = 0;
  let releaseEstimates!: () => void;
  const barrier = new Promise<void>((resolve) => { releaseEstimates = resolve; });
  const repository = createMemoryReportPhotoRepository({
    estimateStorage: async () => {
      estimateArrivals += 1;
      if (estimateArrivals === 2) releaseEstimates();
      await barrier;
      return { usage: 0, quota: 100_000 };
    },
  });
  const png = record("memory-stable-race", await inspectReportPhotoFile(asFile(PNG_1X1, "race.png", "image/png")));
  const jpeg = record("memory-stable-race", await inspectReportPhotoFile(asFile(JPEG_2X1, "race.jpg", "image/jpeg")));
  const outcomes = await Promise.allSettled([repository.writeBatch([png]), repository.writeBatch([jpeg])]);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  const winner = await repository.read(png.id);
  expect([png.sha256, jpeg.sha256]).toContain(winner?.sha256);
  const loser = winner?.sha256 === png.sha256 ? jpeg : png;
  await expect(repository.writeBatch([loser])).rejects.toThrow(/占用|integrity|完整/iu);
  expect((await repository.read(png.id))?.sha256).toBe(winner?.sha256);
});
