export interface ChargeUnitDefinition {
  readonly id: string;
  readonly zh: string;
  readonly en: string;
  readonly builtin: boolean;
}

const STORAGE_KEY = "wh_charge_units_v1";

const STANDARD_UNITS: ReadonlyArray<ChargeUnitDefinition> = [
  { id: "work_hour", zh: "工时", en: "hour", builtin: true },
  { id: "item", zh: "个", en: "item", builtin: true },
  { id: "service", zh: "项", en: "service", builtin: true },
  { id: "time", zh: "次", en: "time", builtin: true },
  { id: "set", zh: "套", en: "set", builtin: true },
];

function parseStored(raw: string | null): ChargeUnitDefinition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const entry = value as Partial<ChargeUnitDefinition>;
      if (typeof entry.id !== "string" || typeof entry.zh !== "string" || !entry.zh.trim()) return [];
      return [{
        id: entry.id,
        zh: entry.zh.trim(),
        en: typeof entry.en === "string" ? entry.en.trim() : "",
        builtin: entry.builtin === true,
      }];
    });
  } catch {
    return [];
  }
}

function storedUnits(): ChargeUnitDefinition[] {
  if (typeof window === "undefined") return [];
  try { return parseStored(window.localStorage.getItem(STORAGE_KEY)); } catch { return []; }
}

function saveUnits(entries: ReadonlyArray<ChargeUnitDefinition>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  window.dispatchEvent(new Event("wh:charge-units-changed"));
}

export function loadChargeUnits(): ChargeUnitDefinition[] {
  const saved = storedUnits();
  const standards = STANDARD_UNITS.map((standard) => saved.find((entry) => entry.id === standard.id) ?? standard);
  const customs = saved.filter((entry) => !STANDARD_UNITS.some((standard) => standard.id === entry.id));
  return [...standards, ...customs];
}

export function addChargeUnit(zh: string, en = ""): ChargeUnitDefinition {
  const name = zh.trim();
  if (!name) throw new Error("收费单位名称不能为空");
  const current = loadChargeUnits();
  if (current.some((entry) => entry.zh === name)) throw new Error("该收费单位已存在");
  const nextNumber = current.reduce((max, entry) => {
    const match = /^custom-unit-(\d+)$/u.exec(entry.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  const entry = { id: `custom-unit-${nextNumber}`, zh: name, en: en.trim(), builtin: false } as const;
  saveUnits([...current, entry]);
  return entry;
}

export function updateChargeUnit(id: string, zh: string, en = ""): ChargeUnitDefinition {
  const name = zh.trim();
  if (!name) throw new Error("收费单位名称不能为空");
  const current = loadChargeUnits();
  const target = current.find((entry) => entry.id === id);
  if (!target) throw new Error("收费单位不存在");
  if (current.some((entry) => entry.id !== id && entry.zh === name)) throw new Error("该收费单位已存在");
  const updated = { ...target, zh: name, en: en.trim() };
  saveUnits(current.map((entry) => entry.id === id ? updated : entry));
  return updated;
}

export function removeChargeUnit(id: string): void {
  const current = loadChargeUnits();
  const target = current.find((entry) => entry.id === id);
  if (!target) throw new Error("收费单位不存在");
  if (target.builtin) throw new Error("标准收费单位不能删除，可以修改名称");
  saveUnits(current.filter((entry) => entry.id !== id));
}
