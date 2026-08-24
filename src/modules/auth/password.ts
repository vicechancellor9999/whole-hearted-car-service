import { argon2id, hash, verify } from "argon2";

const MINIMUM_PASSWORD_LENGTH = 12;

export type PasswordValidation =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; message: string }>;

export function normalizeUsername(username: string): string {
  return username.normalize("NFKC").trim().toLowerCase();
}

export function validateNewPassword(password: string): PasswordValidation {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return { ok: false, message: "密码至少需要 12 个字符" };
  }

  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  const validation = validateNewPassword(password);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  return hash(password, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
