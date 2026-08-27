export function parseFormalOptionalInteger(
  value: string | null | undefined,
  label: string,
  minimum: number,
  maximum: number,
): number | null {
  const source = value?.trim();
  if (!source) return null;
  const parsed = Number(source);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    const separator = /[A-Za-z0-9]$/.test(label) ? " " : "";
    throw new Error(`${label}${separator}必须是 ${minimum} 至 ${maximum} 的整数`);
  }
  return parsed;
}

export function formalVehicleIsActive(value: boolean | undefined): boolean {
  if (typeof value !== "boolean") {
    throw new Error("正式车辆启用状态缺失，请刷新后重试");
  }
  return value;
}
