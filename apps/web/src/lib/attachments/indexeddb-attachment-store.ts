export const IR_REPORT_PHOTOS_DB_NAME = "wh_ir_report_photos_v1";
export const IR_REPORT_PHOTOS_STORE_NAME = "photos";

export type ReportPhotoMediaType = "image/jpeg" | "image/png" | "image/webp";
export type ReportPhotoSha256 = `sha256-bytes-v1:${string}`;

export interface InspectedReportPhoto {
  readonly originalName: string;
  readonly detectedMediaType: ReportPhotoMediaType;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly byteLength: number;
  readonly sha256: ReportPhotoSha256;
  readonly blob: Blob;
}

export interface ReportPhotoBlobRecord extends Omit<InspectedReportPhoto, "originalName"> {
  readonly id: string;
  readonly reportId: string;
  readonly vehicleId: string;
  /** Null when the protected legacy source never carried an authentic name. */
  readonly originalName: string | null;
}

export interface ReportPhotoRepository {
  writeBatch(records: ReadonlyArray<ReportPhotoBlobRecord>): Promise<void>;
  read(id: string): Promise<ReportPhotoBlobRecord | null>;
  list(): Promise<ReportPhotoBlobRecord[]>;
  deleteMany(ids: ReadonlyArray<string>): Promise<void>;
  cleanupExceptIds(retainedIds: ReadonlyArray<string>): Promise<void>;
}

export interface StorageEstimate {
  readonly usage?: number;
  readonly quota?: number;
}

type StorageEstimator = () => Promise<StorageEstimate>;

export interface MemoryReportPhotoRepository extends ReportPhotoRepository {
  setStorageEstimate(estimate: StorageEstimate): void;
  failNextWriteAt(index: number, error: Error): void;
  failNextDelete(error: Error): void;
}

export interface MemoryReportPhotoRepositoryOptions {
  readonly backend?: Map<string, ReportPhotoBlobRecord>;
  readonly estimateStorage?: StorageEstimator;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] * 0x1000000)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function detectPng(bytes: Uint8Array): { mediaType: ReportPhotoMediaType; width: number; height: number } | null {
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return null;
  if (bytes.length < 33) throw new Error("PNG 图片已截断");
  if (readUint32Be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") {
    throw new Error("PNG 图片结构无效");
  }
  let offset = 8;
  let sawIdat = false;
  let sawIend = false;
  while (offset + 12 <= bytes.length) {
    const chunkLength = readUint32Be(bytes, offset);
    const chunkType = ascii(bytes, offset + 4, 4);
    const nextOffset = offset + 12 + chunkLength;
    if (!Number.isSafeInteger(nextOffset) || nextOffset > bytes.length) throw new Error("PNG 图片已截断");
    if (offset === 8 && (chunkType !== "IHDR" || chunkLength !== 13)) throw new Error("PNG 图片结构无效");
    if (chunkType === "IDAT") sawIdat = true;
    if (chunkType === "IEND") {
      if (chunkLength !== 0 || nextOffset !== bytes.length) throw new Error("PNG 图片结构无效");
      sawIend = true;
      break;
    }
    offset = nextOffset;
  }
  if (!sawIdat || !sawIend) throw new Error("PNG 图片已截断");
  return { mediaType: "image/png", width: readUint32Be(bytes, 16), height: readUint32Be(bytes, 20) };
}

function detectJpeg(bytes: Uint8Array): { mediaType: ReportPhotoMediaType; width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new Error("JPEG 图片结构无效");
  let offset = 2;
  let dimensions: { width: number; height: number } | null = null;
  let frameComponentIds: number[] | null = null;
  let sawStartOfScan = false;
  let sawScanData = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("JPEG 图片 marker 无效");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw new Error("JPEG 图片已截断");
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      if (offset !== bytes.length || !dimensions || !sawStartOfScan || !sawScanData) {
        throw new Error("JPEG 图片缺少有效 SOS/scan 资料");
      }
      return { mediaType: "image/jpeg", ...dimensions };
    }
    if (marker === 0xd8 || marker === 0x00) throw new Error("JPEG 图片 marker 无效");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) throw new Error("JPEG 图片已截断");
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) throw new Error("JPEG 图片 segment 无效");
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      const componentCount = bytes[offset + 7];
      if (
        bytes[offset + 2] !== 8
        || componentCount < 1
        || componentCount > 4
        || segmentLength !== 8 + 3 * componentCount
      ) throw new Error("JPEG 图片 SOF 结构无效");
      const componentIds = Array.from({ length: componentCount }, (_, index) => bytes[offset + 8 + index * 3]);
      if (new Set(componentIds).size !== componentIds.length) throw new Error("JPEG 图片 SOF 组件无效");
      dimensions = {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
      frameComponentIds = componentIds;
    }
    if (marker === 0xda) {
      const componentCount = bytes[offset + 2];
      if (
        !dimensions
        || !frameComponentIds
        || componentCount < 1
        || segmentLength !== 6 + 2 * componentCount
      ) throw new Error("JPEG 图片 SOS 结构无效");
      const scanComponentIds = Array.from({ length: componentCount }, (_, index) => bytes[offset + 3 + index * 2]);
      if (
        new Set(scanComponentIds).size !== scanComponentIds.length
        || scanComponentIds.some((id) => !frameComponentIds!.includes(id))
      ) throw new Error("JPEG 图片 SOS 组件无效");
      sawStartOfScan = true;
      offset += segmentLength;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          sawScanData = true;
          offset += 1;
          continue;
        }
        if (offset + 1 >= bytes.length) throw new Error("JPEG 图片 scan 已截断");
        const escaped = bytes[offset + 1];
        if (escaped === 0x00) {
          sawScanData = true;
          offset += 2;
          continue;
        }
        if (escaped >= 0xd0 && escaped <= 0xd7) {
          offset += 2;
          continue;
        }
        break;
      }
      continue;
    }
    offset += segmentLength;
  }
  throw new Error("JPEG 图片缺少有效 SOS/scan 资料");
}

function detectVp8lDimensions(bytes: Uint8Array, dataOffset: number, chunkLength: number) {
  if (chunkLength < 5 || bytes[dataOffset] !== 0x2f || (bytes[dataOffset + 4] & 0xe0) !== 0) {
    throw new Error("WebP 图片结构无效");
  }
  return {
    width: 1 + (bytes[dataOffset + 1] | ((bytes[dataOffset + 2] & 0x3f) << 8)),
    height: 1 + ((bytes[dataOffset + 2] >> 6) | (bytes[dataOffset + 3] << 2) | ((bytes[dataOffset + 4] & 0x0f) << 10)),
    alphaUsed: Boolean(bytes[dataOffset + 4] & 0x10),
  };
}

function detectVp8Dimensions(bytes: Uint8Array, dataOffset: number, chunkLength: number) {
  const frameTag = readUint24Le(bytes, dataOffset);
  if (
    chunkLength < 10
    || (frameTag & 1) !== 0
    || ((frameTag >> 1) & 0x07) > 3
    || ((frameTag >> 4) & 1) !== 1
    || (frameTag >> 5) > chunkLength - 3
    || bytes[dataOffset + 3] !== 0x9d
    || bytes[dataOffset + 4] !== 0x01
    || bytes[dataOffset + 5] !== 0x2a
  ) throw new Error("WebP 图片结构无效");
  return {
    width: (bytes[dataOffset + 6] | (bytes[dataOffset + 7] << 8)) & 0x3fff,
    height: (bytes[dataOffset + 8] | (bytes[dataOffset + 9] << 8)) & 0x3fff,
  };
}

function validAlphaChunk(bytes: Uint8Array, dataOffset: number, chunkLength: number): boolean {
  if (chunkLength < 1) return false;
  const header = bytes[dataOffset];
  return (header & 0xc3) === 0 && (header & 0x20) === 0;
}

function detectAnimatedWebpFrame(
  bytes: Uint8Array,
  dataOffset: number,
  chunkLength: number,
  canvas: { width: number; height: number },
): { alphaUsed: boolean } {
  if (chunkLength < 16) throw new Error("WebP ANMF frame 结构无效");
  const frame = {
    x: readUint24Le(bytes, dataOffset) * 2,
    y: readUint24Le(bytes, dataOffset + 3) * 2,
    width: readUint24Le(bytes, dataOffset + 6) + 1,
    height: readUint24Le(bytes, dataOffset + 9) + 1,
  };
  if (
    (bytes[dataOffset + 15] & 0xfc) !== 0
    || frame.x + frame.width > canvas.width
    || frame.y + frame.height > canvas.height
  ) throw new Error("WebP ANMF frame 范围无效");
  const frameEnd = dataOffset + chunkLength;
  let cursor = dataOffset + 16;
  let alphaChunk = false;
  let image: { width: number; height: number; alphaUsed: boolean } | null = null;
  while (cursor < frameEnd) {
    if (cursor + 8 > frameEnd) throw new Error("WebP ANMF frame 已截断");
    const type = ascii(bytes, cursor, 4);
    const length = readUint32Le(bytes, cursor + 4);
    const childDataOffset = cursor + 8;
    const paddedEnd = childDataOffset + length + (length % 2);
    if (!Number.isSafeInteger(paddedEnd) || paddedEnd > frameEnd) throw new Error("WebP ANMF frame 已截断");
    if (type === "ALPH") {
      if (alphaChunk || image || !validAlphaChunk(bytes, childDataOffset, length)) throw new Error("WebP ANMF ALPH 结构无效");
      alphaChunk = true;
    } else if (type === "VP8 ") {
      if (image) throw new Error("WebP ANMF image chunk 重复");
      image = { ...detectVp8Dimensions(bytes, childDataOffset, length), alphaUsed: alphaChunk };
    } else if (type === "VP8L") {
      if (image || alphaChunk) throw new Error("WebP ANMF lossless 结构无效");
      image = detectVp8lDimensions(bytes, childDataOffset, length);
    } else {
      throw new Error("WebP ANMF child chunk 不受支持");
    }
    cursor = paddedEnd;
  }
  if (!image || image.width !== frame.width || image.height !== frame.height) {
    throw new Error("WebP ANMF image 尺寸无效");
  }
  return { alphaUsed: image.alphaUsed };
}

function detectWebp(bytes: Uint8Array): { mediaType: ReportPhotoMediaType; width: number; height: number } | null {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const riffLength = readUint32Le(bytes, 4) + 8;
  const chunkLength = readUint32Le(bytes, 16);
  if (riffLength !== bytes.length || 20 + chunkLength > bytes.length) throw new Error("WebP 图片结构无效");
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    if (
      chunkLength !== 10
      || bytes.length < 30
      || (bytes[20] & 0xc1) !== 0
      || bytes[21] !== 0
      || bytes[22] !== 0
      || bytes[23] !== 0
    ) throw new Error("WebP 图片结构无效");
    const canvas = {
      width: readUint24Le(bytes, 24) + 1,
      height: readUint24Le(bytes, 27) + 1,
    };
    let cursor = 30;
    let imageDimensions: { width: number; height: number; alphaUsed: boolean } | null = null;
    const childTypes = new Set<string>();
    const childCounts = new Map<string, number>();
    let animatedFrameCount = 0;
    let animatedAlphaUsed = false;
    while (cursor < bytes.length) {
      if (cursor + 8 > bytes.length) throw new Error("WebP 图片结构无效");
      const childType = ascii(bytes, cursor, 4);
      const childLength = readUint32Le(bytes, cursor + 4);
      const dataOffset = cursor + 8;
      const paddedEnd = dataOffset + childLength + (childLength % 2);
      if (!Number.isSafeInteger(paddedEnd) || paddedEnd > bytes.length) throw new Error("WebP 图片结构无效");
      if (!["ICCP", "ALPH", "EXIF", "XMP ", "ANIM", "ANMF", "VP8L", "VP8 "].includes(childType)) {
        throw new Error("WebP child chunk 不受支持");
      }
      childTypes.add(childType);
      childCounts.set(childType, (childCounts.get(childType) ?? 0) + 1);
      if (childType !== "ANMF" && childCounts.get(childType)! > 1) throw new Error("WebP child chunk 重复");
      if (childType === "VP8L" || childType === "VP8 ") {
        if (imageDimensions) throw new Error("WebP 图片包含重复 image chunk");
        if (childType === "VP8L" && childTypes.has("ALPH")) throw new Error("WebP lossless 不得携带 ALPH chunk");
        imageDimensions = childType === "VP8L"
          ? detectVp8lDimensions(bytes, dataOffset, childLength)
          : { ...detectVp8Dimensions(bytes, dataOffset, childLength), alphaUsed: childTypes.has("ALPH") };
      } else if (childType === "ALPH") {
        if (imageDimensions || !validAlphaChunk(bytes, dataOffset, childLength)) throw new Error("WebP ALPH 结构无效");
      } else if (childType === "ANIM") {
        if (childLength !== 6 || animatedFrameCount > 0) throw new Error("WebP ANIM 结构无效");
      } else if (childType === "ANMF") {
        if (!childTypes.has("ANIM") || imageDimensions || childTypes.has("ALPH")) throw new Error("WebP ANMF 结构无效");
        const frame = detectAnimatedWebpFrame(bytes, dataOffset, childLength, canvas);
        animatedFrameCount += 1;
        animatedAlphaUsed ||= frame.alphaUsed;
      }
      cursor = paddedEnd;
    }
    for (const [flag, childType] of [
      [0x20, "ICCP"],
      [0x08, "EXIF"],
      [0x04, "XMP "],
      [0x02, "ANIM"],
    ] as const) {
      if (Boolean(bytes[20] & flag) !== childTypes.has(childType)) {
        throw new Error(`WebP ${childType.trim()} flag/chunk 不一致`);
      }
    }
    const isAnimated = childTypes.has("ANIM");
    if (isAnimated) {
      if (imageDimensions || animatedFrameCount === 0) throw new Error("WebP 动画缺少有效 frame");
    } else if (!imageDimensions || imageDimensions.width !== canvas.width || imageDimensions.height !== canvas.height) {
      throw new Error("WebP 图片缺少有效 image chunk");
    }
    const actualAlpha = isAnimated ? animatedAlphaUsed : Boolean(imageDimensions?.alphaUsed);
    if (Boolean(bytes[20] & 0x10) !== actualAlpha) {
      throw new Error("WebP ALPH flag/image 不一致");
    }
    if (!isAnimated && imageDimensions?.alphaUsed && childTypes.has("VP8L") && childTypes.has("ALPH")) {
      throw new Error("WebP lossless alpha 不得重复 ALPH chunk");
    }
    return { mediaType: "image/webp", ...canvas };
  }
  if (chunk === "VP8L") {
    if (20 + chunkLength + (chunkLength % 2) !== bytes.length) throw new Error("WebP 图片结构无效");
    const { width, height } = detectVp8lDimensions(bytes, 20, chunkLength);
    return { mediaType: "image/webp", width, height };
  }
  if (chunk === "VP8 ") {
    if (20 + chunkLength + (chunkLength % 2) !== bytes.length) throw new Error("WebP 图片结构无效");
    return { mediaType: "image/webp", ...detectVp8Dimensions(bytes, 20, chunkLength) };
  }
  throw new Error("WebP 图片编码不受支持");
}

function detectImage(bytes: Uint8Array): { mediaType: ReportPhotoMediaType; width: number; height: number } {
  const detected = detectPng(bytes) ?? detectJpeg(bytes) ?? detectWebp(bytes);
  if (!detected) throw new Error("图片格式无效；仅支持 JPEG、PNG、WebP");
  if (!Number.isSafeInteger(detected.width) || detected.width <= 0
    || !Number.isSafeInteger(detected.height) || detected.height <= 0) {
    throw new Error("图片尺寸无效");
  }
  return detected;
}

async function sha256(bytes: Uint8Array): Promise<ReportPhotoSha256> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `sha256-bytes-v1:${hex}`;
}

export async function inspectReportPhotoFile(file: File): Promise<InspectedReportPhoto> {
  if (!(file instanceof Blob) || typeof file.name !== "string" || !file.name.trim()) {
    throw new Error("图片文件资料无效");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectImage(bytes);
  return {
    originalName: file.name,
    detectedMediaType: detected.mediaType,
    widthPx: detected.width,
    heightPx: detected.height,
    byteLength: bytes.byteLength,
    sha256: await sha256(bytes),
    blob: new Blob([new Uint8Array(bytes)], { type: detected.mediaType }),
  };
}

function cloneRecord(record: ReportPhotoBlobRecord): ReportPhotoBlobRecord {
  return { ...record, blob: record.blob.slice(0, record.blob.size, record.detectedMediaType) };
}

async function normalizeRecord(record: ReportPhotoBlobRecord): Promise<ReportPhotoBlobRecord> {
  if (!record.id?.trim() || !record.reportId?.trim() || !record.vehicleId?.trim()) {
    throw new Error("照片 Blob identity 无效");
  }
  const inspected = await inspectReportPhotoFile(new File([record.blob], record.originalName ?? `${record.id}-integrity-check`, {
    type: record.detectedMediaType,
  }));
  if (
    record.blob.type !== record.detectedMediaType
    || inspected.detectedMediaType !== record.detectedMediaType
    || inspected.widthPx !== record.widthPx
    || inspected.heightPx !== record.heightPx
    || inspected.byteLength !== record.byteLength
    || inspected.sha256 !== record.sha256
  ) throw new Error("照片 Blob integrity metadata 不一致");
  return cloneRecord({ ...record, blob: inspected.blob });
}

function sameRecord(left: ReportPhotoBlobRecord, right: ReportPhotoBlobRecord): boolean {
  return left.id === right.id
    && left.reportId === right.reportId
    && left.vehicleId === right.vehicleId
    && left.originalName === right.originalName
    && left.detectedMediaType === right.detectedMediaType
    && left.widthPx === right.widthPx
    && left.heightPx === right.heightPx
    && left.byteLength === right.byteLength
    && left.sha256 === right.sha256;
}

async function requireQuota(estimateStorage: StorageEstimator, requiredBytes: number): Promise<void> {
  let estimate: StorageEstimate;
  try {
    estimate = await estimateStorage();
  } catch {
    throw new Error("无法确认照片存储空间");
  }
  if (
    !Number.isFinite(estimate.usage)
    || !Number.isFinite(estimate.quota)
    || (estimate.usage as number) < 0
    || (estimate.quota as number) < 0
    || (estimate.quota as number) < (estimate.usage as number)
  ) {
    throw new Error("无法确认照片存储空间");
  }
  if ((estimate.quota as number) - (estimate.usage as number) < requiredBytes) {
    throw new Error("照片存储空间不足");
  }
}

function defaultStorageEstimator(): Promise<StorageEstimate> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage?.estimate) return Promise.reject(new Error("storage estimate unavailable"));
  return storage.estimate();
}

export function createMemoryReportPhotoRepository(
  options: MemoryReportPhotoRepositoryOptions = {},
): MemoryReportPhotoRepository {
  const backend = options.backend ?? new Map<string, ReportPhotoBlobRecord>();
  let estimateStorage = options.estimateStorage ?? (async () => ({ usage: 0, quota: Number.MAX_SAFE_INTEGER }));
  let nextWriteFailure: { index: number; error: Error } | null = null;
  let nextDeleteFailure: Error | null = null;
  return {
    setStorageEstimate(estimate) {
      estimateStorage = async () => estimate;
    },
    failNextWriteAt(index, error) {
      nextWriteFailure = { index, error };
    },
    failNextDelete(error) {
      nextDeleteFailure = error;
    },
    async writeBatch(records) {
      const normalized = await Promise.all(records.map(normalizeRecord));
      if (new Set(normalized.map((record) => record.id)).size !== normalized.length) {
        throw new Error("照片 Blob IDs 重复");
      }
      const missing: ReportPhotoBlobRecord[] = [];
      for (const record of normalized) {
        const existing = backend.get(record.id);
        if (existing && !sameRecord(await normalizeRecord(existing), record)) throw new Error("照片 Blob ID 已被不同内容占用");
        if (!existing) missing.push(record);
      }
      if (missing.length === 0) return;
      await requireQuota(estimateStorage, missing.reduce((sum, record) => sum + record.byteLength, 0));
      // A competing writer may have claimed or removed an ID while quota was
      // awaited. Re-evaluate the live owner immediately before the synchronous
      // in-memory commit; there is no yield between this check and replacement.
      const liveMissing: ReportPhotoBlobRecord[] = [];
      const estimatedMissingIds = new Set(missing.map((record) => record.id));
      for (const record of normalized) {
        const live = backend.get(record.id);
        if (live && (
          !sameRecord(live, record)
          || live.blob.type !== record.detectedMediaType
          || live.blob.size !== record.byteLength
        )) {
          throw new Error("照片 Blob ID 已被不同内容占用");
        }
        if (!live) liveMissing.push(record);
      }
      if (liveMissing.some((record) => !estimatedMissingIds.has(record.id))) {
        throw new Error("照片存储状态已变化，请重试以重新计算空间");
      }
      const next = new Map([...backend].map(([id, record]) => [id, cloneRecord(record)]));
      for (let index = 0; index < liveMissing.length; index += 1) {
        if (nextWriteFailure?.index === index) {
          const failure = nextWriteFailure.error;
          nextWriteFailure = null;
          throw failure;
        }
        next.set(liveMissing[index].id, cloneRecord(liveMissing[index]));
      }
      nextWriteFailure = null;
      backend.clear();
      for (const [id, record] of next) backend.set(id, record);
    },
    async read(id) {
      const record = backend.get(id);
      return record ? normalizeRecord(record) : null;
    },
    async list() {
      return Promise.all([...backend.values()].map(normalizeRecord));
    },
    async deleteMany(ids) {
      if (nextDeleteFailure) {
        const failure = nextDeleteFailure;
        nextDeleteFailure = null;
        throw failure;
      }
      for (const id of new Set(ids)) backend.delete(id);
    },
    async cleanupExceptIds(retainedIds) {
      const retained = new Set(retainedIds);
      for (const id of backend.keys()) if (!retained.has(id)) backend.delete(id);
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

async function openPhotoDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(IR_REPORT_PHOTOS_DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(IR_REPORT_PHOTOS_STORE_NAME)) {
      request.result.createObjectStore(IR_REPORT_PHOTOS_STORE_NAME, { keyPath: "id" });
    }
  };
  return requestResult(request);
}

async function databaseContainsExactRecords(
  database: IDBDatabase,
  expected: ReadonlyArray<ReportPhotoBlobRecord>,
): Promise<boolean> {
  const transaction = database.transaction(IR_REPORT_PHOTOS_STORE_NAME, "readonly");
  const store = transaction.objectStore(IR_REPORT_PHOTOS_STORE_NAME);
  const done = transactionDone(transaction);
  const stored = await Promise.all(expected.map((record) => (
    requestResult(store.get(record.id)) as Promise<ReportPhotoBlobRecord | undefined>
  )));
  await done;
  if (stored.some((record) => !record)) return false;
  try {
    const normalized = await Promise.all(stored.map((record) => normalizeRecord(record!)));
    return normalized.every((record, index) => sameRecord(record, expected[index]));
  } catch {
    return false;
  }
}

export function createIndexedDbReportPhotoRepository(
  factory: IDBFactory,
  estimateStorage: StorageEstimator = defaultStorageEstimator,
): ReportPhotoRepository {
  return {
    async writeBatch(records) {
      const normalized = await Promise.all(records.map(normalizeRecord));
      if (new Set(normalized.map((record) => record.id)).size !== normalized.length) {
        throw new Error("照片 Blob IDs 重复");
      }
      const database = await openPhotoDatabase(factory);
      try {
        const readTransaction = database.transaction(IR_REPORT_PHOTOS_STORE_NAME, "readonly");
        const readStore = readTransaction.objectStore(IR_REPORT_PHOTOS_STORE_NAME);
        const readDone = transactionDone(readTransaction);
        const existing = await Promise.all(normalized.map((record) => requestResult(readStore.get(record.id)) as Promise<ReportPhotoBlobRecord | undefined>));
        await readDone;
        const missing: ReportPhotoBlobRecord[] = [];
        const normalizedExisting = await Promise.all(existing.map((record) => record ? normalizeRecord(record) : null));
        normalized.forEach((record, index) => {
          if (normalizedExisting[index] && !sameRecord(normalizedExisting[index]!, record)) throw new Error("照片 Blob ID 已被不同内容占用");
          if (!existing[index]) missing.push(record);
        });
        if (missing.length > 0) {
          await requireQuota(estimateStorage, missing.reduce((sum, record) => sum + record.byteLength, 0));
        }
        const estimatedMissingIds = new Set(missing.map((record) => record.id));
        const writeTransaction = database.transaction(IR_REPORT_PHOTOS_STORE_NAME, "readwrite");
        const writeStore = writeTransaction.objectStore(IR_REPORT_PHOTOS_STORE_NAME);
        const done = transactionDone(writeTransaction);
        let ownershipError: Error | null = null;
        try {
          // Queue every ownership read synchronously in one readwrite
          // transaction. Its callbacks may conditionally `add` a row that was
          // missing (or concurrently deleted) without ever overwriting a first
          // owner. The already queued reads keep the transaction active.
          for (const record of normalized) {
            const ownershipRequest = writeStore.get(record.id) as IDBRequest<ReportPhotoBlobRecord | undefined>;
            ownershipRequest.onsuccess = () => {
              const live = ownershipRequest.result;
              if (live) {
                if (
                  !sameRecord(live, record)
                  || live.blob.type !== record.detectedMediaType
                  || live.blob.size !== record.byteLength
                ) {
                  ownershipError = new Error("照片 Blob ID 已被不同内容占用");
                  writeTransaction.abort();
                }
                return;
              }
              if (!estimatedMissingIds.has(record.id)) {
                ownershipError = new Error("照片存储状态已变化，请重试以重新计算空间");
                writeTransaction.abort();
                return;
              }
              try {
                writeStore.add(cloneRecord(record));
              } catch (error) {
                ownershipError = error instanceof Error ? error : new Error("照片 Blob 写入失败");
                writeTransaction.abort();
              }
            };
          }
        } catch (error) {
          try {
            writeTransaction.abort();
            await done;
          } catch {
            // Preserve the synchronous DataClone/TransactionInactive error.
          }
          throw error;
        }
        try {
          await done;
        } catch (error) {
          // React Strict Mode and multiple tabs can race the exact same stable
          // mutation. `add` keeps the first owner; the loser is an exact replay
          // only when every durable winner row revalidates byte-for-byte.
          if (await databaseContainsExactRecords(database, normalized)) return;
          throw ownershipError ?? error;
        }
        if (!await databaseContainsExactRecords(database, normalized)) {
          throw new Error("照片 Blob 批次未完整持久化");
        }
      } finally {
        database.close();
      }
    },
    async read(id) {
      const database = await openPhotoDatabase(factory);
      try {
        const transaction = database.transaction(IR_REPORT_PHOTOS_STORE_NAME, "readonly");
        const done = transactionDone(transaction);
        const record = await requestResult(transaction.objectStore(IR_REPORT_PHOTOS_STORE_NAME).get(id)) as ReportPhotoBlobRecord | undefined;
        await done;
        return record ? normalizeRecord(record) : null;
      } finally {
        database.close();
      }
    },
    async list() {
      const database = await openPhotoDatabase(factory);
      try {
        const transaction = database.transaction(IR_REPORT_PHOTOS_STORE_NAME, "readonly");
        const done = transactionDone(transaction);
        const records = await requestResult(transaction.objectStore(IR_REPORT_PHOTOS_STORE_NAME).getAll()) as ReportPhotoBlobRecord[];
        await done;
        return Promise.all(records.map(normalizeRecord));
      } finally {
        database.close();
      }
    },
    async deleteMany(ids) {
      const database = await openPhotoDatabase(factory);
      try {
        const transaction = database.transaction(IR_REPORT_PHOTOS_STORE_NAME, "readwrite");
        const store = transaction.objectStore(IR_REPORT_PHOTOS_STORE_NAME);
        const done = transactionDone(transaction);
        try {
          for (const id of new Set(ids)) store.delete(id);
        } catch (error) {
          try {
            transaction.abort();
            await done;
          } catch {
            // Preserve the synchronous enqueue error.
          }
          throw error;
        }
        await done;
      } finally {
        database.close();
      }
    },
    async cleanupExceptIds(retainedIds) {
      const retained = new Set(retainedIds);
      const database = await openPhotoDatabase(factory);
      try {
        const readTransaction = database.transaction(IR_REPORT_PHOTOS_STORE_NAME, "readonly");
        const readDone = transactionDone(readTransaction);
        const keys = await requestResult(readTransaction.objectStore(IR_REPORT_PHOTOS_STORE_NAME).getAllKeys());
        await readDone;
        const obsolete = keys.filter((key): key is string => typeof key === "string" && !retained.has(key));
        if (obsolete.length === 0) return;
        const writeTransaction = database.transaction(IR_REPORT_PHOTOS_STORE_NAME, "readwrite");
        const store = writeTransaction.objectStore(IR_REPORT_PHOTOS_STORE_NAME);
        const done = transactionDone(writeTransaction);
        try {
          for (const id of obsolete) store.delete(id);
        } catch (error) {
          try {
            writeTransaction.abort();
            await done;
          } catch {
            // Preserve the synchronous enqueue error.
          }
          throw error;
        }
        await done;
      } finally {
        database.close();
      }
    },
  };
}

let browserRepository: ReportPhotoRepository | null = null;
let serverMemoryRepository: ReportPhotoRepository | null = null;

export function getReportPhotoRepository(): ReportPhotoRepository {
  if (typeof window !== "undefined" && typeof indexedDB !== "undefined") {
    browserRepository ??= createIndexedDbReportPhotoRepository(indexedDB);
    return browserRepository;
  }
  serverMemoryRepository ??= createMemoryReportPhotoRepository();
  return serverMemoryRepository;
}

export type ReportPhotoIntegrityMetadata = Omit<ReportPhotoBlobRecord, "blob" | "originalName"> & {
  readonly originalName: string | null;
};

export async function resolveVerifiedReportPhoto(
  repository: ReportPhotoRepository,
  expected: ReportPhotoIntegrityMetadata,
): Promise<ReportPhotoBlobRecord> {
  const stored = await repository.read(expected.id);
  if (!stored) throw new Error("照片 Blob 缺失");
  if (!sameRecord(stored, {
    ...expected,
    blob: stored.blob,
  })) {
    throw new Error("照片 Blob integrity 与 canonical metadata 不一致");
  }
  return cloneRecord(stored);
}
