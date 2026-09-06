// @vitest-environment node
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import path from "node:path";
import { getDocument, GlobalWorkerOptions } from "../../../apps/web/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import type { BusinessOrderDocumentRenderSnapshot } from "@formal/db/schema/business-order-document";
import {
  BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION,
  englishBusinessDocumentName,
  renderBusinessOrderDocumentPdf,
} from "@formal/modules/business-order/business-order-document-pdf";
import { buildBusinessOrderDocumentContent } from "@formal/modules/business-order/business-order-document-content";

GlobalWorkerOptions.workerSrc = new URL("../../../apps/web/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href;

async function pdfText(bytes: Uint8Array) {
  const task = getDocument({ data: bytes, useSystemFonts: false });
  const pdf = await task.promise;
  try {
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const content = await (await pdf.getPage(index)).getTextContent();
      pages.push(content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" "));
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

const snapshot: BusinessOrderDocumentRenderSnapshot = {
  version: 1,
  kind: "mechanic_work",
  businessOrder: { id: 1, orderNo: "KGN-WH-2026082500001" },
  vehicle: { plate: "4321 AB", description: "Nissan X-Trail", vin: "JN1BJ0RR9HM123456" },
  repairRound: { id: 1, roundNo: 1, teamName: "车间一组" },
  workItems: [{ kind: "labor", nameZh: "发动机诊断工时", descriptionZh: "读取故障码并检查发动机运行数据", unitLabelZh: "工时", quantity: "2.000" }],
  notes: [{ kind: "work_instruction", contentZh: "完成诊断后联系客户" }],
};

const customerSnapshot: BusinessOrderDocumentRenderSnapshot = {
  version: 1,
  kind: "customer_copy",
  businessOrder: {
    id: 1, orderNo: "KGN-WH-2026082500001", plate: "4321 AB",
    vehicleDescription: "Nissan X-Trail", vin: "JN1BJ0RR9HM123456",
    payerName: "David Blake", payerPhone: "+18765550102", payerTrn: null,
    payerContactName: null,
  },
  charges: {
    versionNo: 1,
    totals: {
      grossMinor: 10_000_00, lineDiscountMinor: 0, laborDiscountMinor: 0,
      partDiscountMinor: 0, otherDiscountMinor: 0, categoryDiscountMinor: 0,
      wholeOrderDiscountMinor: 0, totalDueMinor: 10_000_00, includedGctMinor: 130_435,
    },
    items: [{
      kind: "labor", nameZh: "发动机诊断", nameEn: "Engine diagnosis",
      descriptionZh: "读取故障码", descriptionEn: "Read fault codes",
      unitLabelZh: "工时", unitLabelEn: "Hour", quantity: "1.000",
      unitPriceMinor: 10_000_00, itemDiscountMinor: 0, subtotalMinor: 10_000_00,
    }],
    notes: [{ kind: "customer_concern", contentZh: "发动机灯亮", contentEn: "Engine warning light is on." }],
  },
  transactions: [],
  totals: { currentDueMinor: 10_000_00, totalPaidMinor: 0, totalRefundedMinor: 0, balanceMinor: 10_000_00 },
  approval: { statementZh: "客户确认。", statementEn: "The customer confirms this statement." },
};

describe("renderBusinessOrderDocumentPdf", () => {
  it.each((["zh", "en", "mechanic"] as const).flatMap((language) => [6, 90].map((lineCount) => ({ language, lineCount }))))("preserves all identity grid lines for $language with $lineCount lines", async ({ language, lineCount }) => {
    // Truncating to two lines, or expanding without moving the following row,
    // loses identity or overlays the vehicle/round metadata.
    const lines = Array.from({ length: lineCount }, (_, index) => `IDENT${String(index).padStart(3, "0")} Name`);
    const fixture = language === "mechanic" ? structuredClone(snapshot) : structuredClone(customerSnapshot);
    if (fixture.kind === "mechanic_work") fixture.vehicle.description = lines.join("\n");
    else fixture.businessOrder.payerName = lines.join("\n");
    const task = getDocument({ data: await renderBusinessOrderDocumentPdf({ documentNo: "QA-IDENTITY-0001", revisionNo: 1, snapshot: fixture, language: language === "en" ? "en" : "zh", fieldOverrides: {} }), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      const texts: string[] = [];
      for (let index = 1; index <= pdf.numPages; index++) {
        const items = (await (await pdf.getPage(index)).getTextContent()).items.filter((item) => "str" in item && item.str.trim());
        texts.push(items.map((item) => item.str).join(" "));
        const identity = items.filter((item) => /IDENT\d{3}/u.test(item.str));
        for (const item of identity) expect(item.transform[5], `page ${index}: ${item.str}`).toBeGreaterThanOrEqual(42);
        const nextRow = items.find((item) => item.str === (language === "mechanic" ? "维修轮次 / REPAIR ROUND" : language === "en" ? "VEHICLE" : "车辆"));
        if (identity.length && nextRow) expect(Math.min(...identity.map((item) => item.transform[5])) - nextRow.transform[5]).toBeGreaterThan(8);
      }
      const copies = language === "mechanic" ? 1 : 2;
      const text = texts.join(" ");
      for (let index = 0; index < lineCount; index++) expect(text.match(new RegExp(`IDENT${String(index).padStart(3, "0")}`, "g")), `missing identity line ${index}`).toHaveLength(copies);
      if (lineCount === 6) expect(pdf.numPages).toBe(copies);
      else expect(pdf.numPages).toBeGreaterThan(copies);
      if (copies === 2) {
        expect(pdf.numPages % 2).toBe(0);
        const normalize = (text: string) => text.replace(/OFFICE COPY|CUSTOMER COPY|办公室联|客户联/g, "COPY").replace(/\d+ \/ \d+/g, "PAGE");
        for (let index = 0; index < pdf.numPages / 2; index++) expect(normalize(texts[index])).toBe(normalize(texts[index + pdf.numPages / 2]));
      }
      expect(text).toContain(language === "en" ? "CUSTOMER SIGNATURE" : language === "mechanic" ? "维修人员签字 / TECHNICIAN" : "客户签字");
    } finally { await task.destroy(); }
  });
  it("keeps Chinese closing punctuation with the preceding text in narrow description cells", async () => {
    const chinese = structuredClone(customerSnapshot);
    chinese.charges.items[0].descriptionZh = "检查001：核对发动机运行数据。";
    const task = getDocument({ data: await renderBusinessOrderDocumentPdf({ documentNo: "QA-WRAP-0001", revisionNo: 1, snapshot: chinese, language: "zh", fieldOverrides: {} }), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      const items = (await (await pdf.getPage(1)).getTextContent()).items.filter((item) => "str" in item && item.str.trim());
      expect(items.some((item) => /^[。，；：！？、）】》]/u.test(item.str))).toBe(false);
      expect(items.map((item) => item.str).join("")).toContain("检查001：核对发动机运行数据。");
    } finally { await task.destroy(); }
  });
  it.each((["description", "note", "approval", "problem"] as const).flatMap((field) => (["zh", "en"] as const).map((language) => ({ field, language }))))("paginates an oversized $field in $language without losing text or either copy", async ({ field, language }) => {
    const lines = Array.from({ length: 90 }, (_, index) => `MARK${String(index).padStart(3, "0")} Inspection detail`);
    const longText = lines.join("\n");
    let longSnapshot = structuredClone(customerSnapshot);
    if (field === "description") { longSnapshot.charges.items[0].descriptionEn = longText; longSnapshot.charges.items[0].descriptionZh = longText; }
    if (field === "note") { longSnapshot.charges.notes[0].contentEn = longText; longSnapshot.charges.notes[0].contentZh = longText; }
    if (field === "approval") { longSnapshot.approval.statementEn = longText; longSnapshot.approval.statementZh = longText; }
    if (field === "problem") longSnapshot = { ...longSnapshot, version: 2, problemDescription: { original: { contentZh: longText, contentEn: longText, confirmedAt: null }, repairRound: null } };
    const task = getDocument({ data: await renderBusinessOrderDocumentPdf({ documentNo: "QA-LONG-0001", revisionNo: 1, snapshot: longSnapshot, language, fieldOverrides: {} }), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      const texts: string[] = [];
      for (let index = 1; index <= pdf.numPages; index++) {
        const items = (await (await pdf.getPage(index)).getTextContent()).items.filter((item) => "str" in item);
        texts.push(items.map((item) => item.str).join(" "));
        for (const item of items.filter((item) => item.str.includes("MARK"))) {
          expect(item.transform[5], `page ${index}: ${item.str}`).toBeGreaterThanOrEqual(42);
        }
      }
      const whole = texts.join(" ");
      for (let index = 0; index < 90; index++) expect(whole.match(new RegExp(`MARK${String(index).padStart(3, "0")}`, "g")), `missing line ${index}`).toHaveLength(2);
      expect(pdf.numPages % 2).toBe(0);
      const half = pdf.numPages / 2;
      expect(half).toBeGreaterThan(1);
      const normalized = (text: string) => text.replace(/OFFICE COPY|CUSTOMER COPY|办公室联|客户联/g, "COPY").replace(/\d+ \/ \d+/g, "PAGE");
      for (let index = 0; index < half; index++) {
        expect(texts[index]).toContain(language === "en" ? "OFFICE COPY" : "办公室联");
        expect(texts[index + half]).toContain(language === "en" ? "CUSTOMER COPY" : "客户联");
        expect(normalized(texts[index])).toBe(normalized(texts[index + half]));
      }
      expect(texts[half - 1]).toContain(language === "en" ? "CUSTOMER SIGNATURE" : "客户签字");
      expect(texts.at(-1)).toContain(language === "en" ? "CUSTOMER SIGNATURE" : "客户签字");
    } finally { await task.destroy(); }
  });
  it.each(["zh", "en"] as const)("distinguishes pending prices from free items across both %s copies", async (language) => {
    const pending: BusinessOrderDocumentRenderSnapshot = {
      ...customerSnapshot,
      charges: { ...customerSnapshot.charges, items: [
        ...customerSnapshot.charges.items,
        { ...customerSnapshot.charges.items[0], kind: "part", nameZh: "清洗剂", nameEn: "Cleaning agent", unitLabelZh: "瓶", unitLabelEn: "Bottle", pendingQuote: true, unitPriceMinor: 0, subtotalMinor: 0 },
        { ...customerSnapshot.charges.items[0], nameZh: "复查", nameEn: "Follow-up check", pendingQuote: false, unitPriceMinor: 0, subtotalMinor: 0 },
      ] },
    };
    const fields = buildBusinessOrderDocumentContent(pending).fields;
    expect(fields.find((field) => field.key === "charges.items.1.unitPrice")?.value).toBe("待报价");
    expect(fields.find((field) => field.key === "charges.items.1.subtotal")?.value).toBe("—");
    expect(fields.find((field) => field.key === "charges.items.2.unitPrice")?.value).toBe("JMD 0.00");
    const bytes = await renderBusinessOrderDocumentPdf({ documentNo: "QA-PENDING-0001", revisionNo: 1, snapshot: pending, language, fieldOverrides: {} });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    const text = await pdfText(bytes);
    expect(text).toContain(language === "zh" ? "待报价" : "Pending quote");
    expect(text.match(language === "zh" ? /已报价金额（含税）/g : /QUOTED CHARGES \(TAX INCLUSIVE\)/g)).toHaveLength(2);
    expect(text).toContain(language === "zh" ? "1 项待报价" : "1 item pending quote");
    expect(text).toContain("JMD 10,000.00");
    expect(text).toContain("JMD 0.00");
    expect(text).not.toContain("TOTAL AGREED CHARGES");
    if (language === "en") expect(text).not.toMatch(/[\u3400-\u9fff]/u);
  });
  it.each(["zh", "en"] as const)("prints labor as JOB in %s without changing parts units or amounts", async (language) => {
    const mixed = { ...customerSnapshot, charges: { ...customerSnapshot.charges, items: [...customerSnapshot.charges.items, { ...customerSnapshot.charges.items[0], kind: "part" as const, nameZh: "配件", nameEn: "Part", unitLabelZh: "件", unitLabelEn: "Piece" }] } };
    const text = await pdfText(await renderBusinessOrderDocumentPdf({ documentNo: "CUS-20260905-0001", revisionNo: 7, snapshot: mixed, language, fieldOverrides: {} }));
    expect(text.match(/\bJOB\b/g)).toHaveLength(2);
    expect(text).not.toMatch(/\bHour\b/);
    expect(text).toContain(language === "zh" ? "件" : "Piece");
    expect(text).toContain("JMD 10,000.00");
  });
  it("prints mechanic labor quantities in JOB", async () => {
    const text = await pdfText(await renderBusinessOrderDocumentPdf({ documentNo: "MEC-20260905-0001", revisionNo: 5, snapshot, fieldOverrides: {} }));
    expect(text).toMatch(/\bJOB\b/);
  });
  it.each(["zh", "en"] as const)("generates office and customer copies together in one %s print file", async (language) => {
    const bytes = await renderBusinessOrderDocumentPdf({ documentNo: "CUS-20260905-0001", revisionNo: 6, snapshot: customerSnapshot, language, fieldOverrides: {} });
    const task = getDocument({ data: bytes, useSystemFonts: false });
    const pdf = await task.promise;
    try {
      expect(pdf.numPages).toBe(2);
      const texts: string[] = [];
      for (let index = 1; index <= 2; index++) {
        const content = await (await pdf.getPage(index)).getTextContent();
        texts.push(content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" "));
      }
      expect(texts[0]).toContain(language === "zh" ? "办公室联" : "OFFICE COPY");
      expect(texts[1]).toContain(language === "zh" ? "客户联" : "CUSTOMER COPY");
      const normalize = (text: string) => text.replace(/办公室联|客户联|OFFICE COPY|CUSTOMER COPY/g, "COPY").replace(/[12] \/ 2/g, "PAGE");
      expect(normalize(texts[0])).toBe(normalize(texts[1]));
      if (language === "en") expect(texts.join(" ")).not.toMatch(/[\u3400-\u9fff]/u);
      else expect(texts.join(" ")).not.toMatch(/CUSTOMER COPY|OFFICE COPY|Engine diagnosis/);
    } finally { await task.destroy(); }
  });
  it("gives the document title its own row and uses a distinct display face for the total", async () => {
    const bytes = await renderBusinessOrderDocumentPdf({ documentNo: "CUS-20260905-0001", revisionNo: 5, snapshot: customerSnapshot, language: "en", fieldOverrides: {} });
    const task = getDocument({ data: bytes, useSystemFonts: false });
    const pdf = await task.promise;
    try {
      const content = await (await pdf.getPage(1)).getTextContent();
      const items = content.items.filter((item) => "str" in item);
      const title = items.find((item) => item.str === "SERVICE AUTHORIZATION")!;
      const brand = items.find((item) => item.str === "Whole Hearted Car Service Limited")!;
      const total = items.find((item) => item.str === "JMD 10,000.00" && item.transform[0] >= 20)!;
      const body = items.find((item) => item.str === "Engine diagnosis")!;
      expect(title.transform[0]).toBeGreaterThanOrEqual(20);
      expect(brand.transform[5] - title.transform[5]).toBeGreaterThanOrEqual(35);
      expect(total).toBeDefined();
      expect(total.fontName).not.toBe(body.fontName);
    } finally { await task.destroy(); }
  });
  it.each(["customer_copy", "office_archive"] as const)("separates Chinese and English content throughout the %s", async (kind) => {
    const separated: BusinessOrderDocumentRenderSnapshot = {
      ...customerSnapshot, kind, version: 2,
      businessOrder: { ...customerSnapshot.businessOrder, payerName: "戴维·布莱克 / David Blake" },
      problemDescription: {
        original: { contentZh: "发动机异响", contentEn: "Engine noise", confirmedAt: "2026-09-05T00:00:00Z" },
        repairRound: { repairRoundId: 1, roundNo: 1, versionId: 2, versionNo: 1, contentZh: "本轮先诊断", contentEn: "Diagnose first" },
      },
    };
    const zh = await pdfText(await renderBusinessOrderDocumentPdf({ documentNo: "QA-20260905-0001", revisionNo: 4, snapshot: separated, language: "zh", fieldOverrides: {} }));
    const en = await pdfText(await renderBusinessOrderDocumentPdf({ documentNo: "QA-20260905-0001", revisionNo: 4, snapshot: separated, language: "en", fieldOverrides: {} }));
    for (const phrase of ["发动机异响", "本轮先诊断", "发动机诊断", "读取故障码", "发动机灯亮", "客户确认。", "戴维·布莱克"]) {
      expect(zh).toContain(phrase);
      expect(en).not.toContain(phrase);
    }
    for (const phrase of ["Engine noise", "Diagnose first", "Engine diagnosis", "Read fault codes", "Engine warning light is on.", "The customer confirms this statement.", "David Blake"]) {
      expect(en).toContain(phrase);
      expect(zh).not.toContain(phrase);
    }
    expect(zh).not.toMatch(/CUSTOMER COPY|OFFICE COPY|LABOR CHARGES|PARTS CHARGES|NOT A TAX INVOICE|PAYER|CONTACT|DESCRIPTION|GROSS|DISCOUNT|TOTAL|SIGNATURE/);
  });
  it.each(["zh", "en"] as const)("gives the final agreed amount a larger visual hierarchy in %s", async (language) => {
    const task = getDocument({ data: await renderBusinessOrderDocumentPdf({
      documentNo: "QA-20260905-0001", revisionNo: 3, snapshot: customerSnapshot, language, fieldOverrides: {},
    }), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      const content = await (await pdf.getPage(1)).getTextContent();
      const amounts = content.items.flatMap((item) => "str" in item && item.str === "JMD 10,000.00" ? [item] : []);
      expect(Math.max(...amounts.map((item) => Math.abs(item.transform[0])))).toBeGreaterThanOrEqual(16);
    } finally { await task.destroy(); }
  });
  it.each(["zh", "en"] as const)("keeps currency and amount on one line within table cells in %s", async (language) => {
    const bytes = await renderBusinessOrderDocumentPdf({
      documentNo: "QA-20260905-0001", revisionNo: 3, language, fieldOverrides: {},
      snapshot: { ...customerSnapshot, charges: { ...customerSnapshot.charges, items: [
        { ...customerSnapshot.charges.items[0], unitPriceMinor: 123456789, itemDiscountMinor: 150000, subtotalMinor: 123306789 },
      ] } },
    });
    const task = getDocument({ data: bytes, useSystemFonts: false });
    try {
      const pdf = await task.promise;
      const content = await (await pdf.getPage(1)).getTextContent();
      const items = content.items.flatMap((item) => "str" in item ? [item] : []);
      for (const amount of ["JMD 1,234,567.89", "JMD 1,500.00", "JMD 1,233,067.89"]) {
        const printed = items.find((item) => item.str === amount);
        expect(printed, `${amount} must be a single printed line`).toBeDefined();
        expect(printed!.width).toBeLessThanOrEqual(62.1);
        expect(printed!.transform[4] + printed!.width).toBeLessThanOrEqual(565.3);
      }
    } finally { await task.destroy(); }
  });
  it.each(["zh", "en"] as const)("uses printed subtotal overrides in category totals in %s", async (language) => {
    const text = await pdfText(await renderBusinessOrderDocumentPdf({
      documentNo: "QA-20260905-0001", revisionNo: 2, snapshot: customerSnapshot, language,
      fieldOverrides: { "charges.items.0.subtotal": "JMD 9,000.00", "totals.currentDue": "JMD 9,000.00" },
    }));
    const label = language === "en" ? "LABOR TOTAL (TAX INCLUSIVE)" : "工时合计（含税）";
    expect(text.slice(text.indexOf(label), text.indexOf(label) + 100)).toContain("JMD 9,000.00");
  });
  it("does not invent a category total for a non-numeric printed subtotal", async () => {
    const text = await pdfText(await renderBusinessOrderDocumentPdf({
      documentNo: "QA-20260905-0001", revisionNo: 2, snapshot: customerSnapshot, language: "en",
      fieldOverrides: { "charges.items.0.subtotal": "Pending confirmation" },
    }));
    const footer = text.slice(text.indexOf("LABOR TOTAL (TAX INCLUSIVE)"), text.indexOf("GROSS"));
    expect(footer).toContain("REVIEW LINE SUBTOTALS");
    expect(footer).not.toContain("10,000.00");
  });
  it.each(["zh", "en"] as const)("separates labor and parts with category totals and unpadded quantities in %s", async (language) => {
    const labor = customerSnapshot.charges.items[0];
    const mixed = {
      ...customerSnapshot,
      charges: {
        ...customerSnapshot.charges,
        totals: { ...customerSnapshot.charges.totals, laborDiscountMinor: 50000, partDiscountMinor: 25000 },
        items: [
          { ...labor, kind: "part" as const, nameZh: "滤清器", nameEn: "Oil filter", quantity: "1.000", subtotalMinor: 500000 },
          { ...labor, nameZh: "诊断", nameEn: "Engine diagnosis", quantity: "2.000", subtotalMinor: 1900000 },
          { ...labor, nameZh: "轮胎更换", nameEn: "Tire replacement", quantity: "3.000", subtotalMinor: 600000 },
        ],
      },
    };
    const text = await pdfText(await renderBusinessOrderDocumentPdf({ documentNo: "QA-20260905-0001", revisionNo: 1, snapshot: mixed, fieldOverrides: {}, language }));
    const partName = language === "en" ? "Oil filter" : "滤清器";
    expect(text.indexOf(language === "en" ? "Engine diagnosis" : "诊断")).toBeLessThan(text.indexOf(partName));
    expect(text.indexOf(language === "en" ? "Tire replacement" : "轮胎更换")).toBeLessThan(text.indexOf(partName));
    const firstCategory = text.slice(0, text.indexOf(partName));
    expect(firstCategory).toContain("24,500.00");
    expect(text.slice(text.indexOf(partName))).toContain("4,750.00");
    expect(text).not.toMatch(/\b[123]\.000\b/);
    expect(text).toContain(language === "en" ? "UNIT" : "单位");
  });
  it("groups mechanic work separately from parts and removes padded decimal quantities", async () => {
    const text = await pdfText(await renderBusinessOrderDocumentPdf({
      documentNo: "MEC-20260905-0001", revisionNo: 1, fieldOverrides: {},
      snapshot: { ...snapshot, workItems: [
        { ...snapshot.workItems[0], kind: "part", nameZh: "机油滤清器", quantity: "1.000" },
        { ...snapshot.workItems[0], nameZh: "发动机诊断工时", quantity: "2.000" },
      ] },
    }));
    expect(text.indexOf("发动机诊断工时")).toBeLessThan(text.indexOf("机油滤清器"));
    expect(text).not.toMatch(/\b[12]\.000\b/);
    expect(text).toContain("工时项目");
    expect(text).toContain("配件项目");
  });
  it.each([
    { performanceMinor: -50000, amount: "JMD -500.00" },
    { performanceMinor: 0, amount: "JMD 0.00" },
    { performanceMinor: null, amount: "待填写" },
  ])("prints the current order/round performance $amount on the mechanic copy", async ({ performanceMinor, amount }) => {
    const text = await pdfText(await renderBusinessOrderDocumentPdf({
      documentNo: "MEC-20260905-0001", revisionNo: 1, fieldOverrides: {},
      snapshot: { ...snapshot, repairRound: { id: 3, roundNo: 3, teamName: "车间一组", performanceMinor, performanceSource: performanceMinor == null ? "unrecorded" : "handoff" } },
    }));
    expect(text).toContain("本单本轮绩效");
    expect(text).toContain("KGN-WH-2026082500001");
    expect(text).toContain("第 3 轮维修");
    expect(text).toContain(amount);
    expect(text).not.toMatch(/TOTAL PAID|BALANCE|收费项目|含税单价/);
  });
  it("renders the same PDF from the repository and Next app working directories", async () => {
    const input = { documentNo: "QA-20260905-0001", revisionNo: 1, snapshot: customerSnapshot, fieldOverrides: {} };
    const fromRepository = await renderBusinessOrderDocumentPdf(input);
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(path.join(process.cwd(), "apps/web"));
    try {
      const fromApp = await renderBusinessOrderDocumentPdf(input);
      expect(Buffer.from(fromApp).equals(Buffer.from(fromRepository))).toBe(true);
    } finally {
      cwd.mockRestore();
    }
  });
  it.each(["zh", "en"] as const)("prints identical fee/responsibility content in both %s copies, explicitly not a tax invoice", async (language) => {
    const texts: string[] = [];
    for (const kind of ["customer_copy", "office_archive"] as const) {
      const bytes = await renderBusinessOrderDocumentPdf({
        documentNo: "QA-20260905-0001", revisionNo: 1, language, fieldOverrides: {},
        snapshot: {
          ...customerSnapshot, kind,
          totals: { currentDueMinor: 10_000_00, totalPaidMinor: 246_80, totalRefundedMinor: 123_45, balanceMinor: 9876_65 },
          transactions: [{ type: "payment", referenceNo: "RCT-PAYMENT-ONLY", amountMinor: 246_80, methodCode: "cash", methodLabelZh: "现金", methodLabelEn: "Cash", occurredAt: "2026-09-05T12:00:00Z", note: "RECEIPT-ONLY-NOTE" }],
        },
      });
      const text = await pdfText(bytes);
      expect(text).toContain(language === "zh" ? "非税务发票" : "NOT A TAX INVOICE");
      expect(text).toContain(language === "zh" ? "发动机诊断" : "Engine diagnosis");
      expect(text).toContain("10,000.00");
      expect(text).not.toMatch(/RCT-PAYMENT-ONLY|RECEIPT-ONLY-NOTE|246\.80|123\.45|9,876\.65|TOTAL PAID|TOTAL REFUNDED|BALANCE|收付款记录|累计收款|累计退款|未结余额/);
      texts.push(...text.split("\n").map((page) => page.replace(/客户联|办公室联|CUSTOMER COPY|OFFICE COPY/g, "COPY").replace(/\d+ \/ \d+$/, "PAGE")));
    }
    expect(texts).toHaveLength(3);
    expect(new Set(texts).size).toBe(1);
  });
  it("keeps fee and responsibility copies focused on agreed charges, not receipt facts", () => {
    const keys = buildBusinessOrderDocumentContent(customerSnapshot).fields.map((field) => field.key);
    expect(keys).not.toContain("totals.totalPaid");
    expect(keys).not.toContain("totals.totalRefunded");
    expect(keys).not.toContain("totals.balance");
    expect(keys).toContain("totals.currentDue");
    expect(keys).toContain("approval.statementZh");
  });
  it("keeps version-one snapshots readable and exposes version-two frozen problem fields once", () => {
    expect(buildBusinessOrderDocumentContent(customerSnapshot).fields.some((field) => field.key.startsWith("problemDescription."))).toBe(false);
    const versionTwo = {
      ...customerSnapshot,
      version: 2 as const,
      problemDescription: {
        original: { contentZh: "发动机异响", contentEn: "Engine noise", confirmedAt: "2026-08-24T13:00:00.000Z" },
        repairRound: { repairRoundId: 1, roundNo: 1, versionId: 2, versionNo: 1, contentZh: "本轮先诊断", contentEn: "Diagnose first" },
      },
    } satisfies BusinessOrderDocumentRenderSnapshot;
    const fields = buildBusinessOrderDocumentContent(versionTwo).fields;
    expect(fields.filter((field) => field.key === "problemDescription.originalZh")).toHaveLength(1);
    expect(fields.find((field) => field.key === "problemDescription.roundZh")?.value).toBe("本轮先诊断");
  });

  it("creates the formal true-A4 document deterministically with versioned renderer metadata", async () => {
    const input = {
      documentNo: "MEC-20260828-0001",
      revisionNo: 2,
      snapshot,
      fieldOverrides: { "header.title": "维修施工确认单" },
    };
    const first = await renderBusinessOrderDocumentPdf(input);
    const second = await renderBusinessOrderDocumentPdf(input);
    expect(new TextDecoder().decode(first.slice(0, 5))).toBe("%PDF-");
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    const document = await PDFDocument.load(first);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
    const { width, height } = document.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
    expect(document.getTitle()).toContain("MEC-20260828-0001-R2");
    expect(document.getCreator()).toBe(BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION);
  });

  it("renders a separate pure-English customer artifact", async () => {
    const bytes = await renderBusinessOrderDocumentPdf({
      documentNo: "CUS-20260828-0001",
      revisionNo: 1,
      snapshot: customerSnapshot,
      fieldOverrides: {},
      language: "en",
    });
    const pdf = await PDFDocument.load(bytes);
    const language = pdf.catalog.get(PDFName.of("Lang"));
    expect(language).toBeInstanceOf(PDFString);
    expect((language as PDFString).decodeText()).toBe("en-JM");
    expect(pdf.getCreator()).toBe(BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION);
  });

  it("uses only the English segment of a bilingual payer name", () => {
    expect(englishBusinessDocumentName("戴维·布莱克 / David Blake")).toBe("David Blake");
    expect(englishBusinessDocumentName("David Blake")).toBe("David Blake");
    expect(englishBusinessDocumentName("戴维·布莱克")).toBeNull();
  });
});
