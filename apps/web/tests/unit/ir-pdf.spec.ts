import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { WHOLE_HEARTED_COMPANY_IDENTITY } from "../../src/lib/company-identity";
import {
  buildInspectionReportPdf,
  irPdfFileName,
  type IrPdfSource,
} from "../../src/lib/orders/ir-pdf";
import { MARGIN_BOTTOM, MARGIN_X, PAGE_H, PAGE_W } from "../../src/lib/orders/pdf-shared";
import { createPdfFontLoader } from "../../src/lib/orders/pdf-shared";

const fontBytes = readFileSync(join(process.cwd(), "public/fonts/NotoSansSC-Regular-wh.ttf"));
const PENDING_PARTS_ZH = "以上标记为“待报价”的配件暂未计入当前报价。客户可以自行准备符合车辆规格的配件，也可以另行联系 Whole Hearted Car Service Limited 配件部门，或向前台提出配件报价要求，由我司另行提供报价。申请报价时请提供本检查报告编号。";
const PENDING_PARTS_EN = "Parts marked “Pending quote” are not included in the current quotation total. The customer may supply suitable parts, contact the Whole Hearted Car Service Limited Parts Department separately, or ask the front desk to obtain a separate quotation from our company. Please provide this Inspection Report number when requesting a quotation.";

function withoutLayoutWhitespace(value: string): string {
  return value.replace(/\s+/gu, "");
}

const baseSource: IrPdfSource = {
  company: WHOLE_HEARTED_COMPANY_IDENTITY,
  reportNo: "KGN-WH-IR-2026080919422",
  quotationNo: "KGN-WH-QT-2026080919422",
  generation: { version: 7, generatedAt: "2026-08-21T10:15:30-05:00" },
  customer: { nameZh: "陈美玲", nameEn: "Meiling Chen", phone: "+1 876 555 0101" },
  vehicle: { plate: "8765 JZ", modelZh: "丰田海狮", modelEn: "Toyota Hiace", vin: "JT1234567890" },
  quotation: {
    noteZh: "有言在先：拆解后可能另行报价。",
    noteEn: "Customer advised: further work may require a separate quotation.",
    lines: [
      {
        id: "labor-1", category: "labor", pricingMode: "unit",
        descZh: "发动机拆解", descEn: "Engine teardown", remarkZh: "确认内部损伤", remarkEn: "Confirm internal damage",
        unit: "工时", unitEn: "labor hour", quantity: 2, unitPriceJmd: 100_000, unitDiscountJmd: 12_345, pendingQuote: false,
      },
      {
        id: "parts-1", category: "parts", pricingMode: "unit",
        descZh: "发动机修理包", descEn: "Engine repair kit", remarkZh: "原厂规格", remarkEn: "OEM specification",
        unit: "套", unitEn: "set", quantity: 2, unitPriceJmd: 35_000, unitDiscountJmd: 2_500, pendingQuote: false,
      },
      {
        id: "parts-pending", category: "parts", pricingMode: "unit",
        descZh: "内部损坏配件", descEn: "Internally damaged parts", remarkZh: "拆解后确认", remarkEn: "To be confirmed after teardown",
        unit: "件", unitEn: "pcs", quantity: 1, unitPriceJmd: 0, unitDiscountJmd: 0, pendingQuote: true,
      },
      {
        id: "other-1", category: "other_service", pricingMode: "fixed_total", code: "towing",
        descZh: "拖车费", descEn: "Towing", remarkZh: "市区拖车", remarkEn: "Kingston towing", amountJmd: 7_500,
      },
    ],
  },
};

interface PdfTextItemEvidence {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PdfPathEvidence {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface PdfPageEvidence {
  readonly text: string;
  readonly textItems: ReadonlyArray<PdfTextItemEvidence>;
  readonly paths: ReadonlyArray<PdfPathEvidence>;
}

async function pdfEvidence(bytes: Uint8Array): Promise<{
  pages: string[];
  pageEvidence: PdfPageEvidence[];
  mediaBoxes: Array<{ width: number; height: number }>;
}> {
  const document = await PDFDocument.load(bytes);
  const mediaBoxes = document.getPages().map((page) => page.getSize());
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  const pageEvidence: PdfPageEvidence[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const textItems = content.items.flatMap((item): PdfTextItemEvidence[] => {
      if (!("str" in item) || !("transform" in item) || !("width" in item) || !("height" in item)) return [];
      return [{
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
      }];
    });
    const text = textItems.map((item) => item.str).join(" ")
      .replace(/([\u3000-\u303f\u3400-\u9fff\uff00-\uffef]) (?=[\u3000-\u303f\u3400-\u9fff\uff00-\uffef])/g, "$1");
    const operators = await page.getOperatorList();
    const paths = operators.fnArray.flatMap((operator, index): PdfPathEvidence[] => {
      if (operator !== pdfjs.OPS.constructPath) return [];
      const bounds = operators.argsArray[index]?.[2];
      if (!bounds || typeof bounds !== "object" || !("length" in bounds) || bounds.length !== 4) return [];
      const values = Array.from(bounds as ArrayLike<number>);
      if (!values.every((value) => Number.isFinite(value))) return [];
      return [{ minX: values[0], minY: values[1], maxX: values[2], maxY: values[3] }];
    });
    pages.push(text);
    pageEvidence.push({ text, textItems, paths });
  }
  await loadingTask.destroy();
  return { pages, pageEvidence, mediaBoxes };
}

async function pagesAndText(bytes: Uint8Array): Promise<{ pages: string[]; mediaBoxes: Array<{ width: number; height: number }> }> {
  const { pages, mediaBoxes } = await pdfEvidence(bytes);
  return { pages, mediaBoxes };
}

test("one narrow saved source renders three distinct strict-A4 files with identical V, Jamaica time and shared totals", async () => {
  const results = await Promise.all((["zh", "en", "bilingual"] as const).map((language) => (
    buildInspectionReportPdf(baseSource, language, { fontBytes })
  )));
  for (const [index, result] of results.entries()) {
    expect(Buffer.from(result.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(result.fileName).toBe(irPdfFileName(baseSource.reportNo, (["zh", "en", "bilingual"] as const)[index]));
    const { pages, mediaBoxes } = await pagesAndText(result.bytes);
    expect(mediaBoxes.every(({ width, height }) => Math.abs(width - 595.28) < 0.02 && Math.abs(height - 841.89) < 0.02)).toBe(true);
    const text = pages.join("\n");
    expect(text).toContain("V7");
    expect(text).toContain("2026-08-21T10:15:30-05:00");
    expect(text).toContain("247,810");
    expect(text).not.toMatch(/247,810\.00/);
    expect(text).toContain("8765 JZ");
    expect(text).toContain("JT1234567890");
  }
  expect(Buffer.compare(Buffer.from(results[0].bytes), Buffer.from(results[1].bytes))).not.toBe(0);
  expect(Buffer.compare(Buffer.from(results[1].bytes), Buffer.from(results[2].bytes))).not.toBe(0);
});

test("labor, parts, pending part and fixed other charge follow the approved compact billing semantics", async () => {
  test.setTimeout(15_000);
  const zhText = (await pagesAndText((await buildInspectionReportPdf(baseSource, "zh", { fontBytes })).bytes)).pages.join("\n");
  expect(zhText).toContain("工时报价");
  expect(zhText).toContain("所需配件");
  expect(zhText).toContain("其他费用");
  expect(zhText).toContain("100,000");
  expect(zhText).toContain("12,345");
  expect(zhText).toContain("87,655");
  expect(zhText).toContain("24,690");
  expect(zhText).toContain("175,310");
  expect(zhText).toContain("待报价");
  expect(withoutLayoutWhitespace(zhText)).toContain(withoutLayoutWhitespace(PENDING_PARTS_ZH));
  expect(zhText).toContain("工时与配件优惠已逐项列示；退款按实际 Invoice 中对应项目的折后单价及实际可退数量计算。其他费用没有折扣，适用退款时按 Invoice 所列最终一口价处理。");
  const otherText = zhText.slice(zhText.indexOf("其他费用"));
  expect(otherText).toContain("拖车费");
  expect(otherText).toContain("市区拖车");
  expect(otherText).toContain("7,500");
  expect(otherText).not.toContain("Code: towing");

  const enText = (await pagesAndText((await buildInspectionReportPdf(baseSource, "en", { fontBytes })).bytes)).pages.join("\n");
  expect(withoutLayoutWhitespace(enText)).toContain(withoutLayoutWhitespace(PENDING_PARTS_EN));
  expect(withoutLayoutWhitespace(enText)).not.toContain(withoutLayoutWhitespace(PENDING_PARTS_ZH));
  expect(enText).not.toContain("Code: towing");
  const bilingualText = (await pagesAndText((await buildInspectionReportPdf(baseSource, "bilingual", { fontBytes })).bytes)).pages.join("\n");
  expect(withoutLayoutWhitespace(bilingualText)).toContain(withoutLayoutWhitespace(PENDING_PARTS_ZH));
  expect(withoutLayoutWhitespace(bilingualText)).toContain(withoutLayoutWhitespace(PENDING_PARTS_EN));
  expect(bilingualText).not.toContain("Code: towing");

  const withoutOther: IrPdfSource = { ...baseSource, quotation: { ...baseSource.quotation, lines: baseSource.quotation.lines.filter((line) => line.pricingMode !== "fixed_total") } };
  const withoutOtherText = (await pagesAndText((await buildInspectionReportPdf(withoutOther, "en", { fontBytes })).bytes)).pages.join("\n");
  expect(withoutOtherText).not.toContain("OTHER CHARGES");

  const blankOtherRemark: IrPdfSource = {
    ...baseSource,
    quotation: {
      ...baseSource.quotation,
      lines: baseSource.quotation.lines.map((line) => (
        line.pricingMode === "fixed_total" ? { ...line, remarkZh: "", remarkEn: "" } : line
      )),
    },
  };
  for (const language of ["zh", "en", "bilingual"] as const) {
    const text = (await pagesAndText((await buildInspectionReportPdf(blankOtherRemark, language, { fontBytes })).bytes)).pages.join("\n");
    const otherStart = Math.max(text.indexOf("其他费用"), text.indexOf("OTHER CHARGES"));
    expect(text.slice(otherStart)).not.toContain("Translation pending");
  }
});

test("labor and parts use the approved six columns and auditable price-detail equation", async () => {
  const zeroDiscountLine = {
    id: "labor-zero-discount", category: "labor" as const, pricingMode: "unit" as const,
    descZh: "零优惠检查", descEn: "Zero-discount inspection", remarkZh: "逐项核对", remarkEn: "Item check",
    unit: "项", unitEn: "item", quantity: 3, unitPriceJmd: 1_500, unitDiscountJmd: 0, pendingQuote: false,
  };
  const source: IrPdfSource = {
    ...baseSource,
    quotation: { ...baseSource.quotation, lines: [...baseSource.quotation.lines, zeroDiscountLine] },
  };
  const text = (await pagesAndText((await buildInspectionReportPdf(source, "zh", { fontBytes })).bytes)).pages.join("\n");
  for (const heading of ["项目名称", "项目备注", "单位", "数量", "价格明细", "折后小计"]) {
    expect(text).toContain(heading);
  }
  expect(text).not.toContain("行优惠");
  expect(withoutLayoutWhitespace(text)).toContain(withoutLayoutWhitespace("每单位优惠 12,345 × 2 = 24,690"));
  expect(withoutLayoutWhitespace(text)).toContain(withoutLayoutWhitespace("每单位优惠 —"));
  expect(text).toContain("报价合计（不含待报价配件）");
});

test("bilingual brand header keeps the legal name and document title in non-overlapping boxes", async () => {
  const { pageEvidence } = await pdfEvidence((await buildInspectionReportPdf(baseSource, "bilingual", { fontBytes })).bytes);
  const firstPage = pageEvidence[0];
  const company = firstPage.textItems.find((item) => item.str === WHOLE_HEARTED_COMPANY_IDENTITY.legalName);
  const title = firstPage.textItems.find((item) => item.str.includes("INSPECTION REPORT / QUOTATION") && item.str.includes("检查报告"));
  expect(company, "company name text item").toBeDefined();
  expect(title, "bilingual document title text item").toBeDefined();
  const overlapX = Math.min(company!.x + company!.width, title!.x + title!.width) - Math.max(company!.x, title!.x);
  const overlapY = Math.min(company!.y + company!.height, title!.y + title!.height) - Math.max(company!.y, title!.y);
  expect(overlapX > 0 && overlapY > 0).toBe(false);
});

test("renderer excludes every internal sentinel and fails closed on parking_projection", async () => {
  const poisoned = {
    ...baseSource,
    rawText: "RAW-INTAKE-SENTINEL",
    aiDraft: "AI-DRAFT-SENTINEL",
    status: "STATUS-SENTINEL",
    mechanic: "MECHANIC-SENTINEL",
    team: "TEAM-SENTINEL",
    photoIds: ["PHOTO-ID-SENTINEL"],
    mutationReceipts: ["MUTATION-SENTINEL"],
    rawStrokes: ["STROKE-SENTINEL"],
    businessOrderControl: "BO-CONTROL-SENTINEL",
  } as unknown as IrPdfSource;
  const text = (await pagesAndText((await buildInspectionReportPdf(poisoned, "bilingual", { fontBytes })).bytes)).pages.join("\n");
  for (const sentinel of ["RAW-INTAKE", "AI-DRAFT", "STATUS", "MECHANIC", "TEAM", "PHOTO-ID", "MUTATION", "STROKE", "BO-CONTROL"]) {
    expect(text).not.toContain(`${sentinel}-SENTINEL`);
  }

  const parking = {
    ...baseSource,
    quotation: {
      ...baseSource.quotation,
      lines: [...baseSource.quotation.lines, {
        id: "parking", category: "other_service", pricingMode: "parking_projection", code: "parking_overtime",
        descZh: "停车费", descEn: "Parking", remarkZh: "", remarkEn: "", parkingCaseId: "park-1",
        sourceRevision: 1, asOf: "2026-08-21T10:00:00-05:00", amountJmd: 2_500,
      }],
    },
  } as unknown as IrPdfSource;
  await expect(buildInspectionReportPdf(parking, "zh", { fontBytes })).rejects.toThrow(/parking_projection|停车/iu);

  const pendingLabor = {
    ...baseSource,
    quotation: {
      ...baseSource.quotation,
      lines: baseSource.quotation.lines.map((line) => (
        line.id === "labor-1" ? { ...line, pendingQuote: true } : line
      )),
    },
  } as IrPdfSource;
  await expect(buildInspectionReportPdf(pendingLabor, "zh", { fontBytes })).rejects.toThrow(/pending|labor|待报价|工时/iu);
});

test("missing English is marked as pending without invented translation", async () => {
  const source: IrPdfSource = {
    ...baseSource,
    quotation: {
      ...baseSource.quotation,
      lines: [{
        id: "missing-en", category: "labor", pricingMode: "unit", descZh: "中文专用项目", descEn: "",
        remarkZh: "中文备注", remarkEn: "", unit: "工时", unitEn: "", quantity: 1,
        unitPriceJmd: 1_000, unitDiscountJmd: 0, pendingQuote: false,
      }],
    },
  };
  const text = (await pagesAndText((await buildInspectionReportPdf(source, "en", { fontBytes })).bytes)).pages.join("\n");
  expect(text).toContain("中文专用项目");
  expect(text).toContain("Translation pending");
});

test("bilingual output keeps legitimate identical title, remark and vehicle model once without a pending marker", async () => {
  const source: IrPdfSource = {
    ...baseSource,
    vehicle: { ...baseSource.vehicle, modelZh: "ABS-MODEL", modelEn: "ABS-MODEL" },
    quotation: {
      ...baseSource.quotation,
      lines: [{
        id: "same-language-copy", category: "labor", pricingMode: "unit",
        descZh: "ABS-TITLE", descEn: "ABS-TITLE", remarkZh: "ABS-REMARK", remarkEn: "ABS-REMARK",
        unit: "item", unitEn: "item", quantity: 1, unitPriceJmd: 1_000,
        unitDiscountJmd: 0, pendingQuote: false,
      }],
    },
  };
  const text = (await pagesAndText((await buildInspectionReportPdf(source, "bilingual", { fontBytes })).bytes)).pages.join("\n");
  for (const copy of ["ABS-MODEL", "ABS-TITLE", "ABS-REMARK"]) {
    expect(text.match(new RegExp(copy, "g")) ?? []).toHaveLength(1);
  }
  expect(text).not.toContain("Translation pending");
});

test("long files keep the only customer signature/date block together and geometrically inside the final page", async () => {
  const longSource: IrPdfSource = {
    ...baseSource,
    quotation: {
      ...baseSource.quotation,
      lines: Array.from({ length: 42 }, (_, index) => ({
        id: `labor-${index}`, category: "labor" as const, pricingMode: "unit" as const,
        descZh: `第 ${index + 1} 项发动机检查与维修工作`, descEn: `Engine inspection and repair item ${index + 1}`,
        remarkZh: "逐项核对并记录处理结果", remarkEn: "Verify and record the result",
        unit: "工时", unitEn: "hour", quantity: 1, unitPriceJmd: 1_000, unitDiscountJmd: 0, pendingQuote: false,
      })),
    },
  };
  const { pages, pageEvidence } = await pdfEvidence((await buildInspectionReportPdf(longSource, "bilingual", { fontBytes })).bytes);
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.slice(0, -1).join("\n")).not.toContain("客户签名");
  expect(pages.slice(0, -1).join("\n")).not.toContain("Customer signature");
  expect(pages.at(-1)).toContain("客户签名");
  expect(pages.at(-1)).toContain("Customer signature");
  expect(pages.at(-1)).toContain("日期");
  expect(pages.at(-1)).toContain("Date");
  expect((pages.join("\n").match(/Customer signature/g) ?? [])).toHaveLength(1);
  const finalPage = pageEvidence.at(-1)!;
  const signatureLabel = finalPage.textItems.find((item) => item.str.includes("Customer signature"));
  const dateLabel = finalPage.textItems.find((item) => item.str.includes("Date"));
  expect(signatureLabel).toBeDefined();
  expect(dateLabel).toBeDefined();
  const signatureLines = finalPage.paths.filter((path) => (
    path.maxX - path.minX > 60
      && path.maxY - path.minY < 1
      && path.minY > signatureLabel!.y + 5
      && path.minY < signatureLabel!.y + 25
  ));
  expect(signatureLines).toHaveLength(2);
  expect(Math.abs(signatureLines[0].minY - signatureLines[1].minY)).toBeLessThan(0.2);
  for (const line of signatureLines) {
    expect(line.minX).toBeGreaterThanOrEqual(MARGIN_X - 0.2);
    expect(line.maxX).toBeLessThanOrEqual(PAGE_W - MARGIN_X + 0.2);
    expect(line.minY).toBeGreaterThan(dateLabel!.y + 5);
    expect(line.minY).toBeGreaterThan(MARGIN_BOTTOM + 12);
    expect(line.maxY).toBeLessThan(PAGE_H);
  }
});

test("an oversized single quotation row is safely segmented without text or paths leaving A4", async () => {
  test.setTimeout(15_000);
  const hugeSource: IrPdfSource = {
    ...baseSource,
    quotation: {
      ...baseSource.quotation,
      noteZh: `超长总备注${"不能超出页面".repeat(220)}`,
      noteEn: `Long overall note ${"UNBROKEN-TOKEN".repeat(220)}`,
      lines: [{
        id: "oversized", category: "labor", pricingMode: "unit",
        descZh: `超长项目${"发动机检查".repeat(260)}`,
        descEn: `Oversized ${"UNBROKEN-DESCRIPTION".repeat(180)}`,
        remarkZh: `超长备注${"逐项核对".repeat(320)}`,
        remarkEn: `Oversized remark ${"UNBROKEN-REMARK".repeat(240)}`,
        unit: "工时", unitEn: "labor hour", quantity: 2,
        unitPriceJmd: 5_000, unitDiscountJmd: 0, pendingQuote: false,
      }],
    },
  };
  const { pageEvidence, mediaBoxes } = await pdfEvidence((await buildInspectionReportPdf(hugeSource, "bilingual", { fontBytes })).bytes);
  expect(pageEvidence.length).toBeGreaterThan(2);
  for (const [index, page] of pageEvidence.entries()) {
    const { width, height } = mediaBoxes[index];
    for (const item of page.textItems) {
      expect(item.x, `page ${index + 1} text left: ${item.str.slice(0, 24)}`).toBeGreaterThanOrEqual(-0.2);
      expect(item.x + item.width, `page ${index + 1} text right: ${item.str.slice(0, 24)}`).toBeLessThanOrEqual(width + 0.2);
      expect(item.y, `page ${index + 1} text bottom: ${item.str.slice(0, 24)}`).toBeGreaterThanOrEqual(-0.2);
      expect(item.y + item.height, `page ${index + 1} text top: ${item.str.slice(0, 24)}`).toBeLessThanOrEqual(height + 0.2);
    }
    for (const path of page.paths) {
      expect(path.minX).toBeGreaterThanOrEqual(-0.2);
      expect(path.maxX).toBeLessThanOrEqual(width + 0.2);
      expect(path.minY).toBeGreaterThanOrEqual(-0.2);
      expect(path.maxY).toBeLessThanOrEqual(height + 0.2);
    }
  }
});

test("font loading retries after a transient fetch failure instead of caching rejection", async () => {
  let attempts = 0;
  const loadPdfFont = createPdfFontLoader(async () => {
    attempts += 1;
    if (attempts === 1) return new Response("temporary", { status: 503 });
    return new Response(fontBytes, { status: 200 });
  });
  await expect(loadPdfFont()).rejects.toThrow(/503/);
  await expect(loadPdfFont()).resolves.toEqual(new Uint8Array(fontBytes));
  expect(attempts).toBe(2);
});
