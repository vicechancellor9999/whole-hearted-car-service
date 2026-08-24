import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  AttachmentStorageError,
  attachmentStorageRoot,
  removeStoredVehicleUpload,
  storeVehicleUpload,
  storedVehicleUploadPath,
} from "@/modules/customer-vehicle/attachment-storage";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("vehicle attachment storage", () => {
  it("uses the validated formal UPLOAD_ROOT setting", () => {
    expect(attachmentStorageRoot({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://wholehearted:test@db:5432/wholehearted_test",
      APP_ORIGIN: "http://127.0.0.1:3211",
      APP_TIMEZONE: "America/Jamaica",
      SESSION_COOKIE_NAME: "wh_session",
      SESSION_TOKEN_PEPPER: "0123456789abcdef0123456789abcdef",
      UPLOAD_ROOT: "/srv/wholehearted/uploads",
    })).toBe("/srv/wholehearted/uploads");
  });

  it("writes an allowed upload under a generated relative key and hashes its bytes", async () => {
    root = await mkdtemp(join(tmpdir(), "wh-formal-upload-"));
    const stored = await storeVehicleUpload(
      new File(["formal-photo"], "接车照片.jpg", { type: "image/jpeg" }),
      { root, now: new Date("2026-08-24T10:00:00Z"), uuid: "fixed-id" },
    );
    expect(stored).toMatchObject({
      storageKey: "vehicle-files/2026/08/fixed-id.jpg",
      originalName: "接车照片.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 12,
    });
    await expect(readFile(storedVehicleUploadPath(stored.storageKey, root), "utf8"))
      .resolves.toBe("formal-photo");
    await removeStoredVehicleUpload(stored.storageKey, root);
    await expect(readFile(storedVehicleUploadPath(stored.storageKey, root)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects executable or path-like upload types", async () => {
    root = await mkdtemp(join(tmpdir(), "wh-formal-upload-"));
    await expect(
      storeVehicleUpload(new File(["bad"], "malware.exe", { type: "application/octet-stream" }), { root }),
    ).rejects.toBeInstanceOf(AttachmentStorageError);
    expect(() => storedVehicleUploadPath("../escape.jpg", root!)).toThrow(AttachmentStorageError);
  });
});
