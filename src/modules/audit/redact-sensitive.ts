const REDACTED = "[REDACTED]";

const sensitiveKeys = new Set([
  "authorization",
  "base64",
  "clientsecret",
  "connectionstring",
  "cookie",
  "databaseurl",
  "filecontent",
  "newpassword",
  "oldpassword",
  "password",
  "passwordhash",
  "passwordlength",
  "plaintextpassword",
  "rawtoken",
  "secret",
  "sessiontoken",
  "sessiontokenpepper",
  "setcookie",
  "tokenhash",
  "uploadcontent",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function containsEmbeddedCredential(value: string): boolean {
  return (
    /\bpostgres(?:ql)?:\/\/\S+/i.test(value) ||
    /\bbearer\s+\S+/i.test(value)
  );
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return containsEmbeddedCredential(value) ? REDACTED : value;
  }

  if (value === null || typeof value !== "object") return value;

  if (value instanceof Date) return value.toISOString();

  if (seen.has(value)) return REDACTED;
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => redactValue(item, seen));
    seen.delete(value);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = sensitiveKeys.has(normalizeKey(key))
      ? REDACTED
      : redactValue(child, seen);
  }
  seen.delete(value);
  return result;
}

export function redactSensitive<T>(value: T): T {
  return redactValue(value, new WeakSet()) as T;
}
