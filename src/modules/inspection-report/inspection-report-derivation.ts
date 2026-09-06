export type DerivedInspectionQuotationLine = {
  kind: "labor" | "part" | "other";
  nameZh: string;
  nameEn: string | null;
  descriptionZh: string | null;
  descriptionEn: string | null;
  quantity: string;
  unitPriceMinor: number | null;
  itemDiscountMinor?: number;
  subtotalMinor: number | null;
};

export type DerivedInspectionQuotation = {
  status: "pending" | "entered" | "not_quoted";
  noteZh: string | null;
  noteEn: string | null;
  wholeOrderDiscountMinor?: number;
  lines: DerivedInspectionQuotationLine[];
};

export type InspectionQuotationSummary = {
  groups: Record<DerivedInspectionQuotationLine["kind"], {
    grossMinor: number;
    discountMinor: number;
    subtotalMinor: number;
  }>;
  grossMinor: number;
  itemDiscountMinor: number;
  lineSubtotalMinor: number;
  wholeOrderDiscountMinor: number;
  totalDueMinor: number;
};

function nonnegativeMoney(value: number | null | undefined): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

export function calculateInspectionQuotationLineSubtotalMinor(
  line: Pick<DerivedInspectionQuotationLine, "quantity" | "unitPriceMinor" | "itemDiscountMinor">,
): number | null {
  const quantity = Number(line.quantity);
  if (line.unitPriceMinor === null || !Number.isFinite(quantity) || quantity <= 0) return null;
  const grossMinor = Math.round(line.unitPriceMinor * quantity);
  return Math.max(0, grossMinor - nonnegativeMoney(line.itemDiscountMinor));
}

export function summarizeInspectionQuotation(quotation: DerivedInspectionQuotation): InspectionQuotationSummary {
  const groups: InspectionQuotationSummary["groups"] = {
    labor: { grossMinor: 0, discountMinor: 0, subtotalMinor: 0 },
    part: { grossMinor: 0, discountMinor: 0, subtotalMinor: 0 },
    other: { grossMinor: 0, discountMinor: 0, subtotalMinor: 0 },
  };
  for (const line of quotation.lines) {
    const discountMinor = nonnegativeMoney(line.itemDiscountMinor);
    const calculatedSubtotalMinor = calculateInspectionQuotationLineSubtotalMinor(line);
    const subtotalMinor = nonnegativeMoney(line.subtotalMinor ?? calculatedSubtotalMinor);
    const quantity = Number(line.quantity);
    const grossMinor = line.unitPriceMinor !== null && Number.isFinite(quantity) && quantity > 0
      ? Math.round(line.unitPriceMinor * quantity)
      : subtotalMinor + discountMinor;
    groups[line.kind].grossMinor += grossMinor;
    groups[line.kind].discountMinor += discountMinor;
    groups[line.kind].subtotalMinor += subtotalMinor;
  }
  const grossMinor = groups.labor.grossMinor + groups.part.grossMinor + groups.other.grossMinor;
  const itemDiscountMinor = groups.labor.discountMinor + groups.part.discountMinor + groups.other.discountMinor;
  const lineSubtotalMinor = groups.labor.subtotalMinor + groups.part.subtotalMinor + groups.other.subtotalMinor;
  const wholeOrderDiscountMinor = Math.min(nonnegativeMoney(quotation.wholeOrderDiscountMinor), lineSubtotalMinor);
  return {
    groups,
    grossMinor,
    itemDiscountMinor,
    lineSubtotalMinor,
    wholeOrderDiscountMinor,
    totalDueMinor: lineSubtotalMinor - wholeOrderDiscountMinor,
  };
}

export type InspectionFollowupStage = 0 | 1 | 2 | 3;

export type ParsedExplicitInspectionQuotationLine = DerivedInspectionQuotationLine & {
  classificationPending: boolean;
};

const EXPLICIT_JMD = /(?:\bJMD\s*([0-9][\d,]*(?:\.\d{1,2})?)|([0-9][\d,]*(?:\.\d{1,2})?)\s*JMD\b)/gi;

function amountMinor(value: string): number | null {
  const amount = Number(value.replaceAll(",", ""));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function explicitAmountMatches(text: string): number[] {
  return [...text.matchAll(EXPLICIT_JMD)]
    .map((match) => amountMinor(match[1] ?? match[2] ?? ""))
    .filter((value): value is number => value !== null);
}

export function buildInspectionOriginalQuotationText(input: {
  summaryZh?: string | null;
  summaryEn?: string | null;
  specialCaseNotesZh?: string | null;
  specialCaseNotesEn?: string | null;
  findings?: ReadonlyArray<{
    findingZh?: string | null;
    findingEn?: string | null;
    recommendationZh?: string | null;
    recommendationEn?: string | null;
  }>;
}): string {
  const choosePairedSource = (zh?: string | null, en?: string | null) => {
    const chinese = zh?.trim() ?? "";
    const english = en?.trim() ?? "";
    const chineseAmounts = explicitAmountMatches(chinese);
    const englishAmounts = explicitAmountMatches(english);
    if (chineseAmounts.length > 0 && englishAmounts.length > 0) {
      const unmatchedChineseAmounts = new Map<number, number>();
      chineseAmounts.forEach((amount) => {
        unmatchedChineseAmounts.set(amount, (unmatchedChineseAmounts.get(amount) ?? 0) + 1);
      });
      const extraEnglishSegments = english.split(/\r?\n/).flatMap((line) => pricedSegments(line)).flatMap((segment) => {
        const remaining = unmatchedChineseAmounts.get(segment.subtotalMinor) ?? 0;
        if (remaining > 0) {
          unmatchedChineseAmounts.set(segment.subtotalMinor, remaining - 1);
          return [];
        }
        return [segment.text.trim()];
      });
      return [chinese, ...extraEnglishSegments].filter(Boolean).join("\n");
    }
    if (chineseAmounts.length > 0) return chinese;
    if (englishAmounts.length > 0) return english;
    return chinese || english;
  };
  return [
    choosePairedSource(input.summaryZh, input.summaryEn),
    choosePairedSource(input.specialCaseNotesZh, input.specialCaseNotesEn),
    ...(input.findings ?? []).flatMap((finding) => [
      choosePairedSource(finding.findingZh, finding.findingEn),
      choosePairedSource(finding.recommendationZh, finding.recommendationEn),
    ]),
  ].filter(Boolean).join("\n");
}

function cleanPricedLineText(line: string): string {
  return line
    .replace(EXPLICIT_JMD, "")
    .replace(/^\s*\d+[.)、]?\s*/, "")
    .replace(/^\s*[,，;；。+&—–-]+\s*/, "")
    .replace(/[—–-]\s*$/, "")
    .replace(/(?:^|[—–-]\s*)(?:labor|labour|parts?|materials?|other(?:\s+(?:charge|fee))?|misc(?:ellaneous)?(?:\s+(?:charge|fee))?)\s*:\s*/gi, "")
    .replace(/(?:^|[—–-]\s*)(?:工时|人工|配件|材料|其他费用|杂费)\s*[:：]\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function pricedSegments(sourceLine: string): Array<{ text: string; subtotalMinor: number }> {
  const matches = [...sourceLine.matchAll(EXPLICIT_JMD)].flatMap((match) => {
    const subtotalMinor = amountMinor(match[1] ?? match[2] ?? "");
    return subtotalMinor === null || match.index === undefined
      ? []
      : [{ index: match.index, end: match.index + match[0].length, subtotalMinor }];
  });
  if (matches.length <= 1) {
    return matches.map((match) => ({ text: sourceLine, subtotalMinor: match.subtotalMinor }));
  }
  const segments: Array<{ text: string; subtotalMinor: number }> = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    let end = match.end;
    const translationTail = sourceLine.slice(end).match(/^\s*[（(][^()（）]*[）)]/);
    if (translationTail) end += translationTail[0].length;
    if (index === matches.length - 1) end = sourceLine.length;
    segments.push({ text: sourceLine.slice(cursor, end), subtotalMinor: match.subtotalMinor });
    cursor = end;
  });
  return segments;
}

function normalizedChinese(text: string): string {
  return text.replaceAll(",", "，").replace(/\s+/g, " ").trim();
}

function firstClause(text: string): string {
  return text.split(/[,，;；。]/, 1)[0]?.trim() ?? "";
}

function conciseLaborNameZh(descriptionZh: string | null): string {
  const clause = firstClause(descriptionZh ?? "").replace(/^(?:先|首先|然后|再|请|建议)\s*/, "");
  const action = clause.match(/^(清洗|更换|检查|维修|诊断)(.+)$/);
  if (!action) return "工时项目";
  return `${action[2].trim()}${action[1]}工时`;
}

function titleCaseFirst(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function conciseLaborNameEn(descriptionEn: string | null): string {
  const clause = firstClause(descriptionEn ?? "").replace(/^(?:first|then|please|we recommend)\s+/i, "").replace(/\s+first$/i, "");
  const action = clause.match(/^(?:clean|wash)\s+(?:the\s+)?(.+)$/i);
  if (action) return `${titleCaseFirst(action[1].trim())} cleaning labor`;
  const cleaning = clause.match(/^(.+?)\s+cleaning$/i);
  if (cleaning) return `${titleCaseFirst(cleaning[1].trim())} cleaning labor`;
  const replacement = clause.match(/^replace\s+(?:the\s+)?(.+)$/i);
  if (replacement) return `${titleCaseFirst(replacement[1].trim())} replacement labor`;
  const inspection = clause.match(/^(?:inspect|check|diagnose)\s+(?:the\s+)?(.+)$/i);
  if (inspection) return `${titleCaseFirst(inspection[1].trim())} inspection labor`;
  const repair = clause.match(/^repair\s+(?:the\s+)?(.+)$/i);
  if (repair) return `${titleCaseFirst(repair[1].trim())} repair labor`;
  return "Labor item";
}

function quantityDescription(text: string, quantity: string, english: boolean): string | null {
  const units = english
    ? text.match(/(?:x|×)?\s*\d+(?:\.\d+)?\s*(bottles?|pieces?|sets?|units?|lit(?:er|re)s?)/i)?.[1]
    : text.match(/(?:x|×)?\s*\d+(?:\.\d+)?\s*(瓶|件|个|套|支|片|升)/)?.[1];
  return units ? `${quantity} ${units}` : null;
}

function concisePartName(text: string, english: boolean): string {
  return text
    .replace(/(?:x|×)?\s*\d+(?:\.\d+)?\s*(?:bottles?|pieces?|sets?|units?|lit(?:er|re)s?|瓶|件|个|套|支|片|升)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim() || (english ? "Part or material" : "配件或材料");
}

function parsedLineFields(
  line: string,
  kind: DerivedInspectionQuotationLine["kind"],
  quantity: string,
  classificationPending: boolean,
): Pick<ParsedExplicitInspectionQuotationLine, "nameZh" | "nameEn" | "descriptionZh" | "descriptionEn"> {
  const chineseTail = normalizedChinese(line.match(/JMD\s*[（(]([^()（）]+)[）)]\s*$/i)?.[1] ?? "") || null;
  const withoutChineseTail = line.replace(/\s*[（(][^()（）]+[）)]\s*$/, "");
  const pricedText = cleanPricedLineText(withoutChineseTail);
  const descriptionEn = /[A-Za-z]{2,}/.test(pricedText) ? pricedText : null;
  const descriptionZh = chineseTail ?? (/[^\x00-\x7F]/.test(pricedText) ? normalizedChinese(pricedText) : null);

  if (classificationPending) {
    return {
      nameZh: "待确认项目",
      nameEn: "Item pending confirmation",
      descriptionZh,
      descriptionEn,
    };
  }
  if (kind === "labor") {
    return {
      nameZh: conciseLaborNameZh(descriptionZh),
      nameEn: descriptionEn ? conciseLaborNameEn(descriptionEn) : null,
      descriptionZh,
      descriptionEn,
    };
  }
  if (kind === "part") {
    return {
      nameZh: concisePartName(descriptionZh ?? "", false),
      nameEn: descriptionEn ? concisePartName(descriptionEn, true) : null,
      descriptionZh: descriptionZh ? quantityDescription(descriptionZh, quantity, false) : null,
      descriptionEn: descriptionEn ? quantityDescription(descriptionEn, quantity, true) : null,
    };
  }
  return {
    nameZh: descriptionZh ? concisePartName(descriptionZh, false) : "其他费用",
    nameEn: descriptionEn ? concisePartName(descriptionEn, true) : "Other charge",
    descriptionZh,
    descriptionEn,
  };
}

export function parseExplicitInspectionQuotationLines(text: string): ParsedExplicitInspectionQuotationLine[] {
  const result: ParsedExplicitInspectionQuotationLine[] = [];
  for (const sourceLine of text.split(/\r?\n/)) {
    for (const segment of pricedSegments(sourceLine)) {
      const quantityMatch = segment.text.match(/(?:\bx|×)\s*(\d+(?:\.\d+)?)/i)
        ?? segment.text.match(/(\d+(?:\.\d+)?)\s*(?:瓶|件|个|套|支|片)/);
      const quantity = quantityMatch?.[1] ?? "1";
      const kind = /\b(?:labor|labour)\s*:|工时\s*[:：]|人工\s*[:：]/i.test(segment.text)
        ? "labor"
        : /\b(?:part(?:s)?|material(?:s)?)\s*:|配件\s*[:：]|材料\s*[:：]|cleaning agent|fluid|filter|bottle|清洗剂|滤清器|油液/i.test(segment.text)
          ? "part"
          : "other";
      const explicitOther = /\b(?:other(?:\s+(?:charge|fee))?|misc(?:ellaneous)?(?:\s+(?:charge|fee))?)\s*:|其他费用\s*[:：]|杂费\s*[:：]/i.test(segment.text);
      const classificationPending = kind === "other" && !explicitOther;
      result.push({
        kind,
        ...parsedLineFields(segment.text, kind, quantity, classificationPending),
        quantity,
        unitPriceMinor: Number(quantity) === 1 ? segment.subtotalMinor : null,
        itemDiscountMinor: 0,
        subtotalMinor: segment.subtotalMinor,
        classificationPending,
      });
    }
  }
  return result;
}

function publicQuotationLine(line: ParsedExplicitInspectionQuotationLine): DerivedInspectionQuotationLine {
  return {
    kind: line.kind,
    nameZh: line.nameZh,
    nameEn: line.nameEn,
    descriptionZh: line.descriptionZh,
    descriptionEn: line.descriptionEn,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    itemDiscountMinor: line.itemDiscountMinor ?? 0,
    subtotalMinor: line.subtotalMinor,
  };
}

export function reconcileExplicitInspectionQuotation(
  quotation: DerivedInspectionQuotation,
  originalText: string,
): DerivedInspectionQuotation {
  const sourceLines = parseExplicitInspectionQuotationLines(originalText);
  const classificationPending = sourceLines.some((line) => line.classificationPending);
  if (sourceLines.length === 0) {
    return {
      status: "pending",
      noteZh: "原始回单没有明确价格，报价待前台补充。",
      noteEn: "No explicit price appears in the original return. Price entry is pending.",
      wholeOrderDiscountMinor: 0,
      lines: [],
    };
  }

  return {
    ...quotation,
    wholeOrderDiscountMinor: quotation.wholeOrderDiscountMinor ?? 0,
    status: "entered",
    noteZh: classificationPending
      ? "原始回单有明确金额，但部分项目的分类和项目名称待前台确认。"
      : quotation.noteZh ?? "报价金额来自维修工原始回单，请前台核对后采用。",
    noteEn: classificationPending
      ? "The original return contains explicit prices, but some classification and item name require front-desk confirmation."
      : quotation.noteEn ?? "Prices come from the mechanic's original return and require front-desk review.",
    lines: sourceLines.map(publicQuotationLine),
  };
}

export function deriveOriginalInspectionQuotation(originalText: string): DerivedInspectionQuotation {
  return reconcileExplicitInspectionQuotation({
    status: "pending",
    noteZh: null,
    noteEn: null,
    wholeOrderDiscountMinor: 0,
    lines: [],
  }, originalText);
}

export function deriveInspectionFollowupStage(
  workspaceVersion: number,
  communications: ReadonlyArray<{ status: "initiated" | "confirmed" | "not_delivered" }>,
): InspectionFollowupStage {
  const latest = communications[0]?.status;
  if (latest === "confirmed") return 3;
  if (latest === "initiated") return 2;
  if (latest === "not_delivered") return 1;
  return workspaceVersion > 0 ? 1 : 0;
}
