import type { EvidenceAsset } from "./verification-types";
import type { PreparedLicenseEvidence } from "./license-extraction/types";
import { finalizePreparedLicenseEvidence as finalizePure, PreparedEvidenceError, validatePreparedLicenseEvidence as validatePure } from "./license-extraction/prepared-evidence";
import { isExactSeedEvidenceAsset, isSeedEvidenceIdentity } from "./seed-evidence";

export const MAX_EVIDENCE_ASSET_BYTES = 524_288;

type EvidenceMimeType = EvidenceAsset["mimeType"];

export class EvidenceAssetError extends Error {
  readonly code = "EVIDENCE_ASSET_INVALID" as const;

  constructor(message = "EVIDENCE_ASSET_INVALID") {
    super(message);
    this.name = "EvidenceAssetError";
  }
}

function invalidEvidence(): never {
  throw new EvidenceAssetError();
}

function assertEvidenceMimeType(mimeType: string): asserts mimeType is EvidenceMimeType {
  if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "application/pdf") {
    invalidEvidence();
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) invalidEvidence();
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(base64, "base64"));
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readDataUrl(url: string): { mimeType: EvidenceMimeType; bytes: Uint8Array } {
  const match = /^data:(image\/jpeg|image\/png|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match) invalidEvidence();
  const [, mimeType, base64] = match;
  assertEvidenceMimeType(mimeType);
  return { mimeType, bytes: base64ToBytes(base64) };
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function hasJpegSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function validateImageSignature(asset: EvidenceAsset): void {
  if (isExactSeedEvidenceAsset(asset)) return;
  const { bytes } = readDataUrl(asset.url);
  if (
    (asset.mimeType === "image/png" && !hasPngSignature(bytes)) ||
    (asset.mimeType === "image/jpeg" && !hasJpegSignature(bytes))
  ) {
    invalidEvidence();
  }
}

function evidenceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `evidence-${crypto.randomUUID()}`
    : `evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function dataUrl(mimeType: EvidenceMimeType, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

async function compressImageFile(file: File): Promise<Uint8Array> {
  if (typeof document === "undefined" || typeof Image === "undefined" || typeof URL.createObjectURL !== "function") {
    invalidEvidence();
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new EvidenceAssetError());
      element.src = sourceUrl;
    });
    let width = image.naturalWidth;
    let height = image.naturalHeight;
    for (let pass = 0; pass < 10; pass += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) invalidEvidence();
      context.drawImage(image, 0, 0, width, height);
      const qualities = file.type === "image/jpeg" ? [0.85, 0.7, 0.55, 0.4] : [undefined];
      for (const quality of qualities) {
        const candidate = readDataUrl(canvas.toDataURL(file.type, quality));
        if (candidate.bytes.byteLength <= MAX_EVIDENCE_ASSET_BYTES) return candidate.bytes;
      }
      width = Math.max(1, Math.floor(width * 0.7));
      height = Math.max(1, Math.floor(height * 0.7));
    }
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
  invalidEvidence();
}

export function validateEvidenceAsset(asset: EvidenceAsset): void {
  if (!asset || typeof asset.id !== "string" || typeof asset.url !== "string") invalidEvidence();
  if (isSeedEvidenceIdentity(asset)) {
    if (!isExactSeedEvidenceAsset(asset)) invalidEvidence();
    return;
  }
  if (asset.url.startsWith("blob:") || !Number.isInteger(asset.sizeBytes) || asset.sizeBytes < 0 || asset.sizeBytes > MAX_EVIDENCE_ASSET_BYTES) {
    invalidEvidence();
  }
  assertEvidenceMimeType(asset.mimeType);
  const parsed = readDataUrl(asset.url);
  if (parsed.mimeType !== asset.mimeType || parsed.bytes.byteLength !== asset.sizeBytes) invalidEvidence();
}

export function validateKycEvidence(frontAsset: EvidenceAsset, backAsset?: EvidenceAsset): void {
  validateEvidenceAsset(frontAsset);
  if (frontAsset.mimeType === "application/pdf") invalidEvidence();
  validateImageSignature(frontAsset);
  if (backAsset) {
    validateEvidenceAsset(backAsset);
    if (backAsset.mimeType === "application/pdf") invalidEvidence();
    validateImageSignature(backAsset);
  }
}

export function validateAgreementEvidence(input: {
  signatureAsset: EvidenceAsset;
  signedDocumentAsset: EvidenceAsset;
}): void {
  validateEvidenceAsset(input.signatureAsset);
  validateEvidenceAsset(input.signedDocumentAsset);
  if (input.signatureAsset.mimeType !== "image/png" || input.signedDocumentAsset.mimeType !== "application/pdf") {
    invalidEvidence();
  }
  validateImageSignature(input.signatureAsset);
  if (isExactSeedEvidenceAsset(input.signedDocumentAsset)) return;
  const documentBytes = readDataUrl(input.signedDocumentAsset.url).bytes;
  if (
    documentBytes[0] !== 0x25 ||
    documentBytes[1] !== 0x50 ||
    documentBytes[2] !== 0x44 ||
    documentBytes[3] !== 0x46 ||
    documentBytes[4] !== 0x2d
  ) {
    invalidEvidence();
  }
}

export async function createEvidenceAssetFromFile(
  file: File,
  actorId: string,
  clock: () => string,
): Promise<EvidenceAsset> {
  assertEvidenceMimeType(file.type);
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_EVIDENCE_ASSET_BYTES) {
    if (file.type === "application/pdf") invalidEvidence();
    bytes = await compressImageFile(file);
  }
  if (bytes.byteLength > MAX_EVIDENCE_ASSET_BYTES) invalidEvidence();
  const asset: EvidenceAsset = {
    id: evidenceId(),
    fileName: file.name,
    url: dataUrl(file.type, bytes),
    mimeType: file.type,
    sizeBytes: bytes.byteLength,
    createdAt: clock(),
    createdBy: actorId,
  };
  validateEvidenceAsset(asset);
  return asset;
}

function hasPreparedLicenseEvidenceKeys(value: unknown): value is PreparedLicenseEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = ["id", "fileName", "url", "mimeType", "sizeBytes"];
  return Reflect.ownKeys(record).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

export function validatePreparedLicenseEvidence(value: unknown): asserts value is PreparedLicenseEvidence {
  try { validatePure(value); } catch (error) { if (error instanceof PreparedEvidenceError) invalidEvidence(); throw error; }
  const asset = { ...value, createdAt: "2000-01-01T00:00:00.000Z", createdBy: "browser-draft" } as EvidenceAsset;
  if (asset.mimeType !== "image/jpeg" && asset.mimeType !== "image/png") invalidEvidence();
  validateEvidenceAsset(asset);
  validateImageSignature(asset);
}

export async function prepareDriverLicenseEvidence(file: File): Promise<PreparedLicenseEvidence> {
  if (!(file instanceof File) || (file.type !== "image/jpeg" && file.type !== "image/png")) invalidEvidence();
  let bytes = new Uint8Array(await file.arrayBuffer());
  const signatureAsset = { id: "draft", fileName: file.name, url: dataUrl(file.type, bytes), mimeType: file.type, sizeBytes: bytes.byteLength, createdAt: "2000-01-01T00:00:00.000Z", createdBy: "browser-draft" } as EvidenceAsset;
  validateImageSignature(signatureAsset);
  if (bytes.byteLength > MAX_EVIDENCE_ASSET_BYTES) bytes = await compressImageFile(file);
  const draft: PreparedLicenseEvidence = { id: evidenceId(), fileName: file.name, url: dataUrl(file.type, bytes), mimeType: file.type, sizeBytes: bytes.byteLength };
  validatePreparedLicenseEvidence(draft);
  return draft;
}

export function finalizePreparedLicenseEvidence(draft: PreparedLicenseEvidence, actorId: string, occurredAt: string): EvidenceAsset {
  let asset: EvidenceAsset;
  try { asset = finalizePure(draft, actorId, occurredAt); } catch (error) { if (error instanceof PreparedEvidenceError) invalidEvidence(); throw error; }
  validateEvidenceAsset(asset);
  return asset;
}
