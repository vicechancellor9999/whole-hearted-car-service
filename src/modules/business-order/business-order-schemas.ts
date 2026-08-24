import { z } from "zod";

const moneyText = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/, "金额格式不正确，最多保留两位小数")
  .max(30);

const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional().transform((value) => value || null);

export const createBusinessOrderSchema = z.object({
  vehicleId: z.number().int().positive(),
  companyContactId: z.number().int().positive().nullable().optional().transform(
    (value) => value ?? null,
  ),
});

export const chargeItemSchema = z.object({
  kind: z.enum(["labor", "part", "other"]),
  nameZh: z.string().trim().min(1, "项目名称不能为空").max(200),
  nameEn: optionalText(200),
  descriptionZh: optionalText(1_000),
  descriptionEn: optionalText(1_000),
  unitItemId: z.number().int().positive(),
  quantity: z
    .string()
    .trim()
    .regex(/^(0|[1-9]\d*)(?:\.\d{1,3})?$/, "数量格式不正确，最多三位小数")
    .max(24)
    .refine((value) => /[1-9]/.test(value), "数量必须大于 0"),
  unitPrice: moneyText,
  itemDiscount: moneyText,
});

export const businessOrderNoteSchema = z.object({
  kind: z.enum([
    "customer_concern",
    "work_instruction",
    "liability_notice",
    "internal",
  ]),
  contentZh: optionalText(10_000),
  contentEn: optionalText(10_000),
}).superRefine((value, context) => {
  if (!value.contentZh && !value.contentEn) {
    context.addIssue({
      code: "custom",
      message: "备注内容不能为空",
      path: ["contentZh"],
    });
  }
});

export const replaceChargeVersionSchema = z.object({
  businessOrderId: z.number().int().positive(),
  expectedBusinessOrderVersion: z.number().int().positive(),
  reason: z.string().trim().min(1, "收费修改原因不能为空").max(1_000),
  laborDiscount: moneyText,
  partDiscount: moneyText,
  otherDiscount: moneyText,
  wholeOrderDiscount: moneyText,
  items: z.array(chargeItemSchema).max(100),
  notes: z.array(businessOrderNoteSchema).max(30),
});

export const voidBusinessOrderSchema = z.object({
  businessOrderId: z.number().int().positive(),
  expectedBusinessOrderVersion: z.number().int().positive(),
  reason: z.string().trim().min(1, "作废原因不能为空").max(1_000),
});

export type ParsedChargeItem = z.infer<typeof chargeItemSchema>;
export type ParsedBusinessOrderNote = z.infer<typeof businessOrderNoteSchema>;
export type ChargeItemInput = z.input<typeof chargeItemSchema>;
export type BusinessOrderNoteInput = z.input<typeof businessOrderNoteSchema>;
