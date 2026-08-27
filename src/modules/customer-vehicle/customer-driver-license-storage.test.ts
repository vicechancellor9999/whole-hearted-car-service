import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  CustomerDriverLicenseStorageError,
  removeStoredCustomerDriverLicenseUpload,
  storeCustomerDriverLicenseUpload,
  storedCustomerDriverLicenseUploadPath,
} from "@formal/modules/customer-vehicle/customer-driver-license-storage";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

async function fixture(
  width: number,
  height: number,
  format: "jpeg" | "png" = "jpeg",
): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 100, b: 180 } },
  });
  return format === "jpeg" ? image.jpeg().toBuffer() : image.png().toBuffer();
}

function blobPart(bytes: Buffer): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

describe("customer driver-license storage", () => {
  it.each([
    ["image/jpeg", "jpg", "jpeg"],
    ["image/png", "png", "png"],
  ] as const)("stores a valid %s using a safe immutable key", async (mediaType, extension, format) => {
    root = await mkdtemp(join(tmpdir(), "wh-license-upload-"));
    const stored = await storeCustomerDriverLicenseUpload(
      new File([blobPart(await fixture(1200, 800, format))], `license.${extension}`, { type: mediaType }),
      { rotation: 0, crop: null },
      { root, now: new Date("2026-08-27T10:00:00Z"), uuid: "fixed-license" },
    );

    expect(stored).toMatchObject({
      storageKey: `customer-license-files/2026/08/fixed-license.${extension}`,
      originalName: `license.${extension}`,
      mediaType,
    });
    expect(stored.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.sizeBytes).toBeGreaterThan(0);
    expect(stored.sizeBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    const bytes = await readFile(storedCustomerDriverLicenseUploadPath(stored.storageKey, root));
    expect(bytes.byteLength).toBe(stored.sizeBytes);

    await expect(storeCustomerDriverLicenseUpload(
      new File([blobPart(await fixture(1200, 800, format))], `second.${extension}`, { type: mediaType }),
      { rotation: 0, crop: null },
      { root, now: new Date("2026-08-27T10:00:00Z"), uuid: "fixed-license" },
    )).rejects.toBeInstanceOf(CustomerDriverLicenseStorageError);
  });

  it("rejects empty, oversized, signature-mismatched, and over-24MP images", async () => {
    root = await mkdtemp(join(tmpdir(), "wh-license-upload-"));
    const transform = { rotation: 0 as const, crop: null };
    await expect(storeCustomerDriverLicenseUpload(
      new File([], "empty.jpg", { type: "image/jpeg" }), transform, { root },
    )).rejects.toThrow("图片无法处理，请重新拍摄或选择较小图片");
    await expect(storeCustomerDriverLicenseUpload(
      new File([blobPart(Buffer.alloc(25 * 1024 * 1024 + 1))], "large.jpg", { type: "image/jpeg" }),
      transform,
      { root },
    )).rejects.toThrow("图片无法处理，请重新拍摄或选择较小图片");
    await expect(storeCustomerDriverLicenseUpload(
      new File([blobPart(await fixture(100, 100, "png"))], "wrong.jpg", { type: "image/jpeg" }),
      transform,
      { root },
    )).rejects.toThrow("仅支持有效的 JPEG 或 PNG 驾驶证图片");
    await expect(storeCustomerDriverLicenseUpload(
      new File([blobPart(await fixture(5000, 5000))], "too-many-pixels.jpg", { type: "image/jpeg" }),
      transform,
      { root },
    )).rejects.toThrow("图片无法处理，请重新拍摄或选择较小图片");
  });

  it("applies rotation and crop, and limits the long edge to 2400 pixels", async () => {
    root = await mkdtemp(join(tmpdir(), "wh-license-upload-"));
    const cropped = await storeCustomerDriverLicenseUpload(
      new File([blobPart(await fixture(3000, 1000))], "crop.jpg", { type: "image/jpeg" }),
      { rotation: 90, crop: { x: 0, y: 0, width: 1, height: 0.5 } },
      { root, uuid: "crop" },
    );
    await expect(sharp(storedCustomerDriverLicenseUploadPath(cropped.storageKey, root)).metadata())
      .resolves.toMatchObject({ width: 1000, height: 1500 });

    const resized = await storeCustomerDriverLicenseUpload(
      new File([blobPart(await fixture(4000, 1000))], "resize.jpg", { type: "image/jpeg" }),
      { rotation: 0, crop: null },
      { root, uuid: "resize" },
    );
    await expect(sharp(storedCustomerDriverLicenseUploadPath(resized.storageKey, root)).metadata())
      .resolves.toMatchObject({ width: 2400, height: 600 });
  });

  it("rejects prepared output above 5 MiB and removes a stored upload", async () => {
    root = await mkdtemp(join(tmpdir(), "wh-license-upload-"));
    const noisy = await sharp(randomBytes(2400 * 2400 * 3), {
      raw: { width: 2400, height: 2400, channels: 3 },
    }).png({ compressionLevel: 0 }).toBuffer();
    await expect(storeCustomerDriverLicenseUpload(
      new File([blobPart(noisy)], "noisy.png", { type: "image/png" }),
      { rotation: 0, crop: null },
      { root, uuid: "noisy" },
    )).rejects.toThrow("图片无法处理，请重新拍摄或选择较小图片");

    const stored = await storeCustomerDriverLicenseUpload(
      new File([blobPart(await fixture(300, 200))], "remove.jpg", { type: "image/jpeg" }),
      { rotation: 0, crop: null },
      { root, uuid: "remove" },
    );
    await removeStoredCustomerDriverLicenseUpload(stored.storageKey, root);
    await expect(readFile(storedCustomerDriverLicenseUploadPath(stored.storageKey, root)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
