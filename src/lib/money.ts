const majorAmountPattern = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

export function parseMajorAmountToMinor(value: string): number {
  const normalized = value.trim();
  const match = majorAmountPattern.exec(normalized);
  if (!match) throw new Error("金额格式不正确，最多保留两位小数");
  const major = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const minor = major * 100n + fraction;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("金额超过系统安全范围");
  }
  return Number(minor);
}

export function formatMinorAmount(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error("最小货币单位金额无效");
  }
  const major = Math.trunc(minor / 100);
  const fraction = String(minor % 100).padStart(2, "0");
  return `${major.toLocaleString("en-US")}.${fraction}`;
}
