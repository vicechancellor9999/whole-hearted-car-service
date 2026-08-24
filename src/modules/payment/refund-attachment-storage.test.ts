import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  RefundAttachmentStorageError,
  removeStoredRefundUpload,
  storeRefundUpload,
  storedRefundUploadPath,
} from "@/modules/payment/refund-attachment-storage";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("refund attachment storage", () => {
  it("stores a refund proof under the refund-only directory", async () => {
    root = await mkdtemp(join(tmpdir(), "wh-refund-upload-"));
    const stored = await storeRefundUpload(
      new File(["signed-refund"], "退款签收.jpg", { type: "image/jpeg" }),
      { root, now: new Date("2026-08-24T15:00:00Z"), uuid: "fixed-proof" },
    );
    expect(stored).toMatchObject({
      storageKey: "refund-files/2026/08/fixed-proof.jpg",
      originalName: "退款签收.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 13,
    });
    await expect(readFile(storedRefundUploadPath(stored.storageKey, root), "utf8"))
      .resolves.toBe("signed-refund");
    await removeStoredRefundUpload(stored.storageKey, root);
  });

  it("rejects unsupported or unsafe refund evidence", async () => {
    root = await mkdtemp(join(tmpdir(), "wh-refund-upload-"));
    await expect(storeRefundUpload(
      new File(["bad"], "evidence.exe", { type: "application/octet-stream" }),
      { root },
    )).rejects.toBeInstanceOf(RefundAttachmentStorageError);
    expect(() => storedRefundUploadPath("../escape.pdf", root!))
      .toThrow(RefundAttachmentStorageError);
  });
});
