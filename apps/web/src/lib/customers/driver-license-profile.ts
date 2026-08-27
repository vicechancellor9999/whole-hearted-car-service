import type { DriverLicenseProfile } from "./verification-types";

export const DRIVER_LICENSE_NAME_MAX = 120;
export const DRIVER_LICENSE_ADDRESS_MAX = 320;

const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/u;
const DATA_URL = /data\s*:/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const PROFILE_KEYS = ["name", "birthDate", "sex", "address"] as const;

function invalidProfile(): never {
  throw new Error("DRIVER_LICENSE_PROFILE_INVALID");
}

function normalizedText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || CONTROL_CHARACTER.test(value) || DATA_URL.test(value)) {
    return invalidProfile();
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length < 1 || normalized.length > maximum) return invalidProfile();
  return normalized;
}

function normalizedBirthDate(value: unknown): string {
  if (typeof value !== "string" || CONTROL_CHARACTER.test(value) || DATA_URL.test(value)
    || !DATE_ONLY.test(value)) return invalidProfile();
  const instant = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) {
    return invalidProfile();
  }
  const today = new Date().toISOString().slice(0, 10);
  if (value > today) return invalidProfile();
  return value;
}

export function normalizeDriverLicenseProfile(value: unknown): DriverLicenseProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Reflect.ownKeys(value).length !== PROFILE_KEYS.length
    || PROFILE_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    return invalidProfile();
  }
  const profile = value as Record<string, unknown>;
  if (profile.sex !== "M" && profile.sex !== "F") return invalidProfile();
  return {
    name: normalizedText(profile.name, DRIVER_LICENSE_NAME_MAX),
    birthDate: normalizedBirthDate(profile.birthDate),
    sex: profile.sex,
    address: normalizedText(profile.address, DRIVER_LICENSE_ADDRESS_MAX),
  };
}
