import { expect, test } from "@playwright/test";
import {
  mergeVehicleRecognition,
  parseVehicleDocumentText,
  parseVehicleVinRegionText,
} from "../../src/lib/customers/vehicle-photo-recognition";
import {
  capturedVehiclePhotoName,
  documentCameraConstraints,
  selectVehicleDocumentImage,
} from "../../src/lib/customers/vehicle-document-camera";

test("vehicle photo recognition parses Jamaican registration fields", () => {
  const result = parseVehicleDocumentText(`
    REGISTRATION NUMBER 7012 AB
    CHASSIS NO. JHLRD7880BC123456
    ENGINE NO. R20A9123456
    MAKE HONDA
    MODEL CR-V EX
    YEAR 2021
    COLOUR SILVER
    BODY TYPE STN/WAGON
    SEATING CAPACITY 5
    CC RATING 1997
    FUEL PETROL
  `);

  expect(result).toEqual({
    plate: "7012AB",
    vin: "JHLRD7880BC123456",
    engineNumber: "R20A9123456",
    make: "HONDA",
    model: "CR-V EX",
    year: "2021",
    color: "SILVER",
    bodyType: "STN/WAGON",
    seating: "5",
    ccRating: "1997",
    fuelType: "PETROL",
  });
});

test("vehicle photo recognition can recover a plate and VIN without labels", () => {
  expect(parseVehicleDocumentText("HONDA 4321 AB 1HGBH41JXMN109186")).toMatchObject({
    plate: "4321AB",
    vin: "1HGBH41JXMN109186",
  });
});

test("vehicle photo recognition falls back when OCR separates the plate label and value", () => {
  expect(parseVehicleDocumentText(`
    LA. A937 8824
    REG. PLATE NO. ISSUING OFFICER'S SIGNATURE
    4597JC 77N MVRD 05254740
  `)).toMatchObject({ plate: "4597JC" });
});

test("vehicle photo recognition parses stacked Jamaican certificate labels", () => {
  expect(parseVehicleDocumentText(`
    TYPE OF VEHICLE
    MOTOR CAR
    MODEL/MFG. TYPE
    CRV
    C.C. RATING
    1998
    REG. PLATE NO.
    4597JC
    MAKE
    HONDA
    SEATING ENGINE NO.
    5 K20A45902118
    FUEL
    PETROL
  `)).toMatchObject({
    plate: "4597JC",
    make: "HONDA",
    model: "CRV",
    engineNumber: "K20A45902118",
    seating: "5",
    ccRating: "1998",
    fuelType: "PETROL",
  });
});

test("vehicle photo recognition joins a VIN split over two OCR lines only when it becomes exactly 17 characters", () => {
  expect(parseVehicleVinRegionText("CHASSIS NO.\nJHLRD58806C2024\n06")).toBe("JHLRD58806C202406");
  expect(parseVehicleVinRegionText("CHASSIS NO.\nJHLRD58806C2024")).toBeUndefined();
});

test("recognized fields fill blanks without erasing manual values", () => {
  expect(mergeVehicleRecognition(
    { plate: "P 1234", make: "Toyota", model: "", year: "" },
    { plate: "7012 AB", make: "HONDA", model: "CR-V", year: "2021", color: "SILVER" },
  )).toEqual({
    plate: "P 1234",
    make: "Toyota",
    model: "CR-V",
    year: "2021",
    color: "SILVER",
  });
});

test("vehicle photo recognition drops implausible OCR values", () => {
  expect(parseVehicleDocumentText(`
    YEAR 3026
    SEATING CAPACITY 99
    CC RATING 99999
    CHASSIS NO. NOT-A-VIN
  `)).toEqual({});
});

test("desktop document camera requests a sharp rear-facing stream without audio", () => {
  expect(documentCameraConstraints()).toEqual({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 2560 },
      height: { ideal: 1440 },
    },
  });
  expect(capturedVehiclePhotoName(new Date("2026-08-24T23:00:01.000Z"))).toBe("vehicle-scan-20260824-180001.jpg");
});

test("dragged or pasted content selects the first supported vehicle image", () => {
  const text = new File(["not an image"], "note.txt", { type: "text/plain" });
  const image = new File([new Uint8Array([137, 80, 78, 71])], "registration.png", { type: "image/png" });

  expect(selectVehicleDocumentImage([text, image])).toEqual({ file: image });
  expect(selectVehicleDocumentImage([text])).toEqual({ error: "仅支持 JPEG 或 PNG 图片" });
});

test("dragged or pasted vehicle images reject files larger than 12 MB", () => {
  const oversized = new File([new Uint8Array(12 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" });
  expect(selectVehicleDocumentImage([oversized])).toEqual({ error: "图片必须小于 12 MB" });
});

test("new vehicle records start off site until a mechanic accepts a repair round", async () => {
  const source = await import("../../src/lib/api/mock-customers");
  const store = source.createMockCustomerVehicleStore();
  const access = { actorId: "superadmin", role: "superadmin" };
  const preview = store.previewVehicle(access, {
    plate: "5000MA",
    make: "BMW",
    model: "X5 XDRIVE",
    year: 2018,
    relationships: [],
  });
  const created = store.createVehicle(access, {
    ...preview.input,
    previewToken: preview.previewToken,
  });

  expect(created.status).toBe("off_site");
});
