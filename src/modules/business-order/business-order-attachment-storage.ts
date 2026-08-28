import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parseAppEnv } from "@formal/lib/env";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);

export type StoredBusinessOrderUpload = {
  storageKey: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256Hex: string;
};

export class BusinessOrderAttachmentStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessOrderAttachmentStorageError";
  }
}

export function businessOrderAttachmentStorageRoot(
  source: Record<string, unknown> = process.env,
): string {
  const root = parseAppEnv(source).UPLOAD_ROOT;
  if (!isAbsolute(root)) {
    throw new BusinessOrderAttachmentStorageError("附件存储目录必须是绝对路径");
  }
  return resolve(/*turbopackIgnore: true*/ root);
}

export function isBusinessOrderUploadFile(value: unknown): value is File {
  return typeof value === "object" && value !== null
    && "name" in value && typeof value.name === "string"
    && "type" in value && typeof value.type === "string"
    && "size" in value && typeof value.size === "number"
    && value.size > 0
    && "arrayBuffer" in value && typeof value.arrayBuffer === "function";
}

export async function storeBusinessOrderUpload(
  file: File,
  options: { root?: string; now?: Date; uuid?: string } = {},
): Promise<StoredBusinessOrderUpload> {
  const extension = ALLOWED_MEDIA_TYPES.get(file.type);
  if (!extension) {
    throw new BusinessOrderAttachmentStorageError("业务附件只允许 JPG、PNG、WebP 或 PDF");
  }
  if (file.size <= 0) throw new BusinessOrderAttachmentStorageError("业务附件不能为空");
  if (file.size > MAX_FILE_BYTES) {
    throw new BusinessOrderAttachmentStorageError("单个业务附件不能超过 25 MB");
  }
  const now = options.now ?? new Date();
  const root = resolve(/*turbopackIgnore: true*/ options.root ?? businessOrderAttachmentStorageRoot());
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const storageKey = `business-order-files/${year}/${month}/${options.uuid ?? randomUUID()}.${extension}`;
  const destination = safeStoragePath(root, storageKey);
  const bytes = Buffer.from(await file.arrayBuffer());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: "wx" });
  return {
    storageKey,
    originalName: file.name.normalize("NFKC").trim() || `business-order-attachment.${extension}`,
    mediaType: file.type,
    sizeBytes: bytes.byteLength,
    sha256Hex: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function removeStoredBusinessOrderUpload(
  storageKey: string,
  root = businessOrderAttachmentStorageRoot(),
): Promise<void> {
  await unlink(safeStoragePath(resolve(/*turbopackIgnore: true*/ root), storageKey)).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
    throw error;
  });
}

export function storedBusinessOrderUploadPath(
  storageKey: string,
  root = businessOrderAttachmentStorageRoot(),
): string {
  return safeStoragePath(resolve(/*turbopackIgnore: true*/ root), storageKey);
}

function safeStoragePath(root: string, storageKey: string): string {
  const destination = resolve(root, storageKey);
  const within = relative(root, destination);
  const prefix = `business-order-files${process.platform === "win32" ? "\\" : "/"}`;
  if (!within || within.startsWith("..") || isAbsolute(within) || !within.startsWith(prefix)) {
    throw new BusinessOrderAttachmentStorageError("业务附件存储路径无效");
  }
  return destination;
}
