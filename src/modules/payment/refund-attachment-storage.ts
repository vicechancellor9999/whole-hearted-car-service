import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parseAppEnv } from "@/lib/env";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const allowedMediaTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);

export type StoredRefundUpload = {
  storageKey: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256Hex: string;
};

export class RefundAttachmentStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundAttachmentStorageError";
  }
}

export function isRefundUploadFile(value: unknown): value is File {
  return typeof value === "object" && value !== null
    && "name" in value && typeof value.name === "string"
    && "type" in value && typeof value.type === "string"
    && "size" in value && typeof value.size === "number"
    && value.size > 0
    && "arrayBuffer" in value && typeof value.arrayBuffer === "function";
}

export function refundAttachmentStorageRoot(
  source: Record<string, unknown> = process.env,
) {
  const root = parseAppEnv(source).UPLOAD_ROOT;
  if (!isAbsolute(root)) {
    throw new RefundAttachmentStorageError("退款附件存储目录必须是绝对路径");
  }
  return resolve(/*turbopackIgnore: true*/ root);
}

export async function storeRefundUpload(
  file: File,
  options: { root?: string; now?: Date; uuid?: string } = {},
): Promise<StoredRefundUpload> {
  const extension = allowedMediaTypes.get(file.type);
  if (!extension) {
    throw new RefundAttachmentStorageError("退款附件只允许 JPG、PNG、WebP 或 PDF");
  }
  if (file.size <= 0) throw new RefundAttachmentStorageError("退款附件不能为空");
  if (file.size > MAX_FILE_BYTES) {
    throw new RefundAttachmentStorageError("单个退款附件不能超过 25 MB");
  }
  const now = options.now ?? new Date();
  const root = resolve(
    /*turbopackIgnore: true*/ options.root ?? refundAttachmentStorageRoot(),
  );
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const storageKey = `refund-files/${year}/${month}/${options.uuid ?? randomUUID()}.${extension}`;
  const destination = safeRefundStoragePath(root, storageKey);
  const bytes = Buffer.from(await file.arrayBuffer());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: "wx" });
  return {
    storageKey,
    originalName: file.name.normalize("NFKC").trim() || `refund-evidence.${extension}`,
    mediaType: file.type,
    sizeBytes: bytes.byteLength,
    sha256Hex: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function removeStoredRefundUpload(
  storageKey: string,
  root = refundAttachmentStorageRoot(),
): Promise<void> {
  await unlink(safeRefundStoragePath(resolve(/*turbopackIgnore: true*/ root), storageKey))
    .catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) return;
      throw error;
    });
}

export function storedRefundUploadPath(
  storageKey: string,
  root = refundAttachmentStorageRoot(),
) {
  return safeRefundStoragePath(resolve(/*turbopackIgnore: true*/ root), storageKey);
}

function safeRefundStoragePath(root: string, storageKey: string) {
  const destination = resolve(root, storageKey);
  const within = relative(root, destination);
  if (
    !within ||
    within.startsWith("..") ||
    isAbsolute(within) ||
    !within.startsWith(`refund-files${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new RefundAttachmentStorageError("退款附件存储路径无效");
  }
  return destination;
}
