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

export function moneyTextToMinor(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) {
    throw new Error("金额超出系统安全范围");
  }
  return minor;
}
