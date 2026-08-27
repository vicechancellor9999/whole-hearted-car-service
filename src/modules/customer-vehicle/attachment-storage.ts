import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parseAppEnv } from "@formal/lib/env";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const allowedMediaTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);

export type StoredVehicleUpload = {
  storageKey: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256Hex: string;
};

export class AttachmentStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentStorageError";
  }
}

export function attachmentStorageRoot(
  source: Record<string, unknown> = process.env,
): string {
  const root = parseAppEnv(source).UPLOAD_ROOT;
  if (!isAbsolute(root)) {
    throw new AttachmentStorageError("附件存储目录必须是绝对路径");
  }
  return resolve(/*turbopackIgnore: true*/ root);
}

export async function storeVehicleUpload(
  file: File,
  options: { root?: string; now?: Date; uuid?: string } = {},
): Promise<StoredVehicleUpload> {
  const extension = allowedMediaTypes.get(file.type);
  if (!extension) throw new AttachmentStorageError("只允许 JPG、PNG、WebP 或 PDF 附件");
  if (file.size <= 0) throw new AttachmentStorageError("附件不能为空");
  if (file.size > MAX_FILE_BYTES) throw new AttachmentStorageError("单个附件不能超过 25 MB");
  const now = options.now ?? new Date();
  const root = resolve(/*turbopackIgnore: true*/ options.root ?? attachmentStorageRoot());
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const storageKey = `vehicle-files/${year}/${month}/${options.uuid ?? randomUUID()}.${extension}`;
  const destination = safeStoragePath(root, storageKey);
  const bytes = Buffer.from(await file.arrayBuffer());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: "wx" });
  return {
    storageKey,
    originalName: file.name.normalize("NFKC").trim() || `attachment.${extension}`,
    mediaType: file.type,
    sizeBytes: bytes.byteLength,
    sha256Hex: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function removeStoredVehicleUpload(
  storageKey: string,
  root = attachmentStorageRoot(),
): Promise<void> {
  await unlink(safeStoragePath(resolve(/*turbopackIgnore: true*/ root), storageKey)).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
    throw error;
  });
}

export function storedVehicleUploadPath(storageKey: string, root = attachmentStorageRoot()) {
  return safeStoragePath(resolve(/*turbopackIgnore: true*/ root), storageKey);
}

function safeStoragePath(root: string, storageKey: string) {
  const destination = resolve(root, storageKey);
  const within = relative(root, destination);
  if (!within || within.startsWith("..") || isAbsolute(within)) {
    throw new AttachmentStorageError("附件存储路径无效");
  }
  return destination;
}
