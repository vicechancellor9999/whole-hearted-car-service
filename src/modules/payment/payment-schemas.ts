import { z } from "zod";

export const positiveMoneyText = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/, "金额格式不正确，最多保留两位小数")
  .max(30)
  .refine((value) => Number(value) > 0, "金额必须大于 0");

const optionalNote = z.string().trim().max(2_000).optional().transform(
  (value) => value || null,
);

export const recordPaymentSchema = z.object({
  businessOrderId: z.number().int().positive(),
  amount: positiveMoneyText,
  paymentMethodItemId: z.number().int().positive(),
  note: optionalNote,
});

const storedEvidenceSchema = z.object({
  storageKey: z.string().trim().min(1).max(500),
  originalName: z.string().trim().min(1).max(500),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
  sha256Hex: z.string().regex(/^[0-9a-f]{64}$/),
});

export const recordRefundSchema = z.object({
  businessOrderId: z.number().int().positive(),
  amount: positiveMoneyText,
  paymentMethodItemId: z.number().int().positive(),
  reason: z.string().trim().min(1, "退款原因不能为空").max(2_000),
  originalDocumentStatus: z.enum(["returned", "unavailable"]),
  originalDocumentNote: z.string().trim().max(2_000).optional().transform(
    (value) => value || null,
  ),
  proof: storedEvidenceSchema.nullable(),
  customerSignature: storedEvidenceSchema.nullable().optional().transform(
    (value) => value ?? null,
  ),
}).superRefine((value, context) => {
  if (!value.proof) {
    context.addIssue({
      code: "custom",
      message: "退款必须上传退款凭证",
      path: ["proof"],
    });
  }
  if (value.originalDocumentStatus === "unavailable" && !value.originalDocumentNote) {
    context.addIssue({
      code: "custom",
      message: "原单无法交回时必须填写说明",
      path: ["originalDocumentNote"],
    });
  }
});

export function moneyTextToMinor(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) {
    throw new Error("金额超出系统安全范围");
  }
  return minor;
}
