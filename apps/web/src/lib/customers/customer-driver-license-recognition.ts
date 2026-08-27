export type CustomerLicenseRecognition = Readonly<{
  fields: Readonly<{
    name: string | null;
    birthDate: string | null;
    sex: "M" | "F" | null;
    address: string | null;
  }>;
  status: Readonly<Record<
    "name" | "birthDate" | "sex" | "address",
    "extracted" | "manual_required"
  >>;
}>;

const fieldNames = ["name", "birthDate", "sex", "address"] as const;
const controlCharacters = /[\u0000-\u001f\u007f]/;

export function recognitionFromFields(
  input: Record<string, unknown>,
  now = new Date(),
): CustomerLicenseRecognition {
  const sex: "M" | "F" | null = input.sex === "M" || input.sex === "F" ? input.sex : null;
  const fields = {
    name: safeText(input.name, 160),
    birthDate: safeBirthDate(input.birthDate, now),
    sex,
    address: safeText(input.address, 500),
  };
  return {
    fields,
    status: {
      name: fields.name ? "extracted" : "manual_required",
      birthDate: fields.birthDate ? "extracted" : "manual_required",
      sex: fields.sex ? "extracted" : "manual_required",
      address: fields.address ? "extracted" : "manual_required",
    },
  };
}

export function validateCustomerLicenseRecognition(
  input: unknown,
  now = new Date(),
): CustomerLicenseRecognition {
  const root = exactObject(input, ["fields", "status"]);
  const fields = exactObject(root.fields, fieldNames);
  const status = exactObject(root.status, fieldNames);
  for (const name of fieldNames) {
    if (status[name] !== "extracted" && status[name] !== "manual_required") {
      throw new TypeError("customer license field status is invalid");
    }
  }
  return recognitionFromFields(fields, now);
}

function safeText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/[ \t]+/g, " ");
  if (!normalized || normalized.length > maximum || controlCharacters.test(normalized)) return null;
  return normalized;
}

function safeBirthDate(value: unknown, now: Date): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day || parsed.getTime() > now.getTime()) {
    return null;
  }
  return value;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("customer license recognition must be an object");
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError("customer license recognition has unexpected fields");
  }
  return value as Record<string, unknown>;
}
