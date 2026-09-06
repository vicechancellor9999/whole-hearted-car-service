import { expect, test } from "@playwright/test";
import { inspectionDetailFixture } from "../fixtures/inspection-detail";
import { buildFormalInspectionDocument } from "../../src/lib/orders/formal-inspection-document";

test("formal output keeps classification, unknown amounts, JOB and original quantity", () => {
  const source = structuredClone(inspectionDetailFixture);
  source.workspace.quotation = { status: "entered", noteZh: null, noteEn: null, lines: [
    { kind: "part", nameZh: "滤芯", nameEn: "Filter", descriptionZh: null, descriptionEn: null, quantity: "1", unitPriceMinor: null, subtotalMinor: null },
    { kind: "labor", nameZh: "诊断", nameEn: "Diagnosis", descriptionZh: "进一步检查", descriptionEn: "Further inspection", quantity: "2", unitPriceMinor: 5000, itemDiscountMinor: 1000, subtotalMinor: 9000 },
  ] };
  const snapshot = JSON.stringify(source);
  const doc = buildFormalInspectionDocument(source, "en");
  expect(doc.groups.map((group) => group.kind)).toEqual(["labor", "part"]);
  expect(doc.groups[0].rows[0]).toEqual(["Diagnosis", "Further inspection", "JOB", "2", "JMD 50.00", "-JMD 10.00", "JMD 90.00"]);
  expect(doc.groups[0].total).toBe("JMD 90.00");
  expect(doc.groups[1].total).toBe("Price pending");
  expect(doc.total).toBe("Price pending");
  expect(JSON.stringify(source)).toBe(snapshot);
});

test("language choices retain findings and limitations without invented translation", () => {
  const source = structuredClone(inspectionDetailFixture);
  source.workspace.organized = { summaryZh: "中文结论", summaryEn: "English conclusion", specialCaseNotesZh: "中文备注", specialCaseNotesEn: "English note", findings: [{ findingZh: "中文问题", findingEn: "English finding", recommendationZh: "中文建议", recommendationEn: null }] };
  const zh = JSON.stringify(buildFormalInspectionDocument(source, "zh"));
  const en = JSON.stringify(buildFormalInspectionDocument(source, "en"));
  const bi = JSON.stringify(buildFormalInspectionDocument(source, "bilingual"));
  expect(zh).toContain("中文问题"); expect(zh).not.toContain("English finding");
  expect(en).toContain("English finding"); expect(en).not.toContain("中文建议"); expect(en).toContain("English translation pending");
  expect(bi).toContain("中文备注"); expect(bi).toContain("English note");
});
