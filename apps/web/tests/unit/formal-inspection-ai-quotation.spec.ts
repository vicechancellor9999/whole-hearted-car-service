import { expect, test } from "@playwright/test";
import {
  buildInspectionOriginalQuotationText,
  completeInspectionAiProposal,
  deriveInspectionFollowupStage,
  inspectionAiProposalIssues,
  summarizeInspectionQuotation,
  reconcileExplicitInspectionQuotation,
} from "../../src/lib/inspection/formal-inspection-ai";
import * as inspectionPresentationModule from "../../src/lib/inspection/formal-inspection-ai";

const inspectionPresentation = inspectionPresentationModule as typeof inspectionPresentationModule & {
  inspectionContentVersionLabel?: (versionNo: number, language: "zh" | "en") => string;
  inspectionFollowupStageLabel?: (stage: 0 | 1 | 2 | 3, language: "zh" | "en") => string;
  inspectionTeamNameForReport?: (
    teamName: string,
    language: "zh" | "en" | "bilingual",
  ) => { value: string; fallbackNote: string | null };
  inspectionVehicleDescriptionForReport?: (
    vehicle: { descriptionZh: string; descriptionEn: string },
    language: "zh" | "en" | "bilingual",
  ) => string;
};

test("inspection quotation totals preserve item discounts and whole-order discount", () => {
  expect(summarizeInspectionQuotation({
    status: "entered",
    noteZh: null,
    noteEn: null,
    wholeOrderDiscountMinor: 100_000,
    lines: [
      {
        kind: "labor",
        nameZh: "诊断工时",
        nameEn: "Diagnostic labor",
        descriptionZh: null,
        descriptionEn: null,
        quantity: "2",
        unitPriceMinor: 1_000_000,
        itemDiscountMinor: 10_000,
        subtotalMinor: 1_990_000,
      },
      {
        kind: "part",
        nameZh: "机油滤清器",
        nameEn: "Oil filter",
        descriptionZh: null,
        descriptionEn: null,
        quantity: "1",
        unitPriceMinor: 550_000,
        itemDiscountMinor: 70_000,
        subtotalMinor: 480_000,
      },
    ],
  })).toEqual({
    groups: {
      labor: { grossMinor: 2_000_000, discountMinor: 10_000, subtotalMinor: 1_990_000 },
      part: { grossMinor: 550_000, discountMinor: 70_000, subtotalMinor: 480_000 },
      other: { grossMinor: 0, discountMinor: 0, subtotalMinor: 0 },
    },
    grossMinor: 2_550_000,
    itemDiscountMinor: 80_000,
    lineSubtotalMinor: 2_470_000,
    wholeOrderDiscountMinor: 100_000,
    totalDueMinor: 2_370_000,
  });
});

test("explicit JMD prices in a mechanic return become a quotation when AI omits lines", () => {
  const quotation = reconcileExplicitInspectionQuotation({
    status: "pending",
    noteZh: null,
    noteEn: null,
    lines: [],
  }, [
    "1 Clean the throttle body first, then carry out further inspection — Labor: 15,000 JMD",
    "2 Cleaning agent x1 bottle — 800 JMD",
  ].join("\n"));

  expect(quotation.status).toBe("entered");
  expect(quotation.lines).toHaveLength(2);
  expect(quotation.lines[0]).toMatchObject({ kind: "labor", subtotalMinor: 1_500_000 });
  expect(quotation.lines[1]).toMatchObject({ quantity: "1", subtotalMinor: 80_000 });
});

test("an incomplete AI quotation cannot drop another explicit source price", () => {
  const proposal = completeInspectionAiProposal({
    organized: {
      summaryZh: "清洗节气门并使用清洗剂。",
      summaryEn: "Clean the throttle body and use cleaning agent.",
      specialCaseNotesZh: null,
      specialCaseNotesEn: null,
      findings: [],
    },
    quotation: {
      status: "entered",
      noteZh: null,
      noteEn: null,
      lines: [{
        kind: "labor",
        nameZh: "节气门清洗工时",
        nameEn: "Throttle body cleaning labor",
        descriptionZh: null,
        descriptionEn: null,
        quantity: "1",
        unitPriceMinor: 1_500_000,
        subtotalMinor: 1_500_000,
      }],
    },
  }, [
    "Labor: throttle body cleaning — 15,000 JMD(节气门清洗)",
    "Material: cleaning agent — 800 JMD(清洗剂)",
  ].join("\n"));

  expect(proposal.quotation.lines.map((line) => line.subtotalMinor)).toEqual([
    1_500_000,
    80_000,
  ]);
});

test("multiple explicit prices on one source line remain separate quotation facts", () => {
  const quotation = reconcileExplicitInspectionQuotation({
    status: "pending",
    noteZh: null,
    noteEn: null,
    lines: [],
  }, "Labor: throttle body cleaning 15,000 JMD; Material: cleaning agent 800 JMD");

  expect(quotation.lines).toHaveLength(2);
  expect(quotation.lines).toEqual([
    expect.objectContaining({ kind: "labor", subtotalMinor: 1_500_000 }),
    expect.objectContaining({ kind: "part", subtotalMinor: 80_000 }),
  ]);
});

test("paired Chinese and English source fields do not duplicate the same quotation", () => {
  const originalText = buildInspectionOriginalQuotationText({
    summaryZh: "工时：清洗节气门 15,000 JMD",
    summaryEn: "Labor: throttle body cleaning 15,000 JMD",
    specialCaseNotesZh: null,
    specialCaseNotesEn: null,
    findings: [],
  });
  const quotation = reconcileExplicitInspectionQuotation({
    status: "pending",
    noteZh: null,
    noteEn: null,
    lines: [],
  }, originalText);

  expect(quotation.lines).toHaveLength(1);
  expect(quotation.lines[0]).toMatchObject({ kind: "labor", subtotalMinor: 1_500_000 });
});

test("paired source fields keep an extra explicit price that exists in only one language", () => {
  const originalText = buildInspectionOriginalQuotationText({
    summaryZh: "工时：清洗节气门 15,000 JMD",
    summaryEn: [
      "Labor: throttle body cleaning 15,000 JMD",
      "Material: cleaning agent 800 JMD",
    ].join("\n"),
    specialCaseNotesZh: null,
    specialCaseNotesEn: null,
    findings: [],
  });
  const quotation = reconcileExplicitInspectionQuotation({
    status: "pending",
    noteZh: null,
    noteEn: null,
    lines: [],
  }, originalText);

  expect(quotation.lines).toHaveLength(2);
  expect(quotation.lines.map((line) => line.subtotalMinor)).toEqual([1_500_000, 80_000]);
});

test("same-price AI lines never cross categories when enriching deterministic quotation facts", () => {
  const proposal = completeInspectionAiProposal({
    organized: {
      summaryZh: "清洗节气门并更换滤清器。",
      summaryEn: "Clean the throttle body and replace the filter.",
      specialCaseNotesZh: null,
      specialCaseNotesEn: null,
      findings: [],
    },
    quotation: {
      status: "entered",
      noteZh: null,
      noteEn: null,
      lines: [
        {
          kind: "part",
          nameZh: "滤清器",
          nameEn: "Filter",
          descriptionZh: "更换滤清器",
          descriptionEn: "Replace the filter",
          quantity: "1",
          unitPriceMinor: 500_000,
          subtotalMinor: 500_000,
        },
      ],
    },
  }, "Labor: throttle body cleaning — 5,000 JMD(清洗节气门)");

  expect(proposal.quotation.lines).toEqual([expect.objectContaining({
    kind: "labor",
    nameZh: "节气门清洗工时",
    nameEn: "Throttle body cleaning labor",
  })]);
});

test("a bilingual mechanic return repairs an incomplete AI proposal into visible translated quote lines", () => {
  const source = [
    "1 Clean the throttle body first, then carry out further inspection — Labor: 15,000 JMD(先清洗节气门,再进一步检查)",
    "2 Cleaning agent ×1 bottle — 800 JMD(清洗剂1瓶)",
  ].join("\n");

  const proposal = completeInspectionAiProposal({
    organized: {
      summaryZh: "先清洗节气门，然后进一步检查。需要使用一瓶清洗剂。",
      summaryEn: null,
      specialCaseNotesZh: null,
      specialCaseNotesEn: null,
      findings: [],
    },
    quotation: {
      status: "pending",
      noteZh: null,
      noteEn: null,
      lines: [],
    },
  }, source);

  expect(proposal.organized.summaryEn).toContain("Clean the throttle body");
  expect(proposal.quotation.status).toBe("entered");
  expect(proposal.quotation.lines).toHaveLength(2);
  expect(proposal.quotation.lines[0]).toMatchObject({
    kind: "labor",
    nameZh: "节气门清洗工时",
    nameEn: "Throttle body cleaning labor",
    descriptionZh: "先清洗节气门，再进一步检查",
    descriptionEn: "Clean the throttle body first, then carry out further inspection",
    quantity: "1",
    subtotalMinor: 1_500_000,
  });
  expect(proposal.quotation.lines[1]).toMatchObject({
    kind: "part",
    nameZh: "清洗剂",
    nameEn: "Cleaning agent",
    descriptionZh: "1 瓶",
    descriptionEn: "1 bottle",
    quantity: "1",
    subtotalMinor: 80_000,
  });
});

test("a vague priced sentence stays pending classification instead of being guessed as labor or parts", () => {
  const quotation = reconcileExplicitInspectionQuotation({
    status: "pending",
    noteZh: null,
    noteEn: null,
    lines: [],
  }, "1 Further treatment — 2,000 JMD(进一步处理)");

  expect(quotation.lines).toEqual([expect.objectContaining({
    kind: "other",
    nameZh: "待确认项目",
    nameEn: "Item pending confirmation",
    descriptionZh: "进一步处理",
    descriptionEn: "Further treatment",
    subtotalMinor: 200_000,
  })]);
  expect(quotation.noteZh).toContain("分类和项目名称待前台确认");
  expect(quotation.noteEn).toContain("classification and item name require front-desk confirmation");
});

test("AI proposal validation rejects a result that leaves customer-facing translations empty", () => {
  const issues = inspectionAiProposalIssues({
    organized: {
      summaryZh: "发现节气门积碳。",
      summaryEn: null,
      specialCaseNotesZh: null,
      specialCaseNotesEn: null,
      findings: [{
        findingZh: "节气门积碳",
        findingEn: null,
        recommendationZh: "建议清洗",
        recommendationEn: null,
      }],
    },
    quotation: {
      status: "entered",
      noteZh: "请核对",
      noteEn: null,
      lines: [{
        kind: "labor",
        nameZh: "清洗节气门",
        nameEn: null,
        descriptionZh: null,
        descriptionEn: null,
        quantity: "1",
        unitPriceMinor: 1_500_000,
        subtotalMinor: 1_500_000,
      }],
    },
  });

  expect(issues).toEqual([
    "summary_en_missing",
    "finding_1_en_missing",
    "recommendation_1_en_missing",
    "quotation_note_en_missing",
    "quotation_line_1_en_missing",
  ]);
});

test("AI prices absent from the mechanic return are removed rather than invented", () => {
  const quotation = reconcileExplicitInspectionQuotation({
    status: "entered",
    noteZh: "AI guess",
    noteEn: null,
    lines: [{
      kind: "part",
      nameZh: "空气滤清器",
      nameEn: "Air filter",
      descriptionZh: null,
      descriptionEn: null,
      quantity: "1",
      unitPriceMinor: 900_000,
      subtotalMinor: 900_000,
    }],
  }, "发现空气滤清器较脏，建议更换。");

  expect(quotation).toEqual({
    status: "pending",
    noteZh: "原始回单没有明确价格，报价待前台补充。",
    noteEn: "No explicit price appears in the original return. Price entry is pending.",
    wholeOrderDiscountMinor: 0,
    lines: [],
  });
});

test("the latest append-only follow-up fact controls the current stage", () => {
  expect(deriveInspectionFollowupStage(1, [
    { status: "initiated" },
    { status: "confirmed" },
  ])).toBe(2);
  expect(deriveInspectionFollowupStage(1, [
    { status: "not_delivered" },
    { status: "confirmed" },
  ])).toBe(1);
  expect(deriveInspectionFollowupStage(0, [])).toBe(0);
});

test("customer follow-up stage and content version have distinct labels", () => {
  expect(inspectionPresentation.inspectionFollowupStageLabel?.(2, "zh")).toBe("待回复");
  expect(inspectionPresentation.inspectionFollowupStageLabel?.(2, "en")).toBe("Awaiting reply");
  expect(inspectionPresentation.inspectionContentVersionLabel?.(0, "zh")).toBe("原始回单");
  expect(inspectionPresentation.inspectionContentVersionLabel?.(3, "en")).toBe("Organized version V3");
});

test("A4 vehicle language selection uses stored localized vehicle facts", () => {
  const vehicle = { descriptionZh: "日产 奇骏", descriptionEn: "Nissan X-Trail" };

  expect(inspectionPresentation.inspectionVehicleDescriptionForReport?.(vehicle, "zh")).toBe("日产 奇骏");
  expect(inspectionPresentation.inspectionVehicleDescriptionForReport?.(vehicle, "en")).toBe("Nissan X-Trail");
  expect(inspectionPresentation.inspectionVehicleDescriptionForReport?.(vehicle, "bilingual")).toBe("日产 奇骏 / Nissan X-Trail");
});

test("A4 keeps the stored team name and discloses the English fallback", () => {
  expect(inspectionPresentation.inspectionTeamNameForReport?.("车间一组", "en")).toEqual({
    value: "车间一组",
    fallbackNote: "Stored team name; English name unavailable.",
  });
  expect(inspectionPresentation.inspectionTeamNameForReport?.("车间一组", "bilingual")).toEqual({
    value: "车间一组",
    fallbackNote: "原始登记名称；未登记英文班组名。 / Stored name; English name unavailable.",
  });
});
