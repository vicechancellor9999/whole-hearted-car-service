import { z } from "zod";
import { normalizeUsername } from "@formal/modules/auth/password";

export const accountRoleSchema = z.enum([
  "super_admin",
  "front_desk",
  "owner",
  "mechanic",
]);

export const accountDisplayNameSchema = z
  .string()
  .trim()
  .min(1, "显示名不能为空")
  .max(120, "显示名不能超过 120 个字符");

export const normalizedAccountUsernameSchema = z
  .string()
  .transform(normalizeUsername)
  .pipe(
    z
      .string()
      .min(1, "登录名不能为空")
      .max(120, "登录名不能超过 120 个字符"),
  );

export const createAccountFieldsSchema = z.object({
  displayName: accountDisplayNameSchema,
  username: normalizedAccountUsernameSchema,
  password: z.string(),
  role: accountRoleSchema,
});
