import { normalizePhoneE164 } from "./phone";
import { customerDisplayNameV3 } from "./selectors";
import type { CustomerRecord } from "./types";
import type {
  CustomerStoredPhoneField,
  OnboardingInputPhoneField,
  OnboardingPhoneDuplicateMatch,
} from "./onboarding-types";

export const ONBOARDING_SESSION_TTL_MS = 30 * 60 * 1_000;

const DATA_URL = /(?:^|[^A-Za-z0-9])data\s*:/i;
const STORED_PHONE_FIELDS: readonly CustomerStoredPhoneField[] = ["phone", "secondaryPhone", "whatsapp"];
const INPUT_PHONE_FIELDS: readonly OnboardingInputPhoneField[] = ["primaryPhone", "secondaryPhone", "whatsapp"];

export function hasExactOwnStringKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === expected.length
    && actual.every((key) => typeof key === "string" && expected.includes(key));
}

export function isSafeOnboardingId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !DATA_URL.test(value);
}

export function onboardingRequestFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(onboardingRequestFingerprint).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort()
      .map((key) => `${JSON.stringify(key)}:${onboardingRequestFingerprint(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function normalizedStoredPhone(value: string | null): string | null {
  if (!value) return null;
  try {
    return normalizePhoneE164(value, "JM");
  } catch {
    return null;
  }
}

export function matchOnboardingPhones(
  customers: readonly CustomerRecord[],
  incoming: Readonly<Partial<Record<OnboardingInputPhoneField, string | null>>>,
): OnboardingPhoneDuplicateMatch[] {
  const normalizedIncoming = INPUT_PHONE_FIELDS.flatMap((incomingField) => {
    const value = incoming[incomingField];
    if (!value?.trim()) return [];
    return [{ incomingField, phoneE164: normalizePhoneE164(value, "JM") }];
  });
  return customers.flatMap((customer) => normalizedIncoming.flatMap(({ incomingField, phoneE164 }) =>
    STORED_PHONE_FIELDS.flatMap((existingField) =>
      normalizedStoredPhone(customer[existingField]) === phoneE164 ? [{
        customerId: customer.id,
        customerDisplayName: customerDisplayNameV3(customer),
        customerStatus: customer.status,
        incomingField,
        existingField,
        phoneE164,
      }] : [])));
}
