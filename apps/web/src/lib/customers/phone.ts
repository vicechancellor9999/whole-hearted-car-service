export class PhoneE164Error extends Error {
  readonly code = "PHONE_E164_INVALID" as const;

  constructor(message = "PHONE_E164_INVALID") {
    super(message);
    this.name = "PhoneE164Error";
  }
}

function invalidPhone(): never {
  throw new PhoneE164Error();
}

function displayDigits(input: string): string {
  if (!input || /[A-Za-z]/.test(input) || /[^\d\s().+-]/.test(input)) invalidPhone();
  const plusCount = [...input].filter((character) => character === "+").length;
  if (plusCount > 1 || (plusCount === 1 && !input.trimStart().startsWith("+"))) invalidPhone();
  return input.replace(/[^\d]/g, "");
}

export function normalizePhoneE164(input: string, defaultRegion?: "JM"): string {
  const value = input.trim();
  const hasInternationalPrefix = value.startsWith("+");
  const digits = displayDigits(value);

  if (hasInternationalPrefix) {
    if (digits.length < 8 || digits.length > 15) invalidPhone();
    return `+${digits}`;
  }

  if (defaultRegion === "JM" && digits.length === 10 && digits.startsWith("876")) {
    return `+1${digits}`;
  }
  invalidPhone();
}

export function formatPhoneE164(input: string): string {
  const canonical = normalizePhoneE164(input);
  if (/^\+1876\d{7}$/.test(canonical)) {
    return `+1 ${canonical.slice(2, 5)} ${canonical.slice(5, 8)} ${canonical.slice(8)}`;
  }
  return canonical;
}
