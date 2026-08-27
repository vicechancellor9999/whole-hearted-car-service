import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  EvidenceAssetError,
  MAX_EVIDENCE_ASSET_BYTES,
  validateAgreementEvidence,
} from "./evidence-assets";
import type { EvidenceAsset } from "./verification-types";

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function signatureBytes(asset: EvidenceAsset): Uint8Array {
  const base64 = asset.url.split(",")[1];
  if (!base64) throw new EvidenceAssetError();
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(base64, "base64"));
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function safeVisibleText(value: string): string {
  return [...value].map((character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return "";
    if (codePoint >= 0x20 && codePoint <= 0x7e) return character;
    return `[U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}]`;
  }).join("");
}

function assetId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `agreement-pdf-${crypto.randomUUID()}`
    : `agreement-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function createSignedAgreementPdf(input: {
  customerDisplayName: string;
  agreementVersion: string;
  signedBy: string;
  signedAt: string;
  signatureAsset: EvidenceAsset;
  actorId: string;
}): Promise<EvidenceAsset> {
  const placeholderPdf: EvidenceAsset = {
    id: "pending",
    fileName: "pending.pdf",
    url: "data:application/pdf;base64,JVBERi0xLjQK",
    mimeType: "application/pdf",
    sizeBytes: 9,
    createdAt: input.signedAt,
    createdBy: input.actorId,
  };
  validateAgreementEvidence({ signatureAsset: input.signatureAsset, signedDocumentAsset: placeholderPdf });

  const document = await PDFDocument.create();
  document.setTitle("Whole Hearted Car Service Agreement");
  document.setSubject(`Customer: ${input.customerDisplayName}\nSigned by: ${input.signedBy}`);
  document.setKeywords(["Whole Hearted Car Service", input.agreementVersion, input.customerDisplayName, input.signedBy]);
  const page = document.addPage([595.28, 841.89]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  let signature;
  try {
    signature = await document.embedPng(signatureBytes(input.signatureAsset));
  } catch {
    throw new EvidenceAssetError();
  }
  const { width: signatureWidth, height: signatureHeight } = signature.scaleToFit(180, 70);
  const lines = [
    "Whole Hearted Car Service Agreement",
    `Agreement version: ${safeVisibleText(input.agreementVersion)}`,
    `Customer: ${safeVisibleText(input.customerDisplayName)}`,
    `Signed by: ${safeVisibleText(input.signedBy)}`,
    `Signed at: ${safeVisibleText(input.signedAt)}`,
  ];
  lines.forEach((line, index) => page.drawText(line, {
    x: 54,
    y: 780 - index * 28,
    size: index === 0 ? 18 : 12,
    font,
    color: rgb(0.08, 0.12, 0.18),
  }));
  page.drawText("Signature", { x: 54, y: 574, size: 12, font });
  page.drawImage(signature, { x: 54, y: 490, width: signatureWidth, height: signatureHeight });

  const bytes = await document.save();
  if (bytes.byteLength > MAX_EVIDENCE_ASSET_BYTES) throw new EvidenceAssetError();
  const asset: EvidenceAsset = {
    id: assetId(),
    fileName: `agreement-${input.agreementVersion}.pdf`,
    url: `data:application/pdf;base64,${bytesToBase64(bytes)}`,
    mimeType: "application/pdf",
    sizeBytes: bytes.byteLength,
    createdAt: input.signedAt,
    createdBy: input.actorId,
  };
  validateAgreementEvidence({ signatureAsset: input.signatureAsset, signedDocumentAsset: asset });
  return asset;
}
