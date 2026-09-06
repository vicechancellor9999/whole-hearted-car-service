export const BUSINESS_ORDER_BASE_CATEGORIES = [
  "maintenance",
  "repair",
  "inspection",
] as const;

export type BusinessOrderBaseCategory = typeof BUSINESS_ORDER_BASE_CATEGORIES[number];
export type BusinessOrderCategory = BusinessOrderBaseCategory | "rework";

const KEYWORDS: Record<BusinessOrderBaseCategory, readonly RegExp[]> = {
  maintenance: [
    /保养|机油|滤清器|机滤|空滤/i,
    /\b(?:oil\s*change|maintenance|routine\s*service|tune[- ]?up)\b/i,
  ],
  repair: [
    /维修|修理|更换|修复|故障|损坏|漏油|漏水|异响/i,
    /\b(?:repair|replace|fix|fault|broken|leak|noise)\b/i,
  ],
  inspection: [
    /检查|检测|诊断|排查|试车/i,
    /\b(?:inspect|inspection|diagnose|diagnosis|diagnostic|scan)\b/i,
  ],
};

export function normalizeBusinessOrderCategories(
  categories: readonly string[],
): BusinessOrderBaseCategory[] {
  const values = new Set(categories);
  return BUSINESS_ORDER_BASE_CATEGORIES.filter((category) => values.has(category));
}

export function classifyBusinessOrderText(text: string): BusinessOrderBaseCategory[] {
  const normalized = text.normalize("NFKC").trim();
  if (!normalized) return [];
  const affirmativeText = normalized
    .replace(/(?:不要|不需要|无需|不做|暂不)[^，。；,;\n]*/g, " ")
    .replace(/\b(?:do not|don't|no need to|without)\b[^,.;\n]*/gi, " ");
  return BUSINESS_ORDER_BASE_CATEGORIES.filter((category) =>
    KEYWORDS[category].some((pattern) => pattern.test(affirmativeText))
  );
}

export function withReworkCategory(
  categories: readonly string[],
  repairRoundNo: number,
): BusinessOrderCategory[] {
  const normalized: BusinessOrderCategory[] = normalizeBusinessOrderCategories(categories);
  if (repairRoundNo >= 2) normalized.push("rework");
  return normalized;
}
