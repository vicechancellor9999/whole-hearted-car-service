import { z } from "zod";

const moneyText = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/, "金额格式不正确，最多保留两位小数")
  .max(30);

const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional().transform(
    (value) => value || null,
  );

export const createBusinessOrderSchema = z.object({
  vehicleId: z.number().int().positive(),
  companyContactId: z.number().int().positive().nullable().optional().transform(
    (value) => value ?? null,
  ),
  problemDescriptionZh: optionalText(10_000),
  problemDescriptionEn: optionalText(10_000),
  categories: z.array(z.enum(["maintenance", "repair", "inspection"]))
    .max(12)
    .optional()
    .default([])
    .transform((categories) => [...new Set(categories)]),
});

const problemDescriptionSourceSchema = z.enum([
  "creation",
  "manual",
  "customer_concern",
  "inspection_report",
  "ai_suggestion",
  "migration",
]);

export const appendProblemDescriptionVersionSchema = z.object({
  businessOrderId: z.number().int().positive(),
  repairRoundId: z.number().int().positive().nullable().optional().transform(
    (value) => value ?? null,
  ),
  scope: z.enum(["business_order", "repair_round"]),
  expectedVersion: z.number().int().nonnegative(),
  contentZh: optionalText(10_000),
  contentEn: optionalText(10_000),
  reason: z.string().trim().min(1, "修改原因不能为空").max(1_000),
  sourceType: problemDescriptionSourceSchema.default("manual"),
  sourceReferenceId: z.number().int().positive().nullable().optional().transform(
    (value) => value ?? null,
  ),
}).superRefine((value, context) => {
  if (!value.contentZh && !value.contentEn) {
    context.addIssue({
      code: "custom",
      message: "问题描述不能为空",
      path: ["contentZh"],
    });
  }
  if (value.scope === "repair_round" && value.repairRoundId === null) {
    context.addIssue({
      code: "custom",
      message: "本轮问题描述必须指定维修轮次",
      path: ["repairRoundId"],
    });
  }
  if (value.scope === "business_order" && value.repairRoundId !== null) {
    context.addIssue({
      code: "custom",
      message: "整张 Business Order 问题描述不能指定维修轮次",
      path: ["repairRoundId"],
    });
  }
  const needsReference = [
    "customer_concern",
    "inspection_report",
    "ai_suggestion",
  ].includes(value.sourceType);
  if (needsReference !== (value.sourceReferenceId !== null)) {
    context.addIssue({
      code: "custom",
      message: needsReference ? "当前来源必须指定来源记录" : "当前来源不能指定来源记录",
      path: ["sourceReferenceId"],
    });
  }
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
    .regex(/^[1-9]\d*(?:\.0{1,3})?$/, "数量须为正整数，请核对数量与单价")
    .max(24)
    .transform((value) => value.replace(/\.0+$/, "")),
  pendingQuote: z.boolean().default(false),
  unitPrice: z.union([moneyText, z.literal("")]),
  itemDiscount: moneyText,
}).superRefine((item, context) => {
  if (item.pendingQuote) {
    if (item.unitPrice !== "" && Number(item.unitPrice) !== 0) {
      context.addIssue({ code: "custom", path: ["unitPrice"], message: "待报价项目不能同时填写确定单价；请确认价格后取消待报价" });
    }
    if (Number(item.itemDiscount) !== 0) {
      context.addIssue({ code: "custom", path: ["itemDiscount"], message: "待报价项目尚无确定金额；请补充价格后填写本项折扣" });
    }
  } else if (!item.unitPrice) {
    context.addIssue({ code: "custom", path: ["unitPrice"], message: "请填写单价，或将该项目标为待报价后继续保存" });
  }
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
