import sharp from "sharp";
import type { LicenseImageTransform } from "@/lib/customers/license-extraction/image-input";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 24_000_000;

export type PreparedCustomerDriverLicenseImage = {
  buffer: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
};

export class CustomerDriverLicenseImageError extends Error {
  readonly status = 400;
  constructor(message = "图片无法处理，请重新拍摄或选择较小图片") {
    super(message);
    this.name = "CustomerDriverLicenseImageError";
  }
}

export async function prepareCustomerDriverLicenseImage(
  file: File,
  transform: LicenseImageTransform,
): Promise<PreparedCustomerDriverLicenseImage> {
  if (!(file instanceof File) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw invalidImage();
  if (file.type !== "image/jpeg" && file.type !== "image/png") throw invalidFormat();
  validateTransform(transform);
  const input = Buffer.from(await file.arrayBuffer());
  if (!matchesSignature(input, file.type)) throw invalidFormat();

  try {
    const source = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw invalidImage();
    }
    const oriented = await source.autoOrient().rotate(transform.rotation).toBuffer();
    const orientedMetadata = await sharp(oriented).metadata();
    if (!orientedMetadata.width || !orientedMetadata.height) throw invalidImage();
    const crop = {
      left: Math.floor(transform.crop.x * orientedMetadata.width),
      top: Math.floor(transform.crop.y * orientedMetadata.height),
      width: Math.max(1, Math.round(transform.crop.width * orientedMetadata.width)),
      height: Math.max(1, Math.round(transform.crop.height * orientedMetadata.height)),
    };
    crop.width = Math.min(crop.width, orientedMetadata.width - crop.left);
    crop.height = Math.min(crop.height, orientedMetadata.height - crop.top);
    if (crop.width <= 0 || crop.height <= 0) throw invalidImage();
    const prepared = await sharp(oriented)
      .extract(crop)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: prepared.data,
      mimeType: "image/jpeg",
      width: prepared.info.width,
      height: prepared.info.height,
    };
  } catch (error) {
    if (error instanceof CustomerDriverLicenseImageError) throw error;
    throw invalidImage();
  }
}

function validateTransform(transform: LicenseImageTransform): void {
  if (!transform || ![0, 90, 180, 270].includes(transform.rotation) || !transform.crop) {
    throw invalidImage();
  }
  const crop = transform.crop;
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (Reflect.ownKeys(transform).length !== 2 || Reflect.ownKeys(crop).length !== 4 ||
      values.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
      crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) {
    throw invalidImage();
  }
}

function matchesSignature(bytes: Buffer, mediaType: string): boolean {
  if (mediaType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte);
}

function invalidFormat(): CustomerDriverLicenseImageError {
  return new CustomerDriverLicenseImageError("仅支持有效的 JPEG 或 PNG 驾驶证图片");
}

function invalidImage(): CustomerDriverLicenseImageError {
  return new CustomerDriverLicenseImageError("图片无法处理，请重新拍摄或选择较小图片");
}
