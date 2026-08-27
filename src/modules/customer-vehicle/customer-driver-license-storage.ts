import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import sharp from "sharp";
import { parseAppEnv } from "@formal/lib/env";

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 24_000_000;
const MAX_OUTPUT_EDGE = 2400;

export type CustomerLicenseImageTransform = {
  rotation: 0 | 90 | 180 | 270;
  crop: { x: number; y: number; width: number; height: number } | null;
};

export type StoredCustomerDriverLicenseUpload = {
  storageKey: string;
  originalName: string;
  mediaType: "image/jpeg" | "image/png";
  sizeBytes: number;
  sha256Hex: string;
};

export class CustomerDriverLicenseStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerDriverLicenseStorageError";
  }
}

export function customerDriverLicenseStorageRoot(
  source: Record<string, unknown> = process.env,
): string {
  const root = parseAppEnv(source).UPLOAD_ROOT;
  if (!isAbsolute(root)) {
    throw new CustomerDriverLicenseStorageError("附件存储目录必须是绝对路径");
  }
  return resolve(/*turbopackIgnore: true*/ root);
}

export async function storeCustomerDriverLicenseUpload(
  file: File,
  transform: CustomerLicenseImageTransform,
  options: { root?: string; now?: Date; uuid?: string } = {},
): Promise<StoredCustomerDriverLicenseUpload> {
  const format = file.type === "image/jpeg"
    ? { extension: "jpg", mediaType: "image/jpeg" as const }
    : file.type === "image/png"
      ? { extension: "png", mediaType: "image/png" as const }
      : null;
  if (!format) throw invalidFormat();
  if (file.size <= 0 || file.size > MAX_INPUT_BYTES) throw invalidImage();
  if (![0, 90, 180, 270].includes(transform.rotation)) throw invalidImage();
  const uuid = options.uuid ?? randomUUID();
  if (!/^[A-Za-z0-9-]+$/.test(uuid)) throw invalidImage();

  const input = Buffer.from(await file.arrayBuffer());
  if (!matchesSignature(input, format.mediaType)) throw invalidFormat();

  let output: Buffer;
  try {
    const source = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    });
    const sourceMetadata = await source.metadata();
    if (!sourceMetadata.width || !sourceMetadata.height ||
        sourceMetadata.width * sourceMetadata.height > MAX_INPUT_PIXELS) {
      throw invalidImage();
    }

    const oriented = await source.autoOrient().rotate(transform.rotation).toBuffer();
    const orientedMetadata = await sharp(oriented).metadata();
    if (!orientedMetadata.width || !orientedMetadata.height) throw invalidImage();

    let prepared = sharp(oriented, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS });
    if (transform.crop) {
      const crop = intersectCrop(transform.crop, orientedMetadata.width, orientedMetadata.height);
      prepared = prepared.extract(crop);
    }
    prepared = prepared.resize({
      width: MAX_OUTPUT_EDGE,
      height: MAX_OUTPUT_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });
    output = format.mediaType === "image/jpeg"
      ? await prepared.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
      : await prepared.png({ compressionLevel: 9 }).toBuffer();
  } catch (error) {
    if (error instanceof CustomerDriverLicenseStorageError) throw error;
    throw invalidImage();
  }
  if (output.byteLength <= 0 || output.byteLength > MAX_OUTPUT_BYTES) throw invalidImage();

  const now = options.now ?? new Date();
  const root = resolve(/*turbopackIgnore: true*/ options.root ?? customerDriverLicenseStorageRoot());
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const storageKey = `customer-license-files/${year}/${month}/${uuid}.${format.extension}`;
  const destination = safeStoragePath(root, storageKey);
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(destination, output, { flag: "wx" });
  } catch {
    throw new CustomerDriverLicenseStorageError("驾驶证图片无法保存，请重试");
  }

  return {
    storageKey,
    originalName: file.name.normalize("NFKC").trim().slice(0, 255) || `license.${format.extension}`,
    mediaType: format.mediaType,
    sizeBytes: output.byteLength,
    sha256Hex: createHash("sha256").update(output).digest("hex"),
  };
}

export async function removeStoredCustomerDriverLicenseUpload(
  storageKey: string,
  root = customerDriverLicenseStorageRoot(),
): Promise<void> {
  await unlink(safeStoragePath(resolve(/*turbopackIgnore: true*/ root), storageKey)).catch(
    (error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    },
  );
}

export function storedCustomerDriverLicenseUploadPath(
  storageKey: string,
  root = customerDriverLicenseStorageRoot(),
): string {
  return safeStoragePath(resolve(/*turbopackIgnore: true*/ root), storageKey);
}

function matchesSignature(bytes: Buffer, mediaType: "image/jpeg" | "image/png"): boolean {
  if (mediaType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte);
}

function intersectCrop(
  crop: CustomerLicenseImageTransform["crop"] & object,
  width: number,
  height: number,
) {
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (values.some((value) => !Number.isFinite(value)) || crop.width <= 0 || crop.height <= 0) {
    throw invalidImage();
  }
  const left = Math.max(0, Math.floor(crop.x));
  const top = Math.max(0, Math.floor(crop.y));
  const right = Math.min(width, Math.ceil(crop.x + crop.width));
  const bottom = Math.min(height, Math.ceil(crop.y + crop.height));
  if (left >= right || top >= bottom) throw invalidImage();
  return { left, top, width: right - left, height: bottom - top };
}

function safeStoragePath(root: string, storageKey: string): string {
  const destination = resolve(root, storageKey);
  const within = relative(root, destination);
  if (!within || within.startsWith("..") || isAbsolute(within)) {
    throw new CustomerDriverLicenseStorageError("附件存储路径无效");
  }
  return destination;
}

function invalidFormat(): CustomerDriverLicenseStorageError {
  return new CustomerDriverLicenseStorageError("仅支持有效的 JPEG 或 PNG 驾驶证图片");
}

function invalidImage(): CustomerDriverLicenseStorageError {
  return new CustomerDriverLicenseStorageError("图片无法处理，请重新拍摄或选择较小图片");
}
