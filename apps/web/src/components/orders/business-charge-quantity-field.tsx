"use client";

import { useId } from "react";

export function normalizeChargeQuantity(value: string): string {
  return value.trim().replace(/\.0+$/, "");
}

export function isWholeChargeQuantity(value: string): boolean {
  return /^[1-9]\d*(?:\.0{1,3})?$/.test(value.trim()) && value.trim().length <= 24;
}

export function BusinessChargeQuantityField({ value, english, onChange }: {
  value: string;
  english: boolean;
  onChange: (value: string) => void;
}) {
  const hintId = useId();
  const invalid = value !== "" && !isWholeChargeQuantity(value);
  return <label className="lg:self-start">
    {english ? "Quantity" : "数量"}
    <input aria-label={english ? "Quantity" : "数量"} required inputMode="numeric"
      value={value} aria-invalid={invalid || undefined} aria-describedby={invalid ? hintId : undefined}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => { if (isWholeChargeQuantity(value)) onChange(normalizeChargeQuantity(value)); }}
      className="mt-1 min-h-9 w-full rounded-md border border-line px-2" />
    {invalid && <span id={hintId} className="mt-1 block text-xs text-rose-600">
      {english ? "Quantity must be a positive whole number. Check quantity and unit price; your input is kept." : "数量须为正整数，请核对数量与单价；原输入已保留。"}
    </span>}
  </label>;
}
