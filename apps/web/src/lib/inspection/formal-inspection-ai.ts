import {
  buildInspectionOriginalQuotationText,
  deriveInspectionFollowupStage,
  summarizeInspectionQuotation,
  calculateInspectionQuotationLineSubtotalMinor,
  reconcileExplicitInspectionQuotation,
  type DerivedInspectionQuotation,
  type DerivedInspectionQuotationLine,
} from "@formal/modules/inspection-report/inspection-report-derivation";

export type InspectionQuotationLine = DerivedInspectionQuotationLine;
export type InspectionQuotation = DerivedInspectionQuotation;
export {
  buildInspectionOriginalQuotationText,
  deriveInspectionFollowupStage,
  summarizeInspectionQuotation,
  calculateInspectionQuotationLineSubtotalMinor,
  reconcileExplicitInspectionQuotation,
};

export type InspectionOrganized = {
  summaryZh: string;
  summaryEn: string | null;
  specialCaseNotesZh: string | null;
  specialCaseNotesEn?: string | null;
  findings: Array<{
    findingZh: string;
    findingEn: string | null;
    recommendationZh: string | null;
    recommendationEn: string | null;
  }>;
};

export type InspectionAiProposal = {
  organized: InspectionOrganized;
  quotation: InspectionQuotation;
};

const FOLLOWUP_STAGE_LABELS = {
  zh: ["整理确认", "待发送", "待回复", "已闭环"],
  en: ["Organize & confirm", "Ready to send", "Awaiting reply", "Closed"],
} as const;

export function inspectionFollowupStageLabel(stage: 0 | 1 | 2 | 3, language: "zh" | "en"): string {
  return FOLLOWUP_STAGE_LABELS[language][stage];
}

export function inspectionContentVersionLabel(versionNo: number, language: "zh" | "en"): string {
  if (versionNo <= 0) return language === "en" ? "Original return" : "原始回单";
  return language === "en" ? `Organized version V${versionNo}` : `整理版本 V${versionNo}`;
}

export function inspectionVehicleDescriptionForReport(
  vehicle: {
    description?: string | null;
    descriptionZh?: string | null;
    descriptionEn?: string | null;
  },
  language: "zh" | "en" | "bilingual",
): string {
  const legacyDescription = vehicle.description?.trim() ?? "";
  const descriptionZh = vehicle.descriptionZh?.trim() || legacyDescription || vehicle.descriptionEn?.trim() || "—";
  const descriptionEn = vehicle.descriptionEn?.trim() || legacyDescription || vehicle.descriptionZh?.trim() || "—";
  if (language === "zh") return descriptionZh;
  if (language === "en") return descriptionEn;
  return descriptionZh === descriptionEn ? descriptionZh : `${descriptionZh} / ${descriptionEn}`;
}

export function inspectionTeamNameForReport(
  teamName: string,
  language: "zh" | "en" | "bilingual",
): { value: string; fallbackNote: string | null } {
  if (language === "zh") return { value: teamName, fallbackNote: null };
  return {
    value: teamName,
    fallbackNote: language === "en"
      ? "Stored team name; English name unavailable."
      : "原始登记名称；未登记英文班组名。 / Stored name; English name unavailable.",
  };
}

function englishSourceSummary(text: string): string | null {
  const lines = text.split(/\r?\n/)
    .map((line) => line
      .replace(/\s*[（(][^()（）]*[\u3400-\u9fff][^()（）]*[）)]\s*$/, "")
      .replace(/^\s*\d+[.)、]?\s*/, "")
      .trim())
    .filter((line) => /[A-Za-z]{2,}/.test(line));
  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Completes deterministic facts that the model is not allowed to invent:
 * explicit source prices and English text already present in a bilingual return.
 */
export function completeInspectionAiProposal(
  proposal: InspectionAiProposal,
  originalText: string,
): InspectionAiProposal {
  const quotation = reconcileExplicitInspectionQuotation(proposal.quotation, originalText);
  const usedProposalLines = new Set<number>();
  const lines = quotation.lines.map((line) => {
    const matchingProposalIndex = proposal.quotation.lines.findIndex((candidate, index) =>
      !usedProposalLines.has(index)
      && quotationLineGrossMinor(candidate) !== null
      && quotationLineGrossMinor(candidate) === line.subtotalMinor
      && candidate.kind === line.kind,
    );
    const candidate = matchingProposalIndex >= 0
      ? proposal.quotation.lines[matchingProposalIndex]
      : null;
    if (matchingProposalIndex >= 0) usedProposalLines.add(matchingProposalIndex);
    if (!candidate) return line;
    const classificationPending = line.kind === "other" && line.nameZh === "待确认项目";
    const itemDiscountMinor = Math.min(candidate.itemDiscountMinor ?? 0, line.subtotalMinor ?? 0);
    return {
      ...line,
      nameZh: !classificationPending && quoteNameIsUsable(candidate.nameZh)
        ? candidate.nameZh.trim()
        : line.nameZh,
      nameEn: !classificationPending && quoteNameIsUsable(candidate.nameEn)
        ? candidate.nameEn?.trim() ?? null
        : line.nameEn,
      descriptionZh: candidate.descriptionZh?.trim() || line.descriptionZh,
      descriptionEn: candidate.descriptionEn?.trim() || line.descriptionEn,
      itemDiscountMinor,
      subtotalMinor: line.subtotalMinor === null ? null : line.subtotalMinor - itemDiscountMinor,
    };
  });

  return {
    organized: {
      ...proposal.organized,
      summaryEn: proposal.organized.summaryEn?.trim() || englishSourceSummary(originalText),
    },
    quotation: {
      ...quotation,
      wholeOrderDiscountMinor: proposal.quotation.wholeOrderDiscountMinor ?? 0,
      lines,
    },
  };
}

function quotationLineGrossMinor(line: DerivedInspectionQuotationLine): number | null {
  const quantity = Number(line.quantity);
  if (line.unitPriceMinor !== null && Number.isFinite(quantity) && quantity > 0) {
    return Math.round(line.unitPriceMinor * quantity);
  }
  return line.subtotalMinor === null ? null : line.subtotalMinor + (line.itemDiscountMinor ?? 0);
}

function quoteNameIsUsable(name: string | null): boolean {
  if (!name?.trim()) return false;
  const value = name.trim();
  return value.length <= 48
    && !/[,，。;；]/.test(value)
    && !/\bJMD\b|\bthen\b|\bcarry out\b|\bfurther\b|然后|进一步/i.test(value)
    && !/(?:x|×)?\s*\d+(?:\.\d+)?\s*(?:bottles?|pieces?|sets?|units?|lit(?:er|re)s?|瓶|件|个|套|支|片|升)/i.test(value);
}

/** Customer-facing AI output is not usable until both languages are present. */
export function inspectionAiProposalIssues(proposal: InspectionAiProposal): string[] {
  const issues: string[] = [];
  if (!proposal.organized.summaryZh?.trim()) issues.push("summary_zh_missing");
  if (!proposal.organized.summaryEn?.trim()) issues.push("summary_en_missing");
  if (proposal.organized.specialCaseNotesZh?.trim() && !proposal.organized.specialCaseNotesEn?.trim()) {
    issues.push("special_case_notes_en_missing");
  }
  proposal.organized.findings.forEach((finding, index) => {
    const number = index + 1;
    if (!finding.findingZh?.trim()) issues.push(`finding_${number}_zh_missing`);
    if (!finding.findingEn?.trim()) issues.push(`finding_${number}_en_missing`);
    if (finding.recommendationZh?.trim() && !finding.recommendationEn?.trim()) {
      issues.push(`recommendation_${number}_en_missing`);
    }
  });
  if (proposal.quotation.noteZh?.trim() && !proposal.quotation.noteEn?.trim()) {
    issues.push("quotation_note_en_missing");
  }
  proposal.quotation.lines.forEach((line, index) => {
    const number = index + 1;
    if (!line.nameZh?.trim()) issues.push(`quotation_line_${number}_zh_missing`);
    if (!line.nameEn?.trim()) issues.push(`quotation_line_${number}_en_missing`);
  });
  return issues;
}
