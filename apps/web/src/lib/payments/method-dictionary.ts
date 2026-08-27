/** 支付方式字典（8/18 老板）：小方块选择 + 可在系统设置里添加。
 * 默认三项：刷卡、现金、银行转账-NCB。自定义方式以 custom-<时间戳> 为值，持久化在浏览器。
 */
export interface PaymentMethodEntry {
  value: string;
  zh: string;
  en: string;
  builtin?: boolean;
}

const STORAGE_KEY = "wh_payment_methods_v1";

const BUILTIN: PaymentMethodEntry[] = [
  { value: "card", zh: "刷卡", en: "Card", builtin: true },
  { value: "cash", zh: "现金", en: "Cash", builtin: true },
  { value: "bank_transfer", zh: "银行转账-NCB", en: "Bank transfer - NCB", builtin: true },
];

const LEGACY_LABELS: Record<string, { zh: string; en: string }> = {
  cheque: { zh: "支票", en: "Cheque" },
};

function loadStored(): PaymentMethodEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PaymentMethodEntry => {
      const record = entry as Record<string, unknown>;
      return typeof record?.value === "string" && typeof record?.zh === "string" && typeof record?.en === "string";
    }).map((entry) => ({ ...entry, builtin: BUILTIN.some((builtin) => builtin.value === entry.value) }));
  } catch {
    return [];
  }
}

export function loadPaymentMethods(): PaymentMethodEntry[] {
  const stored = loadStored();
  const builtins = BUILTIN.map((builtin) => stored.find((entry) => entry.value === builtin.value) ?? builtin);
  const customs = stored.filter((entry) => !BUILTIN.some((builtin) => builtin.value === entry.value));
  return [...builtins, ...customs];
}

function savePaymentMethods(entries: ReadonlyArray<PaymentMethodEntry>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  window.dispatchEvent(new Event("wh:payment-methods-changed"));
}

export function addPaymentMethod(zh: string, en = ""): PaymentMethodEntry {
  const name = zh.trim();
  if (!name) throw new Error("支付方式名称不能为空");
  const current = loadPaymentMethods();
  if (current.some((entry) => entry.zh === name)) throw new Error("该支付方式已存在");
  const nextNumber = current.reduce((max, entry) => {
    const match = /^custom-(\d+)$/u.exec(entry.value);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  const entry: PaymentMethodEntry = { value: `custom-${nextNumber}`, zh: name, en: en.trim() || name, builtin: false };
  savePaymentMethods([...current, entry]);
  return entry;
}

export function updatePaymentMethod(value: string, zh: string, en = ""): PaymentMethodEntry {
  const name = zh.trim();
  if (!name) throw new Error("支付方式名称不能为空");
  const current = loadPaymentMethods();
  const target = current.find((entry) => entry.value === value);
  if (!target) throw new Error("支付方式不存在");
  if (current.some((entry) => entry.value !== value && entry.zh === name)) throw new Error("该支付方式已存在");
  const updated = { ...target, zh: name, en: en.trim() || name };
  savePaymentMethods(current.map((entry) => entry.value === value ? updated : entry));
  return updated;
}

export function removePaymentMethod(value: string): void {
  const current = loadPaymentMethods();
  const target = current.find((entry) => entry.value === value);
  if (!target) throw new Error("支付方式不存在");
  if (target.builtin) throw new Error("标准支付方式不能删除，可以修改名称");
  savePaymentMethods(current.filter((entry) => entry.value !== value));
}

export function methodLabelZh(value: string): string {
  return loadPaymentMethods().find((entry) => entry.value === value)?.zh ?? LEGACY_LABELS[value]?.zh ?? value;
}

export function methodLabelEn(value: string): string {
  return loadPaymentMethods().find((entry) => entry.value === value)?.en ?? LEGACY_LABELS[value]?.en ?? value;
}

/** 支付方式是否已知（内置 + 自定义 + 历史支票）。 */
export function methodIsKnown(value: string): boolean {
  return loadPaymentMethods().some((entry) => entry.value === value) || value in LEGACY_LABELS;
}
