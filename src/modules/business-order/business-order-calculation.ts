import { parseMajorAmountToMinor } from "@formal/lib/money";
import type { ParsedChargeItem } from "@formal/modules/business-order/business-order-schemas";
import { BusinessOrderValidationError } from "@formal/modules/business-order/business-order-errors";

export type ChargeTotals = {
  grossMinor: number;
  lineDiscountMinor: number;
  laborDiscountMinor: number;
  partDiscountMinor: number;
  otherDiscountMinor: number;
  categoryDiscountMinor: number;
  wholeOrderDiscountMinor: number;
  totalDueMinor: number;
  includedGctMinor: number;
};

export type CalculatedChargeItem = ParsedChargeItem & {
  unitPriceMinor: number;
  itemDiscountMinor: number;
  grossMinor: number;
  subtotalMinor: number;
};

export function calculateCharges(fields: {
  laborDiscount: string;
  partDiscount: string;
  otherDiscount: string;
  wholeOrderDiscount: string;
  items: ParsedChargeItem[];
}): { items: CalculatedChargeItem[]; totals: ChargeTotals } {
  const items = fields.items.map((item) => {
    const unitPriceMinor = safeMoney(item.unitPrice);
    const itemDiscountMinor = safeMoney(item.itemDiscount);
    const quantityThousandths = parseQuantityThousandths(item.quantity);
    const grossMinor = roundDivide(
      BigInt(quantityThousandths) * BigInt(unitPriceMinor),
      1_000n,
    );
    if (itemDiscountMinor > grossMinor) {
      throw new BusinessOrderValidationError(
        `“${item.nameZh}”的本项折扣不能超过本项含税金额`,
      );
    }
    return {
      ...item,
      unitPriceMinor,
      itemDiscountMinor,
      grossMinor,
      subtotalMinor: grossMinor - itemDiscountMinor,
    };
  });
  const grossMinor = sum(items.map((item) => item.grossMinor));
  const lineDiscountMinor = sum(items.map((item) => item.itemDiscountMinor));
  const groupNet = {
    labor: sum(items.filter((item) => item.kind === "labor").map((item) => item.subtotalMinor)),
    part: sum(items.filter((item) => item.kind === "part").map((item) => item.subtotalMinor)),
    other: sum(items.filter((item) => item.kind === "other").map((item) => item.subtotalMinor)),
  };
  const laborDiscountMinor = safeMoney(fields.laborDiscount);
  const partDiscountMinor = safeMoney(fields.partDiscount);
  const otherDiscountMinor = safeMoney(fields.otherDiscount);
  const groupDiscounts = {
    labor: laborDiscountMinor,
    part: partDiscountMinor,
    other: otherDiscountMinor,
  };
  for (const kind of ["labor", "part", "other"] as const) {
    if (groupDiscounts[kind] > groupNet[kind]) {
      throw new BusinessOrderValidationError(
        `${chargeKindLabel(kind)}折扣不能超过该分区折后金额`,
      );
    }
  }
  const categoryDiscountMinor =
    laborDiscountMinor + partDiscountMinor + otherDiscountMinor;
  const afterCategoryMinor = grossMinor - lineDiscountMinor - categoryDiscountMinor;
  const wholeOrderDiscountMinor = safeMoney(fields.wholeOrderDiscount);
  if (wholeOrderDiscountMinor > afterCategoryMinor) {
    throw new BusinessOrderValidationError("整单折扣不能超过分类折扣后的金额");
  }
  const totalDueMinor = afterCategoryMinor - wholeOrderDiscountMinor;
  const includedGctMinor = roundDivide(BigInt(totalDueMinor) * 15n, 115n);
  return {
    items,
    totals: {
      grossMinor,
      lineDiscountMinor,
      laborDiscountMinor,
      partDiscountMinor,
      otherDiscountMinor,
      categoryDiscountMinor,
      wholeOrderDiscountMinor,
      totalDueMinor,
      includedGctMinor,
    },
  };
}

function safeMoney(value: string) {
  try {
    return parseMajorAmountToMinor(value);
  } catch (error) {
    throw new BusinessOrderValidationError(
      error instanceof Error ? error.message : "金额格式不正确",
    );
  }
}

function parseQuantityThousandths(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
  if (result <= 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BusinessOrderValidationError("数量超过系统安全范围");
  }
  return Number(result);
}

function roundDivide(numerator: bigint, denominator: bigint) {
  const rounded = (numerator + denominator / 2n) / denominator;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BusinessOrderValidationError("收费金额超过系统安全范围");
  }
  return Number(rounded);
}

function sum(values: number[]) {
  const total = values.reduce((current, value) => current + value, 0);
  if (!Number.isSafeInteger(total)) {
    throw new BusinessOrderValidationError("收费金额超过系统安全范围");
  }
  return total;
}

function chargeKindLabel(kind: "labor" | "part" | "other") {
  return kind === "labor" ? "工时" : kind === "part" ? "配件" : "其他费用";
}
