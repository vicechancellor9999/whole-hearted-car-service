import type { EvidenceAsset } from "../verification-types";
import type { PreparedLicenseEvidence } from "./types";

export class PreparedEvidenceError extends Error { readonly code = "EVIDENCE_ASSET_INVALID" as const; constructor() { super("EVIDENCE_ASSET_INVALID"); } }
function invalid(): never { throw new PreparedEvidenceError(); }
function exact(value: unknown): value is Record<string, unknown> { const keys=["id","fileName","url","mimeType","sizeBytes"]; return !!value && typeof value === "object" && !Array.isArray(value) && Reflect.ownKeys(value).length===keys.length && keys.every((key)=>Object.prototype.hasOwnProperty.call(value,key)); }
export function validatePreparedLicenseEvidence(value: unknown): asserts value is PreparedLicenseEvidence { if (!exact(value)) invalid(); const draft=value as Record<string,unknown>; if (typeof draft.id!=="string" || typeof draft.fileName!=="string" || !draft.fileName || !Number.isInteger(draft.sizeBytes) || (draft.sizeBytes as number)<0 || (draft.sizeBytes as number)>524288 || (draft.mimeType!=="image/jpeg"&&draft.mimeType!=="image/png") || typeof draft.url!=="string" || !new RegExp(`^data:${draft.mimeType};base64,[A-Za-z0-9+/]+={0,2}$`).test(draft.url)) invalid(); }
export function finalizePreparedLicenseEvidence(draft: PreparedLicenseEvidence, actorId: string, occurredAt: string): EvidenceAsset { validatePreparedLicenseEvidence(draft); if (!actorId.trim() || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ$/.test(occurredAt)) invalid(); return { ...draft, createdAt: occurredAt, createdBy: actorId }; }
