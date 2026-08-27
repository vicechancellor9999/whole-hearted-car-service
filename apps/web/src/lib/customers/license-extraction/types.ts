import type { LicenseImageTransform } from "./image-input";

export type LicenseExtractionField = "name" | "birthDate" | "sex" | "address";

export type LicenseExtractionProfile = Readonly<Partial<{
  name: string;
  birthDate: string;
  sex: "M" | "F";
  address: string;
}>>;

export type LicenseExtractionStatus = Readonly<Record<
  LicenseExtractionField,
  "extracted" | "manual_required"
>>;

export interface LicenseExtractionResult {
  readonly profile: LicenseExtractionProfile;
  readonly status: LicenseExtractionStatus;
}

export interface LicenseExtractionInput {
  readonly file: File;
  readonly transform: LicenseImageTransform;
  readonly signal: AbortSignal;
  readonly onProgress?: (percent: number) => void;
}

export interface LicenseExtractionClient {
  extract(input: LicenseExtractionInput): Promise<LicenseExtractionResult>;
}

export type LicenseExtractionClientFactory = () => LicenseExtractionClient;

export type LicenseExtractionErrorCode =
  | "LICENSE_EXTRACTION_INPUT_UNSUPPORTED"
  | "LICENSE_EXTRACTION_IMAGE_TOO_LARGE"
  | "LICENSE_EXTRACTION_UNAVAILABLE"
  | "LICENSE_EXTRACTION_RESPONSE_INVALID"
  | "LICENSE_EXTRACTION_TIMEOUT"
  | "LICENSE_EXTRACTION_CANCELLED";

export class LicenseExtractionError extends Error {
  constructor(readonly code: LicenseExtractionErrorCode, message: string) {
    super(message);
    this.name = "LicenseExtractionError";
  }
}

export interface PreparedLicenseEvidence {
  readonly id: string;
  readonly fileName: string;
  readonly url: string;
  readonly mimeType: "image/jpeg" | "image/png";
  readonly sizeBytes: number;
}

const FIELDS = ["name", "birthDate", "sex", "address"] as const;
const ROOT_KEYS = ["profile", "status"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NAME = /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u;
const UNSAFE_ADDRESS_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_NAME_LENGTH = 120;
const MAX_ADDRESS_LENGTH = 320;

function invalidResult(): never {
  throw new LicenseExtractionError(
    "LICENSE_EXTRACTION_RESPONSE_INVALID",
    "Invalid license extraction response",
  );
}

function exactEnumerableRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = [],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) return false;
  if (requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}

function isNonFutureDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return false;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return candidate.getTime() <= today;
}

function validExtractedField(field: LicenseExtractionField, value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (field === "name") return value.length <= MAX_NAME_LENGTH && NAME.test(value);
  if (field === "birthDate") return isNonFutureDate(value);
  if (field === "sex") return value === "M" || value === "F";
  return value.length <= MAX_ADDRESS_LENGTH
    && value.trim().length > 0
    && !UNSAFE_ADDRESS_CONTROL.test(value);
}

export function validateLicenseExtractionResult(value: unknown): LicenseExtractionResult {
  if (!exactEnumerableRecord(value, ROOT_KEYS, ROOT_KEYS)) invalidResult();
  const profileValue = value.profile;
  const statusValue = value.status;
  if (!exactEnumerableRecord(profileValue, FIELDS)) invalidResult();
  if (!exactEnumerableRecord(statusValue, FIELDS, FIELDS)) invalidResult();

  const profile: Partial<Record<LicenseExtractionField, string>> = {};
  const status = {} as Record<LicenseExtractionField, "extracted" | "manual_required">;
  for (const field of FIELDS) {
    const fieldStatus = statusValue[field];
    if (fieldStatus !== "extracted" && fieldStatus !== "manual_required") invalidResult();
    const hasValue = Object.prototype.hasOwnProperty.call(profileValue, field);
    if ((fieldStatus === "extracted") !== hasValue) invalidResult();
    if (hasValue) {
      const fieldValue = profileValue[field];
      if (validExtractedField(field, fieldValue)) {
        profile[field] = fieldValue;
      } else {
        status[field] = "manual_required";
        continue;
      }
    }
    status[field] = fieldStatus;
  }

  return Object.freeze({
    profile: Object.freeze(profile) as LicenseExtractionProfile,
    status: Object.freeze(status) as LicenseExtractionStatus,
  });
}
