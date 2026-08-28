import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BusinessOrderAttachmentStorageError,
  removeStoredBusinessOrderUpload,
  storeBusinessOrderUpload,
  storedBusinessOrderUploadPath,
} from "@formal/modules/business-order/business-order-attachment-storage";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("business order attachment storage", () => {
  it("writes supported bytes beneath the business-order prefix and preserves the hash", async () => {
    root = await mkdtemp(join(tmpdir(), "wh-business-order-upload-"));
    const stored = await storeBusinessOrderUpload(
      new File(["signed-copy"], "客户签字.jpg", { type: "image/jpeg" }),
      { root, now: new Date("2026-08-28T12:00:00Z"), uuid: "fixed-id" },
    );
    expect(stored).toMatchObject({
      storageKey: "business-order-files/2026/08/fixed-id.jpg",
      originalName: "客户签字.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 11,
    });
    expect(stored.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
    await expect(readFile(storedBusinessOrderUploadPath(stored.storageKey, root), "utf8"))
      .resolves.toBe("signed-copy");
    await removeStoredBusinessOrderUpload(stored.storageKey, root);
    await expect(readFile(storedBusinessOrderUploadPath(stored.storageKey, root)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsupported files, empty files and path traversal", async () => {
    root = await mkdtemp(join(tmpdir(), "wh-business-order-upload-"));
    await expect(storeBusinessOrderUpload(
      new File(["bad"], "payload.exe", { type: "application/octet-stream" }),
      { root },
    )).rejects.toBeInstanceOf(BusinessOrderAttachmentStorageError);
    await expect(storeBusinessOrderUpload(
      new File([], "empty.pdf", { type: "application/pdf" }),
      { root },
    )).rejects.toBeInstanceOf(BusinessOrderAttachmentStorageError);
    expect(() => storedBusinessOrderUploadPath("../escape.jpg", root!))
      .toThrow(BusinessOrderAttachmentStorageError);
  });
});
