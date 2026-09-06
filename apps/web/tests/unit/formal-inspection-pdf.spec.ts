import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { inspectionDetailFixture } from "../fixtures/inspection-detail";
import { buildFormalInspectionDocument } from "../../src/lib/orders/formal-inspection-document";
import { renderFormalInspectionPdf } from "../../src/lib/orders/formal-inspection-pdf";

const assets = { fontBytes: readFileSync("public/fonts/NotoSansSC-Regular-wh.ttf"), logoBytes: readFileSync("public/logo-icon.png") };
for (const ending of ["。", "。》", "？！", "。”"]) test(`keeps closing punctuation ${ending} with preceding text at a full-width line boundary`, async () => {
  const model = buildFormalInspectionDocument(inspectionDetailFixture, "zh");
  model.notes = "中".repeat(58) + ending;
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: await renderFormalInspectionPdf(model, assets) });
  try {
    const pdf = await task.promise;
    let all = "";
    for (let index = 1; index <= pdf.numPages; index++) {
      const items = (await (await pdf.getPage(index)).getTextContent()).items.flatMap(item => "str" in item && item.str.trim() ? [item] : []);
      for (const item of items) {
        expect(item.str, `page ${index} starts with closing punctuation`).not.toMatch(/^[。，；：！？、）】》”]/u);
        all += item.str;
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(560);
      }
    }
    expect(all).toContain("中".repeat(58) + ending);
  } finally { await task.destroy(); }
});

for (const language of ["zh", "en", "bilingual"] as const) test(`long ${language} responsibilities retain every line and finish with a signature`, async () => {
  const model = buildFormalInspectionDocument(inspectionDetailFixture, language);
  model.notes = Array.from({ length: 90 }, (_, index) => `NOTE${String(index).padStart(3, "0")} ${language === "en" ? "Further repairs require customer confirmation." : "进一步维修需客户确认。"}`).join("\n");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: await renderFormalInspectionPdf(model, assets) });
  try {
    const pdf = await task.promise;
    let all = "", last = "";
    expect(pdf.numPages).toBeGreaterThan(1);
    for (let index = 1; index <= pdf.numPages; index++) {
      const items = (await (await pdf.getPage(index)).getTextContent()).items.flatMap(item => "str" in item && item.str.trim() ? [item] : []);
      last = items.map(item => item.str).join(""); all += last;
      for (const item of items.filter(item => item.str.includes("NOTE"))) {
        expect(item.transform[5]).toBeGreaterThanOrEqual(42);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(560);
      }
    }
    for (let index = 0; index < 90; index++) expect(all.match(new RegExp(`NOTE${String(index).padStart(3, "0")}`, "g"))).toHaveLength(1);
    expect(last).toContain("NOTE089");
    expect(last).toContain(language === "en" ? "Customer acknowledgement" : "客户确认");
  } finally { await task.destroy(); }
});

for (const language of ["zh", "en", "bilingual"] as const) test(`long ${language} item descriptions retain their identity on every continuation page`, async () => {
  const source = structuredClone(inspectionDetailFixture);
  source.workspace.organized = { summaryZh: "检查完成。", summaryEn: "Inspection complete.", specialCaseNotesZh: null, findings: [] };
  source.workspace.quotation = { status: "entered", noteZh: null, noteEn: null, lines: [
    { kind: "labor", nameZh: "制动检查", nameEn: "Brake inspection", descriptionZh: "检查制动管路。".repeat(400) + "描述结束", descriptionEn: "Inspect brake hoses. ".repeat(400) + "DESCRIPTION_COMPLETE", quantity: "1", unitPriceMinor: 123456, subtotalMinor: 123456 },
  ] };
  const bytes = await renderFormalInspectionPdf(buildFormalInspectionDocument(source, language), assets);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  let descriptionPages = 0, pricedRows = 0, all = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    const text = content.items.flatMap(item => "str" in item ? [item.str] : []).join("");
    all += text;
    if (text.includes(language === "en" ? "Inspect brake" : "检查制动")) {
      descriptionPages++;
      expect(text).toContain(language === "en" ? "Brake inspection" : "制动检查");
    }
    pricedRows += content.items.filter(item => "str" in item && item.str === "JOB").length;
  }
  expect(descriptionPages).toBeGreaterThan(1);
  expect(pricedRows).toBe(1);
  if (language !== "en") expect(all).toContain("描述结束");
  if (language !== "zh") expect(all).toContain("DESCRIPTION_COMPLETE");
  await task.destroy();
});
test("a short bilingual report keeps the signature on its single page", async () => {
  const source = structuredClone(inspectionDetailFixture);
  source.workspace.organized = { summaryZh: "先清洗节气门，然后进行进一步检查。", summaryEn: "Clean the throttle body, then carry out further inspection.", specialCaseNotesZh: "进一步维修需客户确认。", specialCaseNotesEn: "Further repairs require customer confirmation.", findings: [] };
  source.workspace.quotation = { status: "entered", noteZh: "清洗剂价格待确认", noteEn: "Cleaning agent price pending", lines: [
    { kind: "labor", nameZh: "节气门清洗", nameEn: "Throttle body cleaning", descriptionZh: "清洗后进一步检查。描述末尾", descriptionEn: "Carry out further inspection after cleaning. DESCRIPTION_END", quantity: "1", unitPriceMinor: 1500000, subtotalMinor: 1500000 },
    { kind: "part", nameZh: "清洗剂", nameEn: "Cleaning agent", descriptionZh: "1瓶", descriptionEn: "One bottle", quantity: "1", unitPriceMinor: null, subtotalMinor: null },
  ] };
  const bytes = await renderFormalInspectionPdf(buildFormalInspectionDocument(source, "bilingual"), assets);
  const { PDFDocument } = await import("pdf-lib");
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
});
test("a closing signature page retains the quote total and responsibility note", async () => {
  const source = structuredClone(inspectionDetailFixture);
  source.workspace.organized = { summaryZh: "先清洗节气门，然后进行进一步检查。".repeat(100), summaryEn: null, specialCaseNotesZh: "进一步维修需客户确认。", findings: [] };
  source.workspace.quotation = { status: "entered", noteZh: "清洗剂价格待确认", noteEn: null, lines: [
    { kind: "labor", nameZh: "节气门清洗", nameEn: null, descriptionZh: "清洗后进一步检查。".repeat(220) + "描述末尾", descriptionEn: null, quantity: "1", unitPriceMinor: 1500000, subtotalMinor: 1500000 },
    { kind: "part", nameZh: "清洗剂", nameEn: null, descriptionZh: "1瓶", descriptionEn: null, quantity: "1", unitPriceMinor: null, subtotalMinor: null },
  ] };
  const bytes = await renderFormalInspectionPdf(buildFormalInspectionDocument(source, "zh"), assets);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const last = await (await pdf.getPage(pdf.numPages)).getTextContent();
  const text = last.items.flatMap(item => "str" in item ? [item.str] : []).join("");
  expect(text).toContain("客户确认");
  expect(text).toContain("折后报价");
  expect(text).toContain("进一步维修需客户确认。");
  await task.destroy();
});
for (const language of ["zh", "en", "bilingual"] as const) test(`formal PDF preserves long ${language} content across A4 pages`, async () => {
  const source = structuredClone(inspectionDetailFixture);
  source.workspace.organized.summaryZh = "检查车辆。".repeat(280) + "结论末尾";
  source.workspace.organized.summaryEn = "Inspect the vehicle carefully. ".repeat(160) + "CONCLUSION_END";
  source.workspace.quotation = { status: "entered", noteZh: null, noteEn: null, lines: [
    { kind: "labor", nameZh: "诊断工时", nameEn: "Diagnosis", descriptionZh: "检查细节。".repeat(450) + "描述末尾", descriptionEn: "Check carefully. ".repeat(400) + "DESCRIPTION_END", quantity: "2", unitPriceMinor: 5000, subtotalMinor: 10000 },
    { kind: "part", nameZh: "滤芯", nameEn: "Filter", descriptionZh: null, descriptionEn: null, quantity: "1", unitPriceMinor: null, subtotalMinor: null },
  ] };
  const bytes = await renderFormalInspectionPdf(buildFormalInspectionDocument(source, language), assets);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  expect(pdf.numPages).toBeGreaterThan(1);
  let all = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    expect(page.view[2]).toBeCloseTo(595.28, 1); expect(page.view[3]).toBeCloseTo(841.89, 1);
    const text = await page.getTextContent();
    for (const item of text.items) if ("str" in item && item.str.trim()) {
      all += item.str;
      expect(item.transform[4]).toBeGreaterThanOrEqual(30);
      expect(item.transform[4] + item.width).toBeLessThanOrEqual(567);
      expect(item.transform[5]).toBeGreaterThanOrEqual(20);
      expect(item.transform[5]).toBeLessThanOrEqual(815);
    }
  }
  if (language !== "en") { expect(all).toContain("结论末尾"); expect(all).toContain("描述末尾"); }
  if (language !== "zh") { expect(all).toContain("CONCLUSION_END"); expect(all).toContain("DESCRIPTION_END"); }
  expect(all).toContain("JOB"); expect(all).toContain(language === "en" ? "Price pending" : "报价待补");
  expect(all).toContain(language === "en" ? "Customer acknowledgement" : "客户确认");
  expect(all).not.toContain("Invoice");
  await task.destroy();
});
