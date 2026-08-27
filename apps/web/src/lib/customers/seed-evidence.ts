import type { EvidenceAsset } from "./verification-types";

const EVIDENCE_KEYS = [
  "id", "fileName", "url", "mimeType", "sizeBytes", "createdAt", "createdBy",
] as const;

function frozenAsset(asset: EvidenceAsset): Readonly<EvidenceAsset> {
  return Object.freeze(asset);
}

export const SEED_EVIDENCE_ASSETS = Object.freeze({
  aliciaDriversLicenseFront: frozenAsset({
    id: "EVID-UAT-ALICIA-DL-FRONT",
    fileName: "alicia-bennett-drivers-license-front.png",
    url: "/seed-evidence/alicia-bennett-drivers-license-front.png",
    mimeType: "image/png",
    sizeBytes: 436_194,
    createdAt: "2026-01-14T09:25:00.000Z",
    createdBy: "uat-seed",
  }),
  aliciaAgreementSignature: frozenAsset({
    id: "EVID-UAT-ALICIA-AGR-SIG",
    fileName: "alicia-bennett-agreement-v1.3-signature.png",
    url: "/seed-evidence/alicia-bennett-agreement-v1.3-signature.png",
    mimeType: "image/png",
    sizeBytes: 379_334,
    createdAt: "2026-05-16T09:55:00.000Z",
    createdBy: "uat-seed",
  }),
  aliciaSignedAgreement: frozenAsset({
    id: "EVID-UAT-ALICIA-AGR-PDF",
    fileName: "alicia-bennett-agreement-v1.3-signed.pdf",
    url: "/seed-evidence/alicia-bennett-agreement-v1.3-signed.pdf",
    mimeType: "application/pdf",
    sizeBytes: 486_923,
    createdAt: "2026-05-16T10:00:00.000Z",
    createdBy: "uat-seed",
  }),
  demoPaperAgreementScan: frozenAsset({
    id: "EVID-UAT-PAPER-AGR-SCAN",
    fileName: "demo-paper-agreement-scan.png",
    url: "/seed-evidence/demo-paper-agreement-scan.png",
    mimeType: "image/png",
    sizeBytes: 397_801,
    createdAt: "2026-06-01T10:00:00.000Z",
    createdBy: "uat-seed",
  }),
} as const);

export const ALICIA_LICENSE_PROFILE_FIXTURE = Object.freeze({
  name: "Alicia Bennett",
  birthDate: "1988-03-22",
  sex: "F",
  address: "12 Constant Spring Road, Kingston 8, Jamaica",
} as const);

const registeredAssets = Object.freeze(Object.values(SEED_EVIDENCE_ASSETS));
const registeredIds = new Set(registeredAssets.map((asset) => asset.id));

function hasExactEvidenceKeys(value: object): boolean {
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === EVIDENCE_KEYS.length
    && keys.every((key) => typeof key === "string" && EVIDENCE_KEYS.includes(key as typeof EVIDENCE_KEYS[number]));
}

export function isExactSeedEvidenceAsset(value: unknown): boolean {
  if (!value || typeof value !== "object" || !hasExactEvidenceKeys(value)) return false;
  const candidate = value as Record<typeof EVIDENCE_KEYS[number], unknown>;
  return registeredAssets.some((registered) => EVIDENCE_KEYS.every((key) => candidate[key] === registered[key]));
}

export function isSeedEvidenceIdentity(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { id?: unknown; url?: unknown };
  return (typeof candidate.id === "string" && registeredIds.has(candidate.id))
    || (typeof candidate.url === "string" && candidate.url.startsWith("/seed-evidence/"));
}
