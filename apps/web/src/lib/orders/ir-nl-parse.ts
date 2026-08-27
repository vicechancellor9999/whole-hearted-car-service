/**
 * IR（检查结果）自然语言解析（2026-08-18 老板定）：
 * 维修工/前台用大白话回交检查结果 → 整理成检查项目 + 报价草稿。
 * 报价基本报工时费；配件只给清单（金额待配件部另行报价）。
 * 后续接 DeepSeek 真模型时，此文件仍是兜底规则器。
 */

export interface ParsedInspectionUnitItem {
  readonly findingZh: string;
  readonly findingEn?: string;
  readonly recommendationZh: string;
  readonly recommendationEn?: string;
  readonly pricingMode: "unit";
  readonly category: "labor" | "parts";
  readonly quantity: number;
  readonly amountJmd: number;
  readonly pendingQuote: boolean;
}

export interface ParsedInspectionFixedCharge {
  readonly findingZh: string;
  readonly findingEn?: string;
  readonly recommendationZh: string;
  readonly recommendationEn?: string;
  readonly pricingMode: "fixed_total";
  readonly category: "other_service";
  readonly code: "towing" | "offsite_service" | "other";
  readonly amountJmd: number;
  readonly pendingQuote: false;
}

export type ParsedInspectionItem = ParsedInspectionUnitItem | ParsedInspectionFixedCharge;

export interface ParsedInspectionResult {
  readonly aiDraft: string;
  readonly items: ParsedInspectionItem[];
}

function clean(text: string): string {
  return text.replace(/[\s,，。.]+$/gu, "").trim();
}

function explicitAmount(match: RegExpMatchArray | null): number | null {
  if (!match) return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/u.test(match[1])) return null;
  const parsed = Number(match[1].replaceAll(",", ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function explicitQuantity(source: string): number {
  const match = source.match(/(?:数量\s*|[x×]\s*)(\d+)(?![\d,])|(\d+)\s*(?:个|件|套|瓶|条|只|块|支|工时)/u);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseLine(line: string): ParsedInspectionItem | null {
  const source = line.trim();
  if (!source) return null;

  // Capture the whole numeric token so malformed decimals/grouping are
  // rejected as a unit; never let a trailing fractional digit become JMD.
  const amountMatch = source.match(/(?:JMD\s*)?(\d[\d,.]*)\s*$/iu);
  const amountPrefix = amountMatch?.index === undefined ? "" : source.slice(0, amountMatch.index);
  const amountJmd = /(?:数量|[x×])\s*$/u.test(amountPrefix)
    ? null
    : explicitAmount(amountMatch);
  const fixedCode = /拖车/u.test(source)
    ? "towing"
    : /外派服务/u.test(source)
      ? "offsite_service"
      : /其他费用/u.test(source)
        ? "other"
        : null;
  if (fixedCode) {
    // An unpriced mention stays in the raw natural-language record. It is not
    // promoted into a canonical charge until the source states one exact total.
    if (amountJmd === null) return null;
    const description = clean(source.replace(/(?:JMD\s*)?[\d,]+\s*$/iu, "")) || "其他费用";
    return {
      findingZh: description,
      recommendationZh: description,
      pricingMode: "fixed_total",
      category: "other_service",
      code: fixedCode,
      amountJmd,
      pendingQuote: false,
    };
  }

  const isPart = /配件|零件|总成|滤芯|油液|轮胎|电瓶|刹车片|皮带|水管|减震|传感器|冷媒|清洗剂/.test(source);
  const category = isPart ? "parts" : "labor";

  // 描述：去掉金额与"免费"字样
  let findingZh = source
    .replace(/工时\s*[\d,]+/, "工时")
    .replace(/[\d,]{4,}\s*$/u, "")
    .replace(/免费/g, "")
    .replace(/[\s,，。]+$/gu, "")
    .trim();
  if (!findingZh) findingZh = source;

  const recommendationZh = category === "labor"
    ? `施工建议：${findingZh}`
    : `配件清单（待报价）：${findingZh}`;
  return {
    findingZh,
    recommendationZh,
    pricingMode: "unit",
    category,
    quantity: explicitQuantity(source),
    amountJmd: amountJmd ?? 0,
    pendingQuote: category === "parts" && amountJmd === null,
  };
}

export function parseInspectionNaturalLanguage(rawText: string): ParsedInspectionResult {
  const lines = rawText
    .split(/\n|；|;/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const items = lines
    .map(parseLine)
    .filter((item): item is ParsedInspectionItem => item !== null);
  const aiDraft = items.length
    ? items.map((item, index) => {
      const amount = item.amountJmd.toLocaleString("en-US");
      const summary = item.pricingMode === "fixed_total"
        ? `其他费用 JMD ${amount}`
        : item.category === "labor"
          ? item.amountJmd > 0 ? `工时报价 JMD ${amount}` : "工时（金额待定）"
          : item.pendingQuote ? "配件清单，另行报价" : `配件报价 JMD ${amount}`;
      return `${index + 1}. ${item.findingZh}（${summary}）`;
    }).join("\n")
    : rawText.trim();
  return { aiDraft, items };
}

export interface QuotationDraftUnitLine {
  descZh: string;
  descEn: string;
  remarkZh: string;
  remarkEn: string;
  pricingMode: "unit";
  unit: string;
  unitEn: string;
  quantity: number;
  unitPriceJmd: number;
  unitDiscountJmd: number;
  pendingQuote: boolean;
  category: "labor" | "parts";
}

export interface QuotationDraftFixedLine {
  descZh: string;
  descEn: string;
  remarkZh: string;
  remarkEn: string;
  pricingMode: "fixed_total";
  category: "other_service";
  code: "towing" | "offsite_service" | "other";
  amountJmd: number;
}

export type QuotationDraftLine = QuotationDraftUnitLine | QuotationDraftFixedLine;
/** @deprecated Use QuotationDraftLine. */
export type QuotationDraftItem = QuotationDraftUnitLine;

/**
 * 报价项目对齐业务单收费项（2026-08-20 老板）：从 AI 拆分的检查项目推报价草稿——
 * 工时写金额（数量 1）；配件/其他服务 pendingQuote（数量已知、价格待定）。
 * 新建检查结果与详情页自然语言整理共用。
 */
export function quotationLinesFromParsed(items: ReadonlyArray<ParsedInspectionItem>): QuotationDraftLine[] {
  return items.map((item): QuotationDraftLine => item.pricingMode === "fixed_total" ? {
    descZh: item.recommendationZh || item.findingZh,
    descEn: item.recommendationEn?.trim() || item.findingEn?.trim() || "",
    remarkZh: "",
    remarkEn: "",
    pricingMode: "fixed_total",
    category: "other_service",
    code: item.code,
    amountJmd: item.amountJmd,
  } : {
    descZh: item.recommendationZh || item.findingZh,
    descEn: item.recommendationEn?.trim() || item.findingEn?.trim() || "",
    remarkZh: "",
    remarkEn: "",
    pricingMode: "unit",
    unit: item.category === "labor" ? "工时" : "个",
    unitEn: item.category === "labor" ? "hours" : "pcs",
    quantity: item.quantity,
    unitPriceJmd: item.amountJmd,
    unitDiscountJmd: 0,
    pendingQuote: item.pendingQuote,
    category: item.category,
  });
}

export type MergedQuotationDraftLine = QuotationDraftLine & { id?: string };

function editableCurrentLine(line: QuotedChargeLine): MergedQuotationDraftLine {
  if (line.pricingMode === "parking_projection") throw new Error("IR Quotation cannot merge a parking projection");
  const { id, sourceId: _sourceId, ...editable } = line;
  return { ...editable, id };
}

function quotationMatchKey(line: QuotationDraftLine | MergedQuotationDraftLine): string {
  const group = line.pricingMode === "fixed_total" ? `fixed:${line.code}` : `unit:${line.category}`;
  return `${group}:${line.descZh.trim().toLocaleLowerCase()}`;
}

/**
 * Re-running AI is additive/fill-only: established manual facts and stable IDs
 * win. Exact matching rows can fill blank translations or a genuinely pending
 * price; unmatched explicit facts append as new rows. No non-empty manual field
 * is overwritten without a future explicit diff-confirmation UI.
 */
export function mergeQuotationLinesFromParsed(
  current: ReadonlyArray<QuotedChargeLine>,
  parsedItems: ReadonlyArray<ParsedInspectionItem>,
): MergedQuotationDraftLine[] {
  const merged = current.map(editableCurrentLine);
  const indexesByKey = new Map<string, number[]>();
  merged.forEach((line, index) => {
    const key = quotationMatchKey(line);
    indexesByKey.set(key, [...(indexesByKey.get(key) ?? []), index]);
  });
  const matchedIndexes = new Set<number>();

  for (const suggestion of quotationLinesFromParsed(parsedItems)) {
    const matchIndex = (indexesByKey.get(quotationMatchKey(suggestion)) ?? [])
      .find((index) => !matchedIndexes.has(index));
    if (matchIndex === undefined) {
      merged.push(suggestion);
      continue;
    }
    matchedIndexes.add(matchIndex);
    const existing = merged[matchIndex];
    if (existing.pricingMode === "unit" && suggestion.pricingMode === "unit") {
      const canFillPrice = existing.category === "parts"
        && existing.pendingQuote
        && existing.unitPriceJmd === 0
        && existing.unitDiscountJmd === 0
        && suggestion.unitPriceJmd > 0;
      merged[matchIndex] = {
        ...existing,
        descEn: existing.descEn.trim() || suggestion.descEn,
        remarkZh: existing.remarkZh.trim() || suggestion.remarkZh,
        remarkEn: existing.remarkEn.trim() || suggestion.remarkEn,
        unitEn: existing.unitEn.trim() || suggestion.unitEn,
        ...(canFillPrice ? { unitPriceJmd: suggestion.unitPriceJmd, pendingQuote: false } : {}),
      };
      continue;
    }
    if (existing.pricingMode === "fixed_total" && suggestion.pricingMode === "fixed_total") {
      merged[matchIndex] = {
        ...existing,
        descEn: existing.descEn.trim() || suggestion.descEn,
        remarkZh: existing.remarkZh.trim() || suggestion.remarkZh,
        remarkEn: existing.remarkEn.trim() || suggestion.remarkEn,
      };
    }
  }
  return merged;
}

/** @deprecated Compatibility adapter for the pre-Task-3 unit-only draft API. */
export function quotationItemsFromParsed(items: ReadonlyArray<ParsedInspectionItem>): QuotationDraftItem[] {
  return quotationLinesFromParsed(items).flatMap((line) => line.pricingMode === "unit" ? [line] : []);
}

export interface OrganizedInspectionReportText {
  zh: string;
  en: string;
}

/**
 * 本地组织语言兜底（2026-08-20 老板）：不联网、不编造，只把已确认的检查项目
 * 拼成给客户的纯文字报告；未确认的保留“待确认/下一步待定”字样。
 * AI 可用时由 aiOrganizeInspectionReport 取代；此处是 AI 关闭/失败时的规则器。
 */
export function organizeInspectionReportText(input: {
  customerName: string;
  vehiclePlate: string;
  vehicleModel?: string;
  items: ReadonlyArray<{
    findingZh: string;
    recommendationZh: string;
    remarkZh?: string;
    nextStepZh?: string;
  }>;
}): OrganizedInspectionReportText {
  const vehicleZh = input.vehiclePlate + (input.vehicleModel ? "（" + input.vehicleModel + "）" : "");
  const vehicleEn = input.vehiclePlate + (input.vehicleModel ? " (" + input.vehicleModel + ")" : "");
  const zhLines = [input.customerName + " 您好：", "以下是您的车辆 " + vehicleZh + " 本次检查结果的文字报告。", ""];
  const enLines = ["Dear " + input.customerName + ",", "Below is the written inspection report for your vehicle " + vehicleEn + ".", ""];
  input.items.forEach((item, index) => {
    zhLines.push((index + 1) + ". 检查发现：" + item.findingZh);
    zhLines.push("   本步处理：" + item.recommendationZh);
    if (item.remarkZh?.trim()) zhLines.push("   备注：" + item.remarkZh.trim());
    if (item.nextStepZh?.trim()) zhLines.push("   下一步待定：" + item.nextStepZh.trim());
    zhLines.push("");
    enLines.push((index + 1) + ". Finding: " + item.findingZh);
    enLines.push("   Work done in this stage: " + item.recommendationZh);
    if (item.remarkZh?.trim()) enLines.push("   Note: " + item.remarkZh.trim());
    if (item.nextStepZh?.trim()) enLines.push("   Next step pending: " + item.nextStepZh.trim());
    enLines.push("");
  });
  zhLines.push("说明：本报告只覆盖当前阶段；本阶段完成后，后续维修方案与费用将另行出具检查报告与报价。");
  enLines.push("Note: this report covers the current stage only. After this stage, the next repair plan and quotation will be issued as a separate report and quotation.");
  return { zh: zhLines.join("\n"), en: enLines.join("\n") };
}
import type { QuotedChargeLine } from "../billing/quoted-charges";
