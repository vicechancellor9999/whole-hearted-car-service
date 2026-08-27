import { z } from "zod";
import { normalizedAccountUsernameSchema } from "@formal/modules/accounts/account-schemas";

export const dictionaryCategorySchema = z.enum([
  "payment_method",
  "charge_unit",
  "staff_position",
]);

export const dictionaryCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "字典代码格式不正确")
  .max(80, "字典代码不能超过 80 个字符");

export const requiredNameSchema = z
  .string()
  .trim()
  .min(1, "名称不能为空")
  .max(120, "名称不能超过 120 个字符");

export const optionalLabelSchema = z
  .string()
  .trim()
  .max(120, "英文名称不能超过 120 个字符")
  .optional()
  .transform((value) => value || null);

export function normalizePhone(value: string): string {
  const trimmed = value.normalize("NFKC").trim();
  const withInternationalPrefix = trimmed.startsWith("00")
    ? `+${trimmed.slice(2)}`
    : trimmed;
  const digits = withInternationalPrefix.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

export const normalizedPhoneSchema = z
  .string()
  .transform(normalizePhone)
  .pipe(
    z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/, "手机号格式不正确"),
  );

export const optionalNormalizedPhoneSchema = z
  .union([normalizedPhoneSchema, z.literal(""), z.null(), z.undefined()])
  .transform((value) => value || null);

export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "日期不存在");

export const monthKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "月份格式必须为 YYYY-MM")
  .refine((value) => {
    const parsed = new Date(`${value}-01T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 7) === value;
  }, "月份不存在");

export const nonnegativeMinorAmountSchema = z
  .number()
  .int("金额必须使用最小货币单位整数")
  .safe()
  .nonnegative("金额不能为负数");

export const positiveDecimalSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(?:\.\d{1,6})?$/, "数值最多保留 6 位小数")
  .refine((value) => Number(value) > 0, "数值必须大于 0");

export const commissionRateSchema = positiveDecimalSchema.refine(
  (value) => Number(value) <= 1,
  "提成比例不能大于 1",
);

export const createDictionaryItemSchema = z.object({
  category: dictionaryCategorySchema,
  code: dictionaryCodeSchema,
  labelZh: requiredNameSchema,
  labelEn: optionalLabelSchema,
});

export const createRepairTeamSchema = z.object({
  name: requiredNameSchema,
});

export const updateDictionaryItemSchema = z.object({
  labelZh: requiredNameSchema,
  labelEn: optionalLabelSchema,
  isActive: z.boolean(),
  sortOrder: z.number().int().nonnegative().max(1_000_000),
});

export const createMechanicSchema = z.object({
  fullName: requiredNameSchema,
  phone: optionalNormalizedPhoneSchema,
  positionItemId: z.number().int().positive(),
  teamId: z.number().int().positive(),
  hiredOn: dateKeySchema,
  effectiveMonth: monthKeySchema,
  baseSalaryCnyMinor: nonnegativeMinorAmountSchema,
  username: normalizedAccountUsernameSchema,
  password: z.string(),
});
