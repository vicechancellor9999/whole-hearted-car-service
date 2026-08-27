import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { createSignedAgreementPdf } from "../../src/lib/customers/agreement-pdf";
import {
  createEvidenceAssetFromFile,
  finalizePreparedLicenseEvidence,
  prepareDriverLicenseEvidence,
  validatePreparedLicenseEvidence,
  validateAgreementEvidence,
  validateEvidenceAsset,
  validateKycEvidence,
} from "../../src/lib/customers/evidence-assets";
import type { EvidenceAsset } from "../../src/lib/customers/verification-types";

const NOW = "2026-08-12T09:00:00.000Z";
const SIGNATURE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==";

function asset(overrides: Partial<EvidenceAsset> = {}): EvidenceAsset {
  return {
    id: "asset-001",
    fileName: "evidence.png",
    url: SIGNATURE_DATA_URL,
    mimeType: "image/png",
    sizeBytes: 70,
    createdAt: NOW,
    createdBy: "emp-001",
    ...overrides,
  };
}

function expectEvidenceInvalid(action: () => unknown): void {
  try {
    action();
    throw new Error("expected evidence validation to fail");
  } catch (error) {
    expect(error).toMatchObject({ code: "EVIDENCE_ASSET_INVALID" });
  }
}

function highEntropyAscii(length: number): string {
  let state = 0x12345678;
  let value = "";
  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    value += String.fromCharCode(33 + (state % 94));
  }
  return value;
}

test("rejects blob URLs, unsupported MIME types, and oversized assets", () => {
  expect(() => validateEvidenceAsset(asset({ url: "blob:temporary" }))).toThrow(/EVIDENCE_ASSET_INVALID/);
  expect(() => validateEvidenceAsset(asset({ mimeType: "text/plain" as EvidenceAsset["mimeType"] }))).toThrow(/EVIDENCE_ASSET_INVALID/);
  expect(() => validateEvidenceAsset(asset({ sizeBytes: 524_289 }))).toThrow(/EVIDENCE_ASSET_INVALID/);
});

test("rejects a persisted metadata size that does not match the data URL bytes", () => {
  expect(() => validateEvidenceAsset(asset({ sizeBytes: 1 }))).toThrow(/EVIDENCE_ASSET_INVALID/);
});

test("rejects data URL MIME metadata mismatch and corrupt base64", () => {
  expectEvidenceInvalid(() => validateEvidenceAsset(asset({
    url: "data:application/pdf;base64,JVBERi0xLjQK",
    mimeType: "image/png",
    sizeBytes: 9,
  })));
  expectEvidenceInvalid(() => validateEvidenceAsset(asset({
    url: "data:image/png;base64,%%%%",
    sizeBytes: 70,
  })));
});

test("keeps generic evidence validation separate from KYC and agreement MIME policies", () => {
  const pdf = asset({
    fileName: "license.pdf",
    url: "data:application/pdf;base64,JVBERi0xLjQK",
    mimeType: "application/pdf",
    sizeBytes: 9,
  });
  const jpeg = asset({
    fileName: "signature.jpg",
    url: "data:image/jpeg;base64,/9j/2Q==",
    mimeType: "image/jpeg",
    sizeBytes: 4,
  });
  validateEvidenceAsset(pdf);
  expect(() => validateKycEvidence(pdf)).toThrow(/EVIDENCE_ASSET_INVALID/);
  expect(() => validateAgreementEvidence({ signatureAsset: jpeg, signedDocumentAsset: pdf })).toThrow(/EVIDENCE_ASSET_INVALID/);
  expect(() => validateAgreementEvidence({ signatureAsset: asset(), signedDocumentAsset: asset() })).toThrow(/EVIDENCE_ASSET_INVALID/);
});

test("rejects an electronic signed document that only claims to be a PDF", () => {
  const notPdf = asset({
    fileName: "not-a-pdf.pdf",
    url: "data:application/pdf;base64,bm90IGEgcGRm",
    mimeType: "application/pdf",
    sizeBytes: 9,
  });
  expect(() => validateAgreementEvidence({ signatureAsset: asset(), signedDocumentAsset: notPdf })).toThrow(
    /EVIDENCE_ASSET_INVALID/,
  );
});

test("rejects damaged image payloads with the controlled evidence error", async () => {
  const fakePng = asset({
    url: "data:image/png;base64,bm90IGEgcG5n",
    sizeBytes: 9,
  });
  const fakeJpeg = asset({
    url: "data:image/jpeg;base64,bm90IGEganBlZw==",
    mimeType: "image/jpeg",
    sizeBytes: 10,
  });
  expectEvidenceInvalid(() => validateKycEvidence(fakePng));
  expectEvidenceInvalid(() => validateKycEvidence(fakeJpeg));
  await expect(createSignedAgreementPdf({
    customerDisplayName: "Alicia Bennett",
    agreementVersion: "1.3",
    signedBy: "Alicia Bennett",
    signedAt: NOW,
    signatureAsset: fakePng,
    actorId: "emp-001",
  })).rejects.toMatchObject({ code: "EVIDENCE_ASSET_INVALID" });
});

test("converts an accepted runtime File into a persistent data URL", async () => {
  const file = new File([Buffer.from(SIGNATURE_DATA_URL.split(",")[1], "base64")], "signature.png", { type: "image/png" });
  const evidence = await createEvidenceAssetFromFile(file, "emp-001", () => NOW);
  expect(evidence).toMatchObject({
    fileName: "signature.png",
    mimeType: "image/png",
    createdAt: NOW,
    createdBy: "emp-001",
  });
  expect(evidence.url).toMatch(/^data:image\/png;base64,/);
  expect(evidence.sizeBytes).toBeLessThanOrEqual(524_288);
});

test("fails closed for an oversized image when DOM compression is unavailable", async () => {
  const file = new File([new Uint8Array(524_289)], "oversized.png", { type: "image/png" });
  await expect(createEvidenceAssetFromFile(file, "emp-001", () => NOW)).rejects.toMatchObject({
    code: "EVIDENCE_ASSET_INVALID",
  });
});

test("prepares only a browser-safe driver-license evidence draft and the store finalizer binds actor and clock", async () => {
  const bytes = Buffer.from(SIGNATURE_DATA_URL.split(",")[1], "base64");
  const draft = await prepareDriverLicenseEvidence(new File([bytes], "license.png", { type: "image/png" }));
  expect(Object.keys(draft).sort()).toEqual(["fileName", "id", "mimeType", "sizeBytes", "url"]);
  expect(JSON.stringify(draft)).not.toMatch(/createdAt|createdBy/);
  validatePreparedLicenseEvidence(draft);
  expect(finalizePreparedLicenseEvidence(draft, "frontdesk-001", NOW)).toMatchObject({
    ...draft, createdAt: NOW, createdBy: "frontdesk-001",
  });
});

test("license evidence rejects non-image magic even when MIME says PNG", async () => {
  await expect(prepareDriverLicenseEvidence(new File([Buffer.from("%PDF-1.7")], "license.png", {
    type: "image/png",
  }))).rejects.toMatchObject({ code: "EVIDENCE_ASSET_INVALID" });
});

test("creates a real signed PDF with persistent PDF evidence metadata", async () => {
  const pdf = await createSignedAgreementPdf({
    customerDisplayName: "Alicia Bennett",
    agreementVersion: "1.3",
    signedBy: "Alicia Bennett",
    signedAt: NOW,
    signatureAsset: asset(),
    actorId: "emp-001",
  });
  expect(pdf).toMatchObject({ mimeType: "application/pdf", createdBy: "emp-001" });
  expect(pdf.url).toMatch(/^data:application\/pdf;base64,/);
  expect(Buffer.from(pdf.url.split(",")[1], "base64").subarray(0, 5).toString("ascii")).toBe("%PDF-");
  validateEvidenceAsset(pdf);
});

test("normalizes an oversized generated agreement PDF to the controlled evidence error", async () => {
  await expect(createSignedAgreementPdf({
    customerDisplayName: highEntropyAscii(560_000),
    agreementVersion: "1.3",
    signedBy: "Alicia Bennett",
    signedAt: NOW,
    signatureAsset: asset(),
    actorId: "emp-001",
  })).rejects.toMatchObject({ code: "EVIDENCE_ASSET_INVALID" });
});

test("creates a bounded signed PDF for bilingual customer identities and retains Unicode metadata", async () => {
  const pdf = await createSignedAgreementPdf({
    customerDisplayName: "艾丽西亚·贝内特 / Alicia Bennett",
    agreementVersion: "1.3",
    signedBy: "艾丽西亚·贝内特",
    signedAt: NOW,
    signatureAsset: asset(),
    actorId: "emp-001",
  });
  const document = await PDFDocument.load(Buffer.from(pdf.url.split(",")[1], "base64"));
  expect(document.getSubject()).toContain("艾丽西亚·贝内特 / Alicia Bennett");
  expect(pdf.sizeBytes).toBeLessThanOrEqual(524_288);
  validateAgreementEvidence({ signatureAsset: asset(), signedDocumentAsset: pdf });
});
