import { LicenseExtractionError } from "./types";

export interface NormalizedRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export interface LicenseImageTransform { readonly rotation: 0 | 90 | 180 | 270; readonly crop: NormalizedRect; }
export interface LicenseImageSource { readonly file: File; readonly transform: LicenseImageTransform; }
export interface DecodedLicenseImage { readonly width: number; readonly height: number; readonly close?: () => void; }

export const MAX_LICENSE_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_LICENSE_IMAGE_PIXELS = 24_000_000;

function unsupported(): never { throw new LicenseExtractionError("LICENSE_EXTRACTION_INPUT_UNSUPPORTED", "Unsupported driver-license image"); }
function tooLarge(): never { throw new LicenseExtractionError("LICENSE_EXTRACTION_IMAGE_TOO_LARGE", "Driver-license image is too large"); }

function isJpeg(bytes: Uint8Array): boolean { return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff; }
function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

export async function assertLicenseImageInput(
  file: File,
  decode: (file: File) => Promise<DecodedLicenseImage>,
): Promise<DecodedLicenseImage> {
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_LICENSE_IMAGE_BYTES) {
    if (file instanceof File && file.size > MAX_LICENSE_IMAGE_BYTES) tooLarge();
    unsupported();
  }
  if (file.type !== "image/jpeg" && file.type !== "image/png") unsupported();
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if ((file.type === "image/jpeg" && !isJpeg(bytes)) || (file.type === "image/png" && !isPng(bytes))) unsupported();
  let image: DecodedLicenseImage;
  try {
    image = await decode(file);
  } catch {
    unsupported();
  }
  try {
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) unsupported();
    if (image.width * image.height > MAX_LICENSE_IMAGE_PIXELS) tooLarge();
    return image;
  } catch (error) {
    try { image?.close?.(); } catch { /* preserve the stable validation error */ }
    if (error instanceof LicenseExtractionError) throw error;
    unsupported();
  }
}

export function assertLicenseImageTransform(value: LicenseImageTransform): void {
  const rotations = new Set([0, 90, 180, 270]);
  const crop = value?.crop;
  if (!rotations.has(value?.rotation) || !crop || Reflect.ownKeys(value).length !== 2 || Reflect.ownKeys(crop).length !== 4) unsupported();
  for (const number of [crop.x, crop.y, crop.width, crop.height]) if (!Number.isFinite(number) || number < 0 || number > 1) unsupported();
  if (crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) unsupported();
}
