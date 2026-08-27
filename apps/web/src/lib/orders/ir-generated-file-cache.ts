import type { IrPdfLanguage } from "./ir-pdf";

export const IR_GENERATED_FILES_DB_NAME = "wh_ir_generated_files_v1";
export const IR_GENERATED_FILES_STORE_NAME = "files";

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
const REQUIRED_LANGUAGES: ReadonlyArray<IrPdfLanguage> = ["zh", "en", "bilingual"];

export interface IrGeneratedFileRecord {
  readonly id: string;
  readonly bundleId: string;
  readonly reportId: string;
  readonly quotationId: string;
  readonly language: IrPdfLanguage;
  readonly fileName: string;
  readonly mediaType: "application/pdf";
  readonly bytes: Uint8Array;
}

export interface IrGeneratedFileRepository {
  writeBundle(files: ReadonlyArray<IrGeneratedFileRecord>): Promise<void>;
  read(id: string): Promise<IrGeneratedFileRecord | null>;
  readBundle(attachmentIds: ReadonlyArray<string>): Promise<IrGeneratedFileRecord[] | null>;
  deleteBundle(bundleId: string): Promise<void>;
  /** Removes complete bundles that no canonical Quotation can currently reach. */
  cleanupExceptBundleIds(retainedBundleIds: ReadonlyArray<string>): Promise<void>;
}

function cloneRecord(record: IrGeneratedFileRecord): IrGeneratedFileRecord {
  return { ...record, bytes: record.bytes.slice() };
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= PDF_SIGNATURE.length
    && PDF_SIGNATURE.every((value, index) => bytes[index] === value);
}

function validateBundle(files: ReadonlyArray<IrGeneratedFileRecord>): IrGeneratedFileRecord[] {
  if (!Array.isArray(files) || files.length !== REQUIRED_LANGUAGES.length) {
    throw new Error("A generated-file bundle must contain exactly three PDF languages");
  }
  const bundleId = files[0]?.bundleId;
  const reportId = files[0]?.reportId;
  const quotationId = files[0]?.quotationId;
  if (!bundleId?.trim() || !reportId?.trim() || !quotationId?.trim()) {
    throw new Error("Generated-file bundle identity is incomplete");
  }
  const languageSet = new Set<IrPdfLanguage>();
  const idSet = new Set<string>();
  for (const file of files) {
    if (
      !file.id?.trim()
      || file.bundleId !== bundleId
      || file.reportId !== reportId
      || file.quotationId !== quotationId
      || file.mediaType !== "application/pdf"
      || !file.fileName?.trim()
    ) {
      throw new Error("Generated-file bundle records must share one identity");
    }
    if (!REQUIRED_LANGUAGES.includes(file.language) || languageSet.has(file.language)) {
      throw new Error("Generated-file bundle must contain each language exactly once");
    }
    if (idSet.has(file.id)) throw new Error("Generated-file attachment IDs must be unique");
    if (!(file.bytes instanceof Uint8Array) || !isPdf(file.bytes)) {
      throw new Error("Generated-file bytes have an invalid PDF signature");
    }
    languageSet.add(file.language);
    idSet.add(file.id);
  }
  if (!REQUIRED_LANGUAGES.every((language) => languageSet.has(language))) {
    throw new Error("Generated-file bundle is missing a required language");
  }
  return REQUIRED_LANGUAGES.map((language) => cloneRecord(files.find((file) => file.language === language)!));
}

function validateResolvedBundle(files: ReadonlyArray<IrGeneratedFileRecord>, requestedIds: ReadonlyArray<string>): IrGeneratedFileRecord[] | null {
  if (requestedIds.length !== REQUIRED_LANGUAGES.length || new Set(requestedIds).size !== REQUIRED_LANGUAGES.length) return null;
  if (files.length !== REQUIRED_LANGUAGES.length) return null;
  try {
    const normalized = validateBundle(files);
    if (new Set(normalized.map((file) => file.id)).size !== requestedIds.length) return null;
    if (!requestedIds.every((id) => normalized.some((file) => file.id === id))) return null;
    return normalized;
  } catch {
    return null;
  }
}

export interface MemoryIrGeneratedFileRepositoryOptions {
  /** Shared backend is only for deterministic reload tests; values are always cloned. */
  readonly backend?: Map<string, IrGeneratedFileRecord>;
}

export interface MemoryIrGeneratedFileRepository extends IrGeneratedFileRepository {
  failNextWrite(error: Error): void;
  failNextCleanup(error: Error): void;
}

export function createMemoryIrGeneratedFileRepository(
  options: MemoryIrGeneratedFileRepositoryOptions = {},
): MemoryIrGeneratedFileRepository {
  const backend = options.backend ?? new Map<string, IrGeneratedFileRecord>();
  let nextWriteFailure: Error | null = null;
  let nextCleanupFailure: Error | null = null;
  return {
    failNextWrite(error) {
      nextWriteFailure = error;
    },
    failNextCleanup(error) {
      nextCleanupFailure = error;
    },
    async writeBundle(files) {
      const normalized = validateBundle(files);
      if (nextWriteFailure) {
        const failure = nextWriteFailure;
        nextWriteFailure = null;
        throw failure;
      }
      // A copied map models one atomic transaction: callers never observe a
      // partially written language set even when validation or commit fails.
      const next = new Map([...backend].map(([id, file]) => [id, cloneRecord(file)]));
      for (const file of normalized) next.set(file.id, cloneRecord(file));
      backend.clear();
      for (const [id, file] of next) backend.set(id, file);
    },
    async read(id) {
      const file = backend.get(id);
      return file ? cloneRecord(file) : null;
    },
    async readBundle(attachmentIds) {
      const records = attachmentIds.flatMap((id) => {
        const file = backend.get(id);
        return file ? [cloneRecord(file)] : [];
      });
      return validateResolvedBundle(records, attachmentIds);
    },
    async deleteBundle(bundleId) {
      for (const [id, file] of backend) {
        if (file.bundleId === bundleId) backend.delete(id);
      }
    },
    async cleanupExceptBundleIds(retainedBundleIds) {
      if (nextCleanupFailure) {
        const failure = nextCleanupFailure;
        nextCleanupFailure = null;
        throw failure;
      }
      const retained = new Set(retainedBundleIds);
      for (const [id, file] of backend) {
        if (!retained.has(file.bundleId)) backend.delete(id);
      }
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

async function openGeneratedFilesDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(IR_GENERATED_FILES_DB_NAME, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(IR_GENERATED_FILES_STORE_NAME)) {
      const store = database.createObjectStore(IR_GENERATED_FILES_STORE_NAME, { keyPath: "id" });
      store.createIndex("bundleId", "bundleId", { unique: false });
    }
  };
  return requestResult(request);
}

export function createIndexedDbIrGeneratedFileRepository(factory: IDBFactory): IrGeneratedFileRepository {
  return {
    async writeBundle(files) {
      const normalized = validateBundle(files);
      const database = await openGeneratedFilesDatabase(factory);
      try {
        const transaction = database.transaction(IR_GENERATED_FILES_STORE_NAME, "readwrite");
        const store = transaction.objectStore(IR_GENERATED_FILES_STORE_NAME);
        for (const file of normalized) store.put(cloneRecord(file));
        await transactionDone(transaction);
      } finally {
        database.close();
      }
    },
    async read(id) {
      const database = await openGeneratedFilesDatabase(factory);
      try {
        const transaction = database.transaction(IR_GENERATED_FILES_STORE_NAME, "readonly");
        const record = await requestResult(transaction.objectStore(IR_GENERATED_FILES_STORE_NAME).get(id)) as IrGeneratedFileRecord | undefined;
        await transactionDone(transaction);
        return record ? cloneRecord(record) : null;
      } finally {
        database.close();
      }
    },
    async readBundle(attachmentIds) {
      const database = await openGeneratedFilesDatabase(factory);
      try {
        const transaction = database.transaction(IR_GENERATED_FILES_STORE_NAME, "readonly");
        const store = transaction.objectStore(IR_GENERATED_FILES_STORE_NAME);
        const records = await Promise.all(attachmentIds.map(async (id) => (
          requestResult(store.get(id)) as Promise<IrGeneratedFileRecord | undefined>
        )));
        await transactionDone(transaction);
        return validateResolvedBundle(records.flatMap((record) => record ? [cloneRecord(record)] : []), attachmentIds);
      } finally {
        database.close();
      }
    },
    async deleteBundle(bundleId) {
      const database = await openGeneratedFilesDatabase(factory);
      try {
        const transaction = database.transaction(IR_GENERATED_FILES_STORE_NAME, "readwrite");
        const index = transaction.objectStore(IR_GENERATED_FILES_STORE_NAME).index("bundleId");
        const keys = await requestResult(index.getAllKeys(bundleId));
        const store = transaction.objectStore(IR_GENERATED_FILES_STORE_NAME);
        for (const key of keys) store.delete(key);
        await transactionDone(transaction);
      } finally {
        database.close();
      }
    },
    async cleanupExceptBundleIds(retainedBundleIds) {
      const database = await openGeneratedFilesDatabase(factory);
      try {
        const retained = new Set(retainedBundleIds);
        const transaction = database.transaction(IR_GENERATED_FILES_STORE_NAME, "readwrite");
        const store = transaction.objectStore(IR_GENERATED_FILES_STORE_NAME);
        const records = await requestResult(store.getAll()) as IrGeneratedFileRecord[];
        for (const record of records) {
          if (!retained.has(record.bundleId)) store.delete(record.id);
        }
        await transactionDone(transaction);
      } finally {
        database.close();
      }
    },
  };
}

let browserRepository: IrGeneratedFileRepository | null = null;
let serverMemoryRepository: IrGeneratedFileRepository | null = null;

export function getIrGeneratedFileRepository(): IrGeneratedFileRepository {
  if (typeof window !== "undefined" && typeof indexedDB !== "undefined") {
    browserRepository ??= createIndexedDbIrGeneratedFileRepository(indexedDB);
    return browserRepository;
  }
  serverMemoryRepository ??= createMemoryIrGeneratedFileRepository();
  return serverMemoryRepository;
}
