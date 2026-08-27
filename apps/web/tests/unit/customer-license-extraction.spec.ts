import { expect, test } from "@playwright/test";
import {
  LicenseExtractionError,
  validateLicenseExtractionResult,
  type LicenseExtractionInput,
  type LicenseExtractionResult,
} from "../../src/lib/customers/license-extraction/types";
import { createBrowserLicenseExtractionClient } from "../../src/lib/customers/license-extraction/browser-client";
import { createMockLicenseExtractionClient } from "../../src/lib/customers/license-extraction/mock-client";
import {
  assertLicenseImageInput,
  assertLicenseImageTransform,
  MAX_LICENSE_IMAGE_BYTES,
} from "../../src/lib/customers/license-extraction/image-input";

const MANUAL_STATUS = {
  name: "manual_required",
  birthDate: "manual_required",
  sex: "manual_required",
  address: "manual_required",
} as const;

const EXTRACTION_RESULT: LicenseExtractionResult = {
  profile: {
    name: "Alicia Bennett",
    birthDate: "1988-03-22",
    sex: "F",
    address: "12 Constant Spring Road, Kingston 8, Jamaica",
  },
  status: {
    name: "extracted",
    birthDate: "extracted",
    sex: "extracted",
    address: "extracted",
  },
};

function pngFile(name = "synthetic-license.png") {
  return new File([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  ], name, { type: "image/png" });
}

function validInput(signal = new AbortController().signal): LicenseExtractionInput {
  return {
    file: pngFile(),
    transform: { rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } },
    signal,
  };
}

async function expectCode(promise: Promise<unknown>, code: LicenseExtractionError["code"]) {
  try {
    await promise;
    throw new Error("expected extraction error");
  } catch (error) {
    expect(error).toBeInstanceOf(LicenseExtractionError);
    expect(error).toMatchObject({ code });
  }
}

test("default browser client is unavailable and never fabricates values", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network must not be used");
  };
  try {
    const client = createBrowserLicenseExtractionClient(undefined);
    await expectCode(client.extract(validInput()), "LICENSE_EXTRACTION_UNAVAILABLE");
    expect(fetchCalls).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safe result rejects a fifth field and raw provider metadata", () => {
  expect(() => validateLicenseExtractionResult({
    profile: { name: "Synthetic Person", licenseNumber: "FORBIDDEN" },
    status: MANUAL_STATUS,
    confidence: 99,
  })).toThrowError(expect.objectContaining({ code: "LICENSE_EXTRACTION_RESPONSE_INVALID" }));
});

test("safe result rejects hidden, symbol, and inconsistent structural status values", () => {
  const hidden = { profile: {}, status: MANUAL_STATUS };
  Object.defineProperty(hidden, "providerRaw", { value: "forbidden", enumerable: false });
  const symbol = { profile: {}, status: { ...MANUAL_STATUS, [Symbol("raw")]: "forbidden" } };
  const missingExtractedValue = { profile: {}, status: { ...MANUAL_STATUS, name: "extracted" } };
  const valueMarkedManual = {
    profile: { name: "Forbidden echo" },
    status: MANUAL_STATUS,
  };
  const invalidStatus = { profile: {}, status: { ...MANUAL_STATUS, name: "recognized" } };

  for (const value of [hidden, symbol, missingExtractedValue, valueMarkedManual, invalidStatus]) {
    expect(() => validateLicenseExtractionResult(value)).toThrowError(
      expect.objectContaining({ code: "LICENSE_EXTRACTION_RESPONSE_INVALID" }),
    );
  }
});

test("safe result accepts the exact 120-character name and 320-character address caps", () => {
  const atCaps = {
    profile: { name: "N".repeat(120), address: "A".repeat(320) },
    status: { ...MANUAL_STATUS, name: "extracted", address: "extracted" },
  } as const;

  expect(validateLicenseExtractionResult(atCaps)).toEqual(atCaps);
});

test("safe result downgrades over-cap fields without truncating or echoing provider text", () => {
  const overlongName = "N".repeat(121);
  const overlongAddress = "A".repeat(321);
  const result = validateLicenseExtractionResult({
    profile: {
      name: overlongName,
      birthDate: "1988-03-22",
      sex: "F",
      address: overlongAddress,
    },
    status: {
      name: "extracted",
      birthDate: "extracted",
      sex: "extracted",
      address: "extracted",
    },
  });

  expect(result).toEqual({
    profile: { birthDate: "1988-03-22", sex: "F" },
    status: {
      name: "manual_required",
      birthDate: "extracted",
      sex: "extracted",
      address: "manual_required",
    },
  });
  expect(JSON.stringify(result)).not.toContain(overlongName);
  expect(JSON.stringify(result)).not.toContain(overlongAddress);
});

test("safe result locally downgrades empty and invalid fields while preserving valid fields", () => {
  expect(validateLicenseExtractionResult({
    profile: {
      name: "",
      birthDate: "2999-01-01",
      sex: "Female",
      address: "Unsafe\u0007address",
    },
    status: {
      name: "extracted",
      birthDate: "extracted",
      sex: "extracted",
      address: "extracted",
    },
  })).toEqual({
    profile: {},
    status: MANUAL_STATUS,
  });
});

test("safe result returns only an immutable four-field DTO without normalizing provider text", () => {
  const input = {
    profile: { name: "Alicia Bennett", address: "Line 1\nLine 2" },
    status: { ...MANUAL_STATUS, name: "extracted", address: "extracted" },
  };
  expect(validateLicenseExtractionResult(input)).toEqual(input);
});

test("explicit mock scenario returns only its configured result and reports progress", async () => {
  const progress: number[] = [];
  const client = createMockLicenseExtractionClient({ kind: "result", result: EXTRACTION_RESULT });
  const result = await client.extract({ ...validInput(), onProgress: (percent) => progress.push(percent) });
  expect(result).toEqual(EXTRACTION_RESULT);
  expect(progress).toEqual([100]);
});

test("mock scenario never reads or derives values from arbitrary file content", async () => {
  const file = pngFile("arbitrary-user-content.png");
  Object.defineProperty(file, "arrayBuffer", {
    value: () => { throw new Error("mock must not inspect file bytes"); },
  });
  const client = createMockLicenseExtractionClient({ kind: "result", result: EXTRACTION_RESULT });
  await expect(client.extract({ ...validInput(), file })).resolves.toEqual(EXTRACTION_RESULT);
});

test("mock scenario honors an already-aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = createMockLicenseExtractionClient({ kind: "result", result: EXTRACTION_RESULT });
  await expectCode(client.extract(validInput(controller.signal)), "LICENSE_EXTRACTION_CANCELLED");
});

test("image validation keeps JPEG/PNG signatures, byte limit, pixel limit, and exact transforms", async () => {
  const image = await assertLicenseImageInput(pngFile(), async () => ({ width: 6000, height: 4000 }));
  expect(image).toEqual({ width: 6000, height: 4000 });
  assertLicenseImageTransform({ rotation: 270, crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 } });

  await expectCode(
    assertLicenseImageInput(new File([new Uint8Array(MAX_LICENSE_IMAGE_BYTES + 1)], "large.png", { type: "image/png" }), async () => ({ width: 1, height: 1 })),
    "LICENSE_EXTRACTION_IMAGE_TOO_LARGE",
  );
  expect(() => assertLicenseImageTransform({ rotation: 0, crop: { x: 0, y: 0, width: 1.01, height: 1 } }))
    .toThrowError(expect.objectContaining({ code: "LICENSE_EXTRACTION_INPUT_UNSUPPORTED" }));
});
