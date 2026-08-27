export function optionalIntegerField(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    const separator = /[A-Za-z0-9]$/.test(label) ? " " : "";
    throw new Error(`${label}${separator}必须是 ${minimum} 至 ${maximum} 的整数`);
  }
  return value;
}

export function optionalTextField(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error("可选文本字段必须是字符串或 null");
  }
  return value.trim() || undefined;
}
