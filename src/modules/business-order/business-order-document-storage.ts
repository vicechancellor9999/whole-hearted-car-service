import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parseAppEnv } from "@formal/lib/env";

export type StoredBusinessOrderDocument = {
  storageKey: string;
  originalName: string;
  mediaType: "application/pdf";
  sizeBytes: number;
  sha256Hex: string;
};

export function businessOrderDocumentStorageRoot(
  source: Record<string, unknown> = process.env,
): string {
  const root = parseAppEnv(source).UPLOAD_ROOT;
  if (!isAbsolute(root)) throw new Error("打印文件存储目录必须是绝对路径");
  return resolve(/*turbopackIgnore: true*/ root);
}

export async function storeBusinessOrderDocumentPdf(input: {
  documentNo: string;
  revisionNo: number;
  bytes: Uint8Array;
  root?: string;
  now?: Date;
  language?: "zh" | "en";
}): Promise<StoredBusinessOrderDocument> {
  if (new TextDecoder().decode(input.bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("打印文件不是有效 PDF");
  }
  const now = input.now ?? new Date();
  const root = resolve(/*turbopackIgnore: true*/ input.root ?? businessOrderDocumentStorageRoot());
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const storageKey = `business-order-documents/${year}/${month}/${randomUUID()}.pdf`;
  const destination = safePath(root, storageKey);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, input.bytes, { flag: "wx" });
  return {
    storageKey,
    originalName: `${input.documentNo}-R${input.revisionNo}-${(input.language ?? "zh").toUpperCase()}.pdf`,
    mediaType: "application/pdf",
    sizeBytes: input.bytes.byteLength,
    sha256Hex: createHash("sha256").update(input.bytes).digest("hex"),
  };
}

export async function readBusinessOrderDocumentPdf(storageKey: string, root?: string) {
  return Uint8Array.from(await readFile(safePath(
    resolve(/*turbopackIgnore: true*/ root ?? businessOrderDocumentStorageRoot()),
    storageKey,
  )));
}

export async function removeBusinessOrderDocumentPdf(storageKey: string, root?: string) {
  await unlink(safePath(
    resolve(/*turbopackIgnore: true*/ root ?? businessOrderDocumentStorageRoot()),
    storageKey,
  )).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
    throw error;
  });
}

function safePath(root: string, storageKey: string) {
  const destination = resolve(root, storageKey);
  const within = relative(root, destination);
  const prefix = `business-order-documents${process.platform === "win32" ? "\\" : "/"}`;
  if (!within || within.startsWith("..") || isAbsolute(within) || !within.startsWith(prefix)) {
    throw new Error("打印文件存储路径无效");
  }
  return destination;
}
