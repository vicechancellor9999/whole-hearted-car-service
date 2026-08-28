import { expect, test } from "@playwright/test";
import {
  recognitionFromFields,
  validateCustomerLicenseRecognition,
} from "../../src/lib/customers/customer-driver-license-recognition";
import {
  parseJamaicaDriverLicenseText,
  recognizeCustomerDriverLicense,
} from "../../src/lib/server/customer-driver-license-recognizer";
import type { AiServiceSettings } from "../../src/lib/server/ai-service-settings";

test("customer driver license DTO rejects extra keys and downgrades invalid fields", () => {
  expect(() => validateCustomerLicenseRecognition({
    fields: { name: "A", birthDate: null, sex: null, address: null, raw: "secret" },
    status: { name: "extracted", birthDate: "manual_required", sex: "manual_required", address: "manual_required" },
  })).toThrow();

  expect(recognitionFromFields({
    name: "  ALICIA BENNETT  ",
    birthDate: "2099-01-01",
    sex: "X",
    address: "12 Ocean Road\u0000raw",
  }, new Date("2026-08-27T00:00:00Z"))).toEqual({
    fields: {
      name: "ALICIA BENNETT",
      birthDate: null,
      sex: null,
      address: null,
    },
    status: {
      name: "extracted",
      birthDate: "manual_required",
      sex: "manual_required",
      address: "manual_required",
    },
  });
});

test("customer driver license OpenAI adapter uses strict non-stored four-field output", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const result = await recognizeCustomerDriverLicense({
    buffer: Buffer.from("prepared-image"),
    mimeType: "image/jpeg",
    width: 100,
    height: 60,
  }, {
    credential: { provider: "openai", apiKey: "sk-private", openAiModel: "gpt-4.1-nano" },
    fetcher: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ output_text: JSON.stringify({
        name: "ALICIA BENNETT",
        birthDate: "1990-06-15",
        sex: "F",
        address: "12 Ocean View Road",
      }) });
    },
    now: new Date("2026-08-27T00:00:00Z"),
  });

  expect(requestBody).toMatchObject({
    model: "gpt-4.1-nano",
    store: false,
    text: { format: { type: "json_schema", strict: true } },
  });
  expect(JSON.stringify(requestBody)).not.toContain("rawOcr");
  expect(result).toEqual({
    fields: {
      name: "ALICIA BENNETT",
      birthDate: "1990-06-15",
      sex: "F",
      address: "12 Ocean View Road",
    },
    status: { name: "extracted", birthDate: "extracted", sex: "extracted", address: "extracted" },
  });
});

test("customer driver license Google parser is deterministic and leaves missing fields manual", async () => {
  expect(parseJamaicaDriverLicenseText([
    "NAME: ALICIA BENNETT",
    "DATE OF BIRTH: 15/06/1990",
    "SEX: F",
    "ADDRESS: 12 OCEAN VIEW ROAD",
  ].join("\n"))).toEqual({
    name: "ALICIA BENNETT",
    birthDate: "1990-06-15",
    sex: "F",
    address: "12 OCEAN VIEW ROAD",
  });

  const result = await recognizeCustomerDriverLicense({
    buffer: Buffer.from("prepared-image"),
    mimeType: "image/jpeg",
    width: 100,
    height: 60,
  }, {
    credential: { provider: "google", apiKey: "google-private", openAiModel: "gpt-4.1-nano" },
    fetcher: async () => Response.json({ responses: [{ fullTextAnnotation: {
      text: "NAME: DAVID BROWN\nSEX: M",
    } }] }),
    now: new Date("2026-08-27T00:00:00Z"),
  });
  expect(result).toEqual({
    fields: { name: "DAVID BROWN", birthDate: null, sex: "M", address: null },
    status: {
      name: "extracted",
      birthDate: "manual_required",
      sex: "extracted",
      address: "manual_required",
    },
  });
});

test("customer driver license falls back when the first provider returns incomplete fields", async () => {
  const settings: AiServiceSettings = {
    version: 2,
    providers: {
      deepseek: { enabled: false, apiKey: null, baseUrl: null },
      openai: { enabled: true, apiKey: "openai-private", baseUrl: null },
      google: { enabled: true, apiKey: "google-private", baseUrl: null },
      compatible: { enabled: false, apiKey: null, baseUrl: null },
    },
    routes: {
      text: { enabled: false, autoFallback: true, steps: [] },
      customer_license: { enabled: true, autoFallback: true, steps: [
        { provider: "openai", model: "gpt-4.1" },
        { provider: "google", model: "document-text" },
      ] },
      vehicle_document: { enabled: false, autoFallback: true, steps: [] },
    },
    updatedAt: new Date(0).toISOString(),
  };
  const calls: string[] = [];
  const result = await recognizeCustomerDriverLicense({
    buffer: Buffer.from("prepared-image"), mimeType: "image/jpeg", width: 100, height: 60,
  }, {
    settings,
    recordEvent: async () => {},
    now: new Date("2026-08-27T00:00:00Z"),
    fetcher: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("openai.com")) return Response.json({ output_text: JSON.stringify({ name: "DAVID BROWN", birthDate: null, sex: null, address: null }) });
      return Response.json({ responses: [{ fullTextAnnotation: { text: "NAME: DAVID BROWN\nDATE OF BIRTH: 02/01/1984\nSEX: M\nADDRESS: 4 KING STREET" } }] });
    },
  });
  expect(calls).toHaveLength(2);
  expect(result.fields).toEqual({ name: "DAVID BROWN", birthDate: "1984-01-02", sex: "M", address: "4 KING STREET" });
});
