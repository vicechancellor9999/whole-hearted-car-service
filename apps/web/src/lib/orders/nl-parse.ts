/**
 * 自然语言拆单器（Mock AI）——前台大白话 → 双语收费项目。
 *
 * 演示版用规则解析+术语词典模拟 AI/翻译 API；真实系统换成模型调用，
 * 输入输出契约不变：parseQuickOrderInput(text) → QuickOrderItem[]。
 *
 * 能处理的写法（老板 2026-08-16 真实例句）：
 *   "水泵漏防冻液 需要更换水泵，再加防冻液工时25,000"   → 工时 25,000
 *   "需要清洗剂八瓶 工时免费。"                          → 配件 8 瓶 × 0
 *   "前左右刹车片和前左右刹车片传感器，前左右刹车盘 工时50,000" → 工时 50,000
 */
import type { QuickItemCategory, QuickOrderItem } from "./quick-order-types";

export interface ParsedQuickItem extends Omit<QuickOrderItem, "id" | "unit" | "discountJmd"> {
  unit?: string;
  discountJmd?: number;
}

export type ParsedChargeNoteKind =
  | "customer_concern"
  | "work_instruction"
  | "liability_notice";

export type ParsedChargeNote = {
  kind: ParsedChargeNoteKind;
  contentZh: string;
  contentEn: string;
};

export type ParsedChargeEntry = {
  items: ParsedQuickItem[];
  notes: ParsedChargeNote[];
};

// ---------------------------------------------------------------------------
// 中文数字 → 阿拉伯数字（数量用：八瓶 → 8）
// ---------------------------------------------------------------------------

const ZH_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

export function zhNumeralToNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  // 十 / 十五 / 二十 / 二十五
  const match = trimmed.match(/^([一二两三四五六七八九]?)十([一二三四五六七八九]?)$/);
  if (match) {
    const tens = match[1] ? ZH_DIGITS[match[1]] : 1;
    const ones = match[2] ? ZH_DIGITS[match[2]] : 0;
    return tens * 10 + ones;
  }
  return ZH_DIGITS[trimmed] ?? null;
}

// ---------------------------------------------------------------------------
// 术语翻译词典（模拟翻译 API；未命中的保留占位，人可改）
// ---------------------------------------------------------------------------

const TERM_DICT: ReadonlyArray<[RegExp, string]> = [
  [/水泵/g, "water pump"],
  [/防冻液|冷却液/g, "coolant"],
  [/全车水管/g, "all coolant hoses"],
  [/水管/g, "coolant hose"],
  [/涡轮增压/g, "turbocharger"],
  [/气门室盖垫/g, "valve cover gasket"],
  [/刹车片传感器|刹车传感器/g, "brake pad sensors"],
  [/刹车片/g, "brake pads"],
  [/刹车盘/g, "brake discs"],
  [/刹车油/g, "brake fluid"],
  [/清洗剂/g, "cleaning agent"],
  [/机油/g, "engine oil"],
  [/机滤/g, "oil filter"],
  [/空滤|空气滤芯/g, "air filter"],
  [/空调滤/g, "cabin filter"],
  [/火花塞/g, "spark plugs"],
  [/电瓶|蓄电池/g, "battery"],
  [/轮胎/g, "tires"],
  [/轮毂/g, "wheel rims"],
  [/减震/g, "shock absorbers"],
  [/变速箱油/g, "transmission fluid"],
  [/正时皮带/g, "timing belt"],
  [/发电机/g, "alternator"],
  [/起动机|启动机/g, "starter motor"],
  [/大灯/g, "headlights"],
  [/前左右|前面左右|双侧前|两前/g, "front left & right"],
  [/后左右|后面左右|双侧后|两后/g, "rear left & right"],
  [/前/g, "front"],
  [/后/g, "rear"],
  [/左/g, "left"],
  [/右/g, "right"],
  [/老化/g, "aged"],
  [/漏油/g, "oil leak"],
  [/漏/g, "leaking"],
  [/更换|换/g, " replace "],
  [/检修|检查/g, " inspect "],
  [/匹配|电脑匹配/g, " programming/coding "],
  [/和|与|及|、|，|,/g, " + "],
  [/需要/g, ""],
  [/所有/g, "all"],
  [/的/g, ""],
];

/** 中文描述 → 英文翻译（词典模拟；空结果给占位符提示人工补）。 */
export function mockTranslate(descZh: string): string {
  let en = descZh;
  for (const [pattern, replacement] of TERM_DICT) {
    // 中文无空格，替换时补边界空格防粘连，后面统一折叠
    en = en.replace(pattern, ` ${replacement} `);
  }
  // 清理多余连接符与空格
  en = en.replace(/(\s*\+\s*){2,}/g, " + ").replace(/\s{2,}/g, " ").trim();
  en = en.replace(/^\+\s*|\s*\+$/g, "").trim();
  // 还含中文 = 词典未覆盖，留占位让人改
  if (/[一-龥]/.test(en)) return `[待翻译] ${descZh}`;
  return en ? en.charAt(0).toUpperCase() + en.slice(1) : `[待翻译] ${descZh}`;
}

// ---------------------------------------------------------------------------
// 行解析
// ---------------------------------------------------------------------------

/** 从一行文本提取金额：工时25,000 / 工时 85000 / 收费 10000 / 配件价 3,500。 */
function extractPrice(line: string): { price: number | null; rest: string } {
  const match = line.match(/(\d{1,3}(?:,\d{3})+|\d{4,})/);
  if (!match) return { price: null, rest: line };
  const price = parseInt(match[1].replace(/,/g, ""), 10);
  return { price, rest: (line.slice(0, match.index) + line.slice(match.index! + match[0].length)).trim() };
}

/** 提取数量：八瓶 / 8瓶 / 两套 / 4条。 */
function extractQuantity(line: string): { quantity: number; unit: string | null; rest: string } {
  const match = line.match(/([零一二两三四五六七八九十\d]+)\s*(瓶|套|条|个|只|件|对|副|升|L)/i);
  if (!match) return { quantity: 1, unit: null, rest: line };
  const quantity = zhNumeralToNumber(match[1]) ?? 1;
  return { quantity, unit: match[2], rest: (line.slice(0, match.index) + line.slice(match.index! + match[0].length)).trim() };
}

/** 分类：写了"工时"→工时；"工时免费"的实物→配件 0 元；纯实物清单（没提工时）→配件待报价。 */
function classify(line: string, price: number | null): { category: QuickItemCategory; pendingQuote: boolean } {
  const mentionsLabor = /工时|工费|人工/.test(line);
  const laborFree = /工时免费|免工时|工时免/.test(line);
  if (laborFree) return { category: "parts", pendingQuote: false }; // 工时免费：收的是实物，价格没写=0元赠送或待补
  if (mentionsLabor) return { category: "labor", pendingQuote: price === null };
  if (price !== null) return { category: "parts", pendingQuote: false };
  return { category: "parts", pendingQuote: true };
}

/** 把一行里的配件清单切开：按 和/、/，/，/与/空格 分段，保留命中术语词典的段。 */
const UNIT_EN: Record<string, string> = {
  "工时": "labor hours", "小时": "hours", "个": "pcs", "套": "set", "瓶": "bottles",
  "罐": "cans", "桶": "drums", "条": "pcs", "只": "pcs", "对": "pair", "升": "L",
  "次": "time", "台": "unit", "件": "pcs", "副": "set", "支": "pcs", "盒": "boxes",
};

function splitPartPhrases(text: string): string[] {
  const segments = text.split(/[和与、，,；;\s]+/).map((part) => part.trim()).filter(Boolean);
  return segments.filter((part) => part.length >= 2 && TERM_DICT.some(([pattern]) => pattern.test(part)));
}

/**
 * 拆“症状”与“维修动作”（8/18 老板）：
 * “水泵漏防冻液 需要更换水泵，再加防冻液” → 项目名称=更换水泵，备注=水泵漏防冻液，再加防冻液。
 */
function splitSymptomAction(text: string): { name: string; remark: string } {
  const trimmed = text.trim();
  // 1) “…需要…”：需要前=症状/原因，需要后第一段=动作，其余补充进备注
  const needIndex = trimmed.indexOf("需要");
  if (needIndex >= 0) {
    const before = trimmed.slice(0, needIndex).trim();
    const after = trimmed.slice(needIndex + 2).trim();
    const parts = after.split(/[，,；;]+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 0) {
      const name = parts[0];
      const rest = parts.slice(1).join("，");
      const remark = [before, rest].filter(Boolean).join("，");
      return { name, remark };
    }
    return { name: trimmed, remark: "" };
  }
  // 2) 症状模式：X漏油/漏水/异响/老化… → 备注=症状，名称=其余维修动作
  const symptom = trimmed.match(/[\u4e00-\u9fa5]{1,6}(?:漏油|漏水|漏防冻液|漏液|异响|抖动|老化|磨损|开裂|损坏|故障|不工作|烧机油|渗油)/);
  if (symptom) {
    const remark = symptom[0].replace(/^(更换|维修|检修|安装|加|换)/, "");
    let name = trimmed.replace(symptom[0], "").trim();
    name = name.replace(/^[，,、；;\s]+/, "");
    // 相邻重复动词归并："更换 更换气门室盖垫" → "更换气门室盖垫"
    // 去掉症状后可能残留的单个“更/换”字头："更 更换气门室盖垫" → "更换气门室盖垫"
    name = name.replace(/^[更换]\s*(?=(?:更换|维修|检修|安装|加))/, "");
    name = name.replace(/^(更换|维修|检修|安装|加)\s+(?=(?:更换|维修|检修|安装|加))/, "");
    name = name.replace(/\s+/g, "").trim();
    if (name) return { name, remark };
  }
  return { name: trimmed, remark: "" };
}

/** 清洗描述：去掉价格/工时/数量词，留项目本体。 */
function cleanDescription(rest: string): string {
  return rest
    .replace(/工时免费|免工时|工时免|工时费|工时/g, "")
    .replace(/[，。；;.\s]+$/, "")
    .replace(/^[，。；;.\s]+/, "")
    .trim();
}

/** Formal fallback only: price evidence must be a fee/currency expression or a trailing standalone amount. */
function extractFormalPrice(line: string): { price: number | null; rest: string } {
  if (/合计|总价|总共|\btotal\b/i.test(line)) return { price: null, rest: line };
  const amount = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?";
  const patterns = [
    new RegExp(`(?:工时费?|工费|人工费?|配件价|单价|价格|收费|labor|labour|JMD|\\$)\\s*[:：]?\\s*(${amount})(?![\\d.])`, "gi"),
    new RegExp(`(${amount})\\s*(?:JMD|元|块)(?![A-Za-z])`, "gi"),
    new RegExp(`(?:^|\\s|[—–])(${amount})\\s*$`, "g"),
  ];
  const matches = new Map<number, { amount: string; start: number; end: number }>();
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      const amountIndex = match.index! + match[0].indexOf(match[1]);
      if (!matches.has(amountIndex)) matches.set(amountIndex, { amount: match[1], start: match.index!, end: match.index! + match[0].length });
    }
  }
  if (matches.size !== 1) return { price: null, rest: line };
  const match = [...matches.values()][0];
  return { price: Number(match.amount.replaceAll(",", "")), rest: `${line.slice(0, match.start)} ${line.slice(match.end)}`.trim() };
}

function formalPricing(line: string, price: number | null, unit: string | null) {
  const laborFree = /(?:工时费?|工费|人工费?)\s*(?:免费|免收)|免工时|\blabo[u]?r\s+(?:free|no charge)\b/i.test(line);
  const mentionsLabor = /工时|工费|人工|\blabo[u]?r\b|\bJOB\b/i.test(line);
  const material = unit !== null || (!/^(?:更换|维修|检修|检查|清洗|安装)/.test(line) && /剂|机油|滤芯|轮胎|水泵|刹车片|刹车盘/.test(line));
  const category: QuickItemCategory = laborFree && material ? "parts" : mentionsLabor ? "labor" : "parts";
  const explicitlyFree = laborFree ? !material : /(?<!不|非)(?:免费|赠送|赠品|免收)[。.!！\s]*$|\bfree\s*$/i.test(line);
  const knownPrice = price ?? (explicitlyFree ? 0 : null);
  return { category, pendingQuote: knownPrice === null, price: knownPrice, laborFree };
}

export function parseQuickOrderInput(raw: string, formal = false): ParsedQuickItem[] {
  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const items: ParsedQuickItem[] = [];
  for (const line of lines) {
    const firstQuantity = formal ? extractQuantity(line) : null;
    const extracted = formal ? extractFormalPrice(firstQuantity!.rest) : extractPrice(line);
    const { quantity, unit, rest: afterQty } = firstQuantity ? { ...firstQuantity, rest: extracted.rest } : extractQuantity(extracted.rest);
    const pricing = formal ? formalPricing(line, extracted.price, unit) : { ...classify(line, extracted.price), price: extracted.price, laborFree: false };
    const { price, category, pendingQuote } = pricing;
    const cleaned = cleanDescription(afterQty) || line;
    const split = splitSymptomAction(cleaned);
    const name = formal && !pendingQuote ? split.name.replace(/(?:免费|赠送|免收)[。.!！\s]*$/, "").trim() || split.name : split.name;
    const remark = formal && pricing.laborFree && category === "parts" ? [split.remark, "工时免费；配件价格按原文核对。"].filter(Boolean).join("，") : split.remark;
    const phrases = splitPartPhrases(name);
    const isActionName = /^(更换|维修|检修|安装|加)/.test(name);
    if (category === "labor" && price !== null && phrases.length > 0 && !isActionName && !(formal && pricing.laborFree)) {
      // “配件清单 + 工时费”：生成 1 条工时（名称=更换+清单，金额=工时费）+ 每条配件 1 条待报价
      items.push({
        descZh: "更换" + phrases.join("、"),
        descEn: "Replace " + phrases.map((part) => mockTranslate(part)).join(", "),
        remarkZh: remark || undefined,
        remarkEn: remark ? mockTranslate(remark) : undefined,
        category: "labor",
        unit: unit ?? "工时",
        unitEn: UNIT_EN[unit ?? "工时"] ?? "",
        unitPriceJmd: price,
        quantity,
        pendingQuote: false,
      });
      for (const part of phrases) {
        items.push({
          descZh: part,
          descEn: mockTranslate(part),
          category: "parts",
          unit: "个",
          unitEn: UNIT_EN["个"] ?? "",
          unitPriceJmd: 0,
          quantity: 1,
          pendingQuote: true,
        });
      }
    } else if (category === "parts" && pendingQuote && phrases.length > 1) {
      // 纯配件清单多段 → 逐条待报价
      for (const part of phrases) {
        items.push({
          descZh: part,
          descEn: mockTranslate(part),
          category: "parts",
          unit: unit ?? "个",
          unitPriceJmd: 0,
          quantity: 1,
          pendingQuote: true,
        });
      }
    } else {
      items.push({
        descZh: name,
        descEn: mockTranslate(name),
        remarkZh: remark || undefined,
        remarkEn: remark ? mockTranslate(remark) : undefined,
        category,
        unit: unit ?? (category === "labor" ? "工时" : "个"),
      unitEn: UNIT_EN[unit ?? (category === "labor" ? "工时" : "个")] ?? "",
        unitPriceJmd: price ?? 0,
        quantity,
        pendingQuote,
      });
    }
  }
  return items;
}

/**
 * 同一段前台口述中，收费行继续走原拆单器；明确的备注前缀进入收费版本备注。
 * 这是可人工核对的草稿拆分，不会直接写入正式数据。
 */
export function parseChargeEntryInput(raw: string): ParsedChargeEntry {
  const notePrefixes: ReadonlyArray<{
    pattern: RegExp;
    kind: ParsedChargeNoteKind;
  }> = [
    { pattern: /^(?:客户反馈|客户诉求)\s*[：:]\s*/, kind: "customer_concern" },
    { pattern: /^(?:施工说明|施工要求)\s*[：:]\s*/, kind: "work_instruction" },
    { pattern: /^(?:责任说明|提前告知)\s*[：:]\s*/, kind: "liability_notice" },
  ];
  const chargeLines: string[] = [];
  const notes: ParsedChargeNote[] = [];

  for (const rawLine of raw.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const prefix = notePrefixes.find(({ pattern }) => pattern.test(line));
    if (!prefix) {
      chargeLines.push(line);
      continue;
    }
    const contentZh = line.replace(prefix.pattern, "").trim();
    if (!contentZh) continue;
    notes.push({
      kind: prefix.kind,
      contentZh,
      contentEn: mockTranslate(contentZh),
    });
  }

  return {
    items: parseQuickOrderInput(chargeLines.join("\n"), true),
    notes,
  };
}
