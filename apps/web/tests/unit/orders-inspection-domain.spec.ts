import { expect, test } from "@playwright/test";
import {
  createBusinessOrderConversion,
  createInspectionAiDraft,
  createInspectionQuoteDocument,
  createInspectionSubmission,
  createRepairAssignmentFromInspection,
  publishInspectionQuoteVersion,
  reassignOrderAssignment,
} from "../../src/lib/orders/inspection-types";

function inspectionSubmission() {
  return createInspectionSubmission({
    id: "inspection-submission-1",
    inspectionReportNo: "KGN-WH-IR-2026080919422",
    vehicleId: "vehicle-1",
    inspectorId: "mechanic-1",
    inspectorName: "余成生",
    inspectorTeamId: "t1",
    submittedAt: "2026-08-09T09:15:00-05:00",
    naturalLanguageResult: "前刹车片剩余约两毫米，建议更换；右前轮有异响，建议进一步拆检。",
    suggestedLaborItems: [{
      id: "labor-1",
      name: "更换前刹车片",
      suggestedHours: 1.5,
      quotedJmd: 8_000,
    }],
    suggestedPartItems: [{
      id: "part-1",
      name: "前刹车片",
      quantity: 1,
      quotedUnitJmd: 12_500,
    }],
    photos: [{ id: "photo-1", url: "/inspection/photo-1.jpg", caption: "前刹车片" }],
    mileageKm: 82_140,
    sourceVersion: 1,
    submissionSource: "mechanic_portal",
  });
}

function aiDraft() {
  return createInspectionAiDraft(inspectionSubmission(), {
    id: "ai-draft-1",
    generatedAt: "2026-08-09T09:16:00-05:00",
    conclusion: "前制动系统需要维修，右前轮需要进一步检查。",
    items: [{
      id: "draft-item-1",
      title: "更换前刹车片",
      sourceFactRefs: ["naturalLanguageResult", "suggestedLaborItems:labor-1"],
    }],
    customerExplanationZh: "建议更换前刹车片，并检查右前轮异响。",
    customerExplanationEn: "Replace the front brake pads and inspect the right-front wheel noise.",
  });
}

test("维修工原始自然语言、署名、价格和检查事实创建后深度只读", () => {
  const submission = inspectionSubmission();

  expect(submission).toMatchObject({
    inspectorId: "mechanic-1",
    inspectorName: "余成生",
    inspectorTeamId: "t1",
    sourceVersion: 1,
    naturalLanguageResult: "前刹车片剩余约两毫米，建议更换；右前轮有异响，建议进一步拆检。",
  });
  expect(Object.isFrozen(submission)).toBe(true);
  expect(Object.isFrozen(submission.suggestedLaborItems)).toBe(true);
  expect(Object.isFrozen(submission.suggestedLaborItems[0])).toBe(true);
  expect(Object.isFrozen(submission.photos)).toBe(true);

  expect(() => {
    (submission as unknown as { inspectorTeamId: string }).inspectorTeamId = "t2";
  }).toThrow(TypeError);
  expect(() => {
    (submission.suggestedLaborItems[0] as unknown as { quotedJmd: number }).quotedJmd = 1;
  }).toThrow(TypeError);
});

test("AI 草稿从原始提交派生来源版本且无法覆盖或伪造原文署名价格", () => {
  const submission = inspectionSubmission();
  const forgedDraftInput = {
    id: "ai-draft-forged",
    generatedAt: "2026-08-09T09:16:00-05:00",
    conclusion: "前制动系统需要维修。",
    items: [{
      id: "draft-item-1",
      title: "更换前刹车片",
      sourceFactRefs: ["naturalLanguageResult"],
    }],
    customerExplanationZh: "建议更换前刹车片。",
    customerExplanationEn: "Replace the front brake pads.",
    naturalLanguageResult: "AI 伪造原文",
    inspectorName: "AI Inspector",
    inspectorTeamId: "t2",
    quotedJmd: 1,
    sourceSubmissionVersion: 99,
  } as Parameters<typeof createInspectionAiDraft>[1] & Record<string, unknown>;

  const draft = createInspectionAiDraft(submission, forgedDraftInput);

  expect(draft).toMatchObject({
    inspectionReportNo: "KGN-WH-IR-2026080919422",
    sourceSubmissionId: "inspection-submission-1",
    sourceSubmissionVersion: 1,
    conclusion: "前制动系统需要维修。",
  });
  expect(draft).not.toHaveProperty("naturalLanguageResult");
  expect(draft).not.toHaveProperty("inspectorName");
  expect(draft).not.toHaveProperty("inspectorTeamId");
  expect(draft).not.toHaveProperty("quotedJmd");
  expect(submission.inspectorName).toBe("余成生");
  expect(submission.naturalLanguageResult).toContain("两毫米");
});

test("AI 草稿拒绝引用原始提交中不存在或越界的检查事实", () => {
  for (const sourceFactRefs of [
    ["suggestedLaborItems:labor-missing"],
    ["inspectorName"],
  ]) {
    expect(() => createInspectionAiDraft(inspectionSubmission(), {
      id: `ai-draft-invalid-${sourceFactRefs[0]}`,
      generatedAt: "2026-08-09T09:16:00-05:00",
      conclusion: "前制动系统需要维修。",
      items: [{
        id: "draft-item-invalid",
        title: "更换前刹车片",
        sourceFactRefs,
      }],
      customerExplanationZh: "建议更换前刹车片。",
    })).toThrow(/(?:不存在|越界|无效)/);
  }
});

test("AI 草稿的同一项目不得重复引用同一原始检查事实", () => {
  expect(() => createInspectionAiDraft(inspectionSubmission(), {
    id: "ai-draft-duplicate-reference",
    generatedAt: "2026-08-09T09:16:00-05:00",
    conclusion: "前制动系统需要维修。",
    items: [{
      id: "draft-item-duplicate-reference",
      title: "更换前刹车片",
      sourceFactRefs: ["naturalLanguageResult", "naturalLanguageResult"],
    }],
    customerExplanationZh: "建议更换前刹车片。",
  })).toThrow(/不得重复/);
});

test("同一 IR 单据依次发布 V1、V2、V3 且旧版本保留", () => {
  const submission = inspectionSubmission();
  const draft = aiDraft();
  let document = createInspectionQuoteDocument({
    id: "inspection-quote-1",
    sourceSubmission: submission,
    stage: "inspection_awaiting_frontdesk",
  });

  for (const [index, laborQuotedJmd] of [8_000, 8_500, 9_000].entries()) {
    document = publishInspectionQuoteVersion(document, {
      id: `quote-version-${index + 1}`,
      sourceSubmission: submission,
      sourceAiDraft: draft,
      publishedAt: `2026-08-09T10:0${index}:00-05:00`,
      publishedBy: { id: "frontdesk-1", name: "前台 A" },
      items: [{
        id: "quote-item-1",
        description: "更换前刹车片",
        laborQuotedJmd,
        partsQuotedJmd: 12_500,
        customerDecision: index === 2 ? "accepted" : "pending",
        sourceFactRefs: ["suggestedLaborItems:labor-1", "suggestedPartItems:part-1"],
      }],
    });
  }

  expect(document.inspectionReportNo).toBe("KGN-WH-IR-2026080919422");
  expect(document.versions.map((version) => ({
    reportNo: version.inspectionReportNo,
    version: version.version,
    label: version.versionLabel,
    laborQuotedJmd: version.items[0].laborQuotedJmd,
  }))).toEqual([
    { reportNo: "KGN-WH-IR-2026080919422", version: 1, label: "V1", laborQuotedJmd: 8_000 },
    { reportNo: "KGN-WH-IR-2026080919422", version: 2, label: "V2", laborQuotedJmd: 8_500 },
    { reportNo: "KGN-WH-IR-2026080919422", version: 3, label: "V3", laborQuotedJmd: 9_000 },
  ]);
  expect(Object.isFrozen(document.versions)).toBe(true);
  expect(Object.isFrozen(document.versions[0].items)).toBe(true);
});

test("repair 默认继承署名班组，正式交单前改组追加完整审计且不改写检查署名", () => {
  const submission = inspectionSubmission();
  const repair = createRepairAssignmentFromInspection(submission, {
    id: "assignment-1",
    documentId: "business-order-1",
    vehiclePool: "ordinary",
    assignedAt: "2026-08-09T11:00:00-05:00",
  });

  expect(repair).toMatchObject({
    kind: "repair",
    teamId: "t1",
    firstAssignedTeamId: "t1",
    firstAssignedAt: "2026-08-09T11:00:00-05:00",
    sourceInspection: {
      submissionId: "inspection-submission-1",
      inspectorTeamId: "t1",
    },
    reassignmentHistory: [],
  });

  const reassigned = reassignOrderAssignment(repair, {
    newTeamId: "t2",
    reason: "二组已完成紧急项目，现场调整维修负载",
    actor: { id: "frontdesk-1", name: "前台 A" },
    changedAt: "2026-08-09T12:00:00-05:00",
  });

  expect(reassigned.teamId).toBe("t2");
  expect(reassigned.firstAssignedTeamId).toBe("t1");
  expect(reassigned.sourceInspection.inspectorTeamId).toBe("t1");
  expect(reassigned.reassignmentHistory).toEqual([{
    fromTeamId: "t1",
    toTeamId: "t2",
    reason: "二组已完成紧急项目，现场调整维修负载",
    actor: { id: "frontdesk-1", name: "前台 A" },
    changedAt: "2026-08-09T12:00:00-05:00",
  }]);
  expect(submission.inspectorTeamId).toBe("t1");
});

test("前台正式交单 submittedAt 后拒绝普通改组", () => {
  const repair = createRepairAssignmentFromInspection(inspectionSubmission(), {
    id: "assignment-1",
    documentId: "business-order-1",
    vehiclePool: "ordinary",
    assignedAt: "2026-08-09T11:00:00-05:00",
    submittedAt: "2026-08-09T15:00:00-05:00",
  });

  expect(() => reassignOrderAssignment(repair, {
    newTeamId: "t2",
    reason: "普通改组",
    actor: { id: "frontdesk-1", name: "前台 A" },
    changedAt: "2026-08-09T15:01:00-05:00",
  })).toThrow(/正式交单后.*改组/);
});

test("只转换 accepted 项目并保存 IR 版本来源，同一来源行不得重复转换", () => {
  const submission = inspectionSubmission();
  const draft = aiDraft();
  let document = createInspectionQuoteDocument({
    id: "inspection-quote-conversion",
    sourceSubmission: submission,
    stage: "inspection_awaiting_frontdesk",
  });
  document = publishInspectionQuoteVersion(document, {
    id: "quote-version-conversion",
    sourceSubmission: submission,
    sourceAiDraft: draft,
    publishedAt: "2026-08-09T10:00:00-05:00",
    publishedBy: { id: "frontdesk-1", name: "前台 A" },
    items: [
      {
        id: "accepted-item",
        description: "更换前刹车片",
        laborQuotedJmd: 8_000,
        partsQuotedJmd: 12_500,
        customerDecision: "accepted",
        sourceFactRefs: ["suggestedLaborItems:labor-1"],
      },
      {
        id: "rejected-item",
        description: "更换轮毂",
        laborQuotedJmd: 2_000,
        partsQuotedJmd: 20_000,
        customerDecision: "rejected",
        sourceFactRefs: ["naturalLanguageResult"],
      },
      {
        id: "pending-item",
        description: "进一步拆检右前轮",
        laborQuotedJmd: 3_000,
        partsQuotedJmd: 0,
        customerDecision: "pending",
        sourceFactRefs: ["naturalLanguageResult"],
      },
    ],
  });

  const conversion = createBusinessOrderConversion(document, {
    id: "conversion-1",
    businessOrderId: "business-order-1",
    sourceVersion: 1,
    sourceItemIds: ["accepted-item"],
    convertedAt: "2026-08-09T11:00:00-05:00",
    convertedBy: { id: "frontdesk-1", name: "前台 A" },
    existingConversions: [],
  });

  expect(conversion).toMatchObject({
    businessOrderId: "business-order-1",
    sourceInspectionReportNo: "KGN-WH-IR-2026080919422",
    sourceVersion: 1,
    sourceItemIds: ["accepted-item"],
  });

  for (const sourceItemIds of [["rejected-item"], ["pending-item"]]) {
    expect(() => createBusinessOrderConversion(document, {
      id: `conversion-${sourceItemIds[0]}`,
      businessOrderId: "business-order-2",
      sourceVersion: 1,
      sourceItemIds,
      convertedAt: "2026-08-09T11:05:00-05:00",
      convertedBy: { id: "frontdesk-1", name: "前台 A" },
      existingConversions: [],
    })).toThrow(/只有客户已采用/);
  }

  expect(() => createBusinessOrderConversion(document, {
    id: "conversion-duplicate",
    businessOrderId: "business-order-3",
    sourceVersion: 1,
    sourceItemIds: ["accepted-item"],
    convertedAt: "2026-08-09T11:10:00-05:00",
    convertedBy: { id: "frontdesk-1", name: "前台 A" },
    existingConversions: [conversion],
  })).toThrow(/已经转换/);
});
