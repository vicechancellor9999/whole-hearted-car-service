import { expect, test } from "@playwright/test";
import sharp from "sharp";
import {
  prepareVehicleDocumentImage,
  VEHICLE_DOCUMENT_RECOGNITION_PROMPT,
} from "../../src/lib/server/vehicle-document-image";

test("portrait vehicle documents are normalized to landscape before recognition", async () => {
  const portrait = await sharp({
    create: { width: 120, height: 240, channels: 3, background: "#d9eef7" },
  }).jpeg().toBuffer();

  const prepared = await prepareVehicleDocumentImage(portrait, "image/jpeg");

  expect(prepared.width).toBe(240);
  expect(prepared.height).toBe(120);
  expect(prepared.mimeType).toBe("image/jpeg");
});

test("large vehicle documents are reduced to a 1024 pixel long edge for faster recognition", async () => {
  const largePortrait = await sharp({
    create: { width: 1_200, height: 2_000, channels: 3, background: "#d9eef7" },
  }).jpeg().toBuffer();

  const prepared = await prepareVehicleDocumentImage(largePortrait, "image/jpeg");

  expect(prepared.width).toBe(1_024);
  expect(prepared.height).toBe(614);
});

test("recognition instructions make handwritten corrections authoritative and identify CHASSIS NO as VIN", () => {
  expect(VEHICLE_DOCUMENT_RECOGNITION_PROMPT).toContain("handwritten");
  expect(VEHICLE_DOCUMENT_RECOGNITION_PROMPT).toContain("overrides");
  expect(VEHICLE_DOCUMENT_RECOGNITION_PROMPT).toContain("CHASSIS NO");
  expect(VEHICLE_DOCUMENT_RECOGNITION_PROMPT).toContain("17-character VIN");
});
