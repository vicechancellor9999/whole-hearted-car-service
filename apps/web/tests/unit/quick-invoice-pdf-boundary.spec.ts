import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import * as quickInvoicePdf from "../../src/lib/orders/quick-invoice-pdf";
import { POST } from "../../src/app/api/pdf/invoice/route";

const ROUTE_PATH = "src/app/api/pdf/invoice/route.ts";
const PDF_DOMAIN_PATH = "src/lib/orders/quick-invoice-pdf.ts";
const PDF_SECTION_PATH = "src/components/orders/quick-invoice-pdf-section.tsx";
const QUICK_PRINT_PATH = "src/components/orders/quick-order-print.tsx";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function validCanonicalStatement(): Record<string, unknown> {
  return {
    contract: "quick_order_financial_statement_v1",
    revision: 21,
    order: {
      id: "qbo-pdf-canonical",
      businessOrderNo: "KGN-WH-PDF-CANONICAL",
      customerId: "CUST-UAT-001",
      vehicleId: "VEH-UAT-001",
      status: "submitted",
      voidedAt: null,
      pickedUpAt: null,
      paidInFullAt: null,
    },
    source: {
      kind: "canonical_invoice",
      invoiceId: "invoice-pdf-canonical",
      invoiceNo: "INV-PDF-CANONICAL",
      effectiveVersionId: "invoice-pdf-canonical-version-2",
      versionNo: 2,
      snapshotCommitment: "sha256-utf16le:" + "b".repeat(64),
    },
    charges: {
      kind: "canonical_invoice",
      issuedAt: "2026-08-22T12:00:00-05:00",
      lines: [
        {
          pricingMode: "unit",
          chargeLineId: "pdf-labor-line",
          category: "labor",
          descZh: "安全检查工时",
          descEn: "Safety inspection labor",
          remarkZh: "检查制动系统",
          remarkEn: "Inspect braking system",
          unit: "项",
          unitEn: "item",
          quantity: 2,
          unitPriceJmd: 5_000,
          unitDiscountJmd: 0,
          finalUnitPriceJmd: 5_000,
          finalLineJmd: 10_000,
        },
        {
          pricingMode: "fixed_total",
          chargeLineId: "pdf-towing-line",
          category: "other_service",
          code: "towing",
          descZh: "拖车",
          descEn: "Towing",
          remarkZh: "固定一口价",
          remarkEn: "Fixed charge",
          amountJmd: 7_500,
        },
      ],
      totals: {
        laborGrossJmd: 10_000,
        laborDiscountJmd: 0,
        laborNetJmd: 10_000,
        partsGrossJmd: 0,
        partsDiscountJmd: 0,
        partsNetJmd: 0,
        otherFeeTotalJmd: 7_500,
        parkingTotalJmd: 0,
        totalDiscountJmd: 0,
        chargeSubtotalJmd: 17_500,
        adjustmentsJmd: 0,
        grandTotalJmd: 17_500,
      },
    },
    ledger: {
      invoiceTotalJmd: 17_500,
      receivableJmd: 12_500,
      grossPaidJmd: 4_000,
      cashRefundedJmd: 0,
      receivableReductionJmd: 5_000,
      netPaidJmd: 4_000,
      balanceJmd: 8_500,
      paymentStatus: "partially_paid",
      settlementStatus: "due",
      hasPaymentHistory: true,
    },
    entries: [
      {
        kind: "payment",
        provenance: "canonical_invoice",
        sequence: 1,
        paymentId: "pdf-payment-1",
        invoiceVersionId: "invoice-pdf-canonical-version-1",
        amountJmd: 4_000,
        occurredAt: "2026-08-22T12:10:00-05:00",
        method: "cash",
        actorName: "王建华",
        note: "客户付款",
      },
      {
        kind: "refund",
        accounting: "canonical_line_v1",
        sequence: 2,
        refundId: "pdf-refund-1",
        invoiceVersionId: "invoice-pdf-canonical-version-1",
        line: {
          pricingMode: "unit",
          chargeLineId: "pdf-labor-line",
          category: "labor",
          descZh: "安全检查工时",
          descEn: "Safety inspection labor",
          remarkZh: "检查制动系统",
          remarkEn: "Inspect braking system",
          unit: "项",
          unitEn: "item",
          quantity: 2,
          unitPriceJmd: 5_000,
          unitDiscountJmd: 0,
          finalUnitPriceJmd: 5_000,
          finalLineJmd: 10_000,
        },
        refundQuantity: 1,
        wholeLine: false,
        receivableReductionJmd: 5_000,
        cashRefundJmd: 0,
        occurredAt: "2026-08-22T12:20:00-05:00",
        method: "cash",
        actorName: "王建华",
        reason: "取消部分项目",
      },
    ],
  };
}

function validLegacyStatement(): Record<string, unknown> {
  return {
    contract: "quick_order_financial_statement_v1",
    revision: 21,
    order: {
      id: "qbo-pdf-legacy",
      businessOrderNo: "KGN-WH-PDF-LEGACY",
      customerId: "CUST-UAT-001",
      vehicleId: "VEH-UAT-001",
      status: "submitted",
      voidedAt: null,
      pickedUpAt: null,
      paidInFullAt: null,
    },
    source: { kind: "legacy_quick" },
    charges: {
      kind: "legacy_quick",
      discountModel: "legacy_category_discount",
      items: [{
        id: "pdf-legacy-labor",
        descZh: "旧版安全检查工时",
        descEn: "Legacy safety inspection labor",
        remarkZh: "兼容客户文件",
        remarkEn: "Compatibility customer file",
        category: "labor",
        unit: "项",
        unitEn: "item",
        unitPriceJmd: 10_000,
        quantity: 1,
        pendingQuote: false,
      }],
      totals: {
        laborGrossJmd: 10_000,
        partsGrossJmd: 0,
        laborDiscountJmd: 0,
        partsDiscountJmd: 0,
        totalDiscountJmd: 0,
        grandTotalJmd: 10_000,
      },
    },
    ledger: {
      invoiceTotalJmd: 10_000,
      receivableJmd: 10_000,
      grossPaidJmd: 4_000,
      cashRefundedJmd: 1_000,
      receivableReductionJmd: 0,
      netPaidJmd: 3_000,
      balanceJmd: 7_000,
      paymentStatus: "partially_paid",
      settlementStatus: "due",
      hasPaymentHistory: true,
    },
    entries: [
      {
        kind: "payment",
        provenance: "legacy_quick",
        sequence: 1,
        paymentId: "pdf-legacy-payment-1",
        invoiceVersionId: null,
        amountJmd: 4_000,
        occurredAt: "2026-08-22T12:10:00-05:00",
        method: "cash",
        actorName: "王建华",
        note: "旧版客户付款",
      },
      {
        kind: "refund",
        accounting: "legacy_cash_only",
        sequence: 2,
        refundId: "pdf-legacy-refund-1",
        invoiceVersionId: null,
        category: "labor",
        lineDescription: "Legacy safety inspection labor",
        receivableReductionJmd: null,
        cashRefundJmd: 1_000,
        occurredAt: "2026-08-22T12:20:00-05:00",
        method: "cash",
        actorName: "王建华",
        note: "旧版现金退款",
      },
    ],
  };
}

function validPdfSource(): Record<string, unknown> {
  return {
    contract: "quick_invoice_pdf_source_v1",
    statement: validCanonicalStatement(),
    customer: {
      id: "CUST-UAT-001",
      nameZh: "测试客户",
      nameEn: "Test Customer",
      organizationName: null,
      phone: "+1 876 555 0101",
    },
    vehicle: {
      id: "VEH-UAT-001",
      plate: "1234 AB",
      model: "Corolla",
      modelZh: "卡罗拉",
      vin: "JTDBR32E000000001",
    },
  };
}

function validLegacyPdfSource(): Record<string, unknown> {
  return {
    ...validPdfSource(),
    statement: validLegacyStatement(),
  };
}

function pdfAssertion(value: unknown): void {
  const assertion = Reflect.get(quickInvoicePdf, "assertQuickInvoicePdfSource");
  if (typeof assertion !== "function") throw new Error("assertQuickInvoicePdfSource is missing");
  Reflect.apply(assertion, quickInvoicePdf, [value]);
}

async function buildPdf(
  value: unknown,
  language: "zh" | "en" | "bilingual",
): Promise<Uint8Array> {
  const builder = Reflect.get(quickInvoicePdf, "buildQuickInvoicePdf");
  if (typeof builder !== "function") throw new Error("buildQuickInvoicePdf is missing");
  const fontBytes = new Uint8Array(readFileSync(resolve(
    process.cwd(),
    "public/fonts/NotoSansSC-Regular-wh.ttf",
  )));
  const logoBytes = new Uint8Array(readFileSync(resolve(process.cwd(), "public/logo-icon.png")));
  return Reflect.apply(builder, quickInvoicePdf, [value, {
    language,
    fontBytes,
    logoBytes,
  }]) as Promise<Uint8Array>;
}

type PdfGenerationCache = Readonly<{
  load(
    source: unknown,
    options: Readonly<{
      language: "zh" | "en" | "bilingual";
      fontBytes: Uint8Array;
      logoBytes: Uint8Array;
    }>,
  ): Promise<Uint8Array | null>;
  invalidate(): void;
}>;

function createPdfGenerationCache(
  builder: (source: unknown, options: unknown) => Promise<Uint8Array>,
): PdfGenerationCache {
  const factory = Reflect.get(quickInvoicePdf, "createQuickInvoicePdfGenerationCache");
  if (typeof factory !== "function") {
    throw new Error("createQuickInvoicePdfGenerationCache is missing");
  }
  return Reflect.apply(factory, quickInvoicePdf, [builder]) as PdfGenerationCache;
}

function pdfFileName(value: unknown, language: "zh" | "en" | "bilingual"): string {
  const fileName = Reflect.get(quickInvoicePdf, "quickInvoicePdfFileName");
  if (typeof fileName !== "function") throw new Error("quickInvoicePdfFileName is missing");
  return Reflect.apply(fileName, quickInvoicePdf, [value, language]) as string;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages.join("\n")
    .replace(/([\u3000-\u303f\u3400-\u9fff\uff00-\uffef]) (?=[\u3000-\u303f\u3400-\u9fff\uff00-\uffef])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

type PdfTextGeometry = Readonly<{
  text: string;
  x: number;
  y: number;
  width: number;
}>;

async function extractPdfTextGeometry(bytes: Uint8Array): Promise<ReadonlyArray<PdfTextGeometry>> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  const document = await loadingTask.promise;
  const items: PdfTextGeometry[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || item.str.length === 0) continue;
        items.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
        });
      }
    }
  } finally {
    await loadingTask.destroy();
  }
  return items;
}

function expectPdfTextNearby(
  text: string,
  copy: string,
  amount: string,
  label: string,
): void {
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(text, label).toMatch(new RegExp(
    `(?:${escape(copy)}[\\s\\S]{0,120}${escape(amount)}|${escape(amount)}[\\s\\S]{0,120}${escape(copy)})`,
  ));
}

test("QuickInvoicePdfSource is deeply closed and derives all money only from the validated statement", () => {
  const valid = validPdfSource();
  expect(() => pdfAssertion(structuredClone(valid))).not.toThrow();
  expect(Reflect.ownKeys(valid).sort()).toEqual(["contract", "customer", "statement", "vehicle"].sort());
  expect(Reflect.ownKeys(valid.customer as object).sort()).toEqual([
    "id", "nameZh", "nameEn", "organizationName", "phone",
  ].sort());
  expect(Reflect.ownKeys(valid.vehicle as object).sort()).toEqual([
    "id", "plate", "model", "modelZh", "vin",
  ].sort());

  const mutants: ReadonlyArray<Readonly<{
    name: string;
    mutate(value: Record<string, unknown>): void;
  }>> = [
    {
      name: "wrong source contract",
      mutate: (value) => { value.contract = "quick_invoice_pdf_source_v0"; },
    },
    {
      name: "missing customer",
      mutate: (value) => { Reflect.deleteProperty(value, "customer"); },
    },
    {
      name: "undefined vehicle",
      mutate: (value) => { value.vehicle = undefined; },
    },
    {
      name: "top arbitrary total",
      mutate: (value) => { value.invoiceTotalJmd = 999_999; },
    },
    {
      name: "top storage snapshot",
      mutate: (value) => { value.storage = { wh_session: "PRIVATE_SESSION_SENTINEL" }; },
    },
    {
      name: "statement internal receipt",
      mutate: (value) => {
        (value.statement as Record<string, unknown>).mutationReceipts = ["PRIVATE_RECEIPT_SENTINEL"];
      },
    },
    {
      name: "semantic ledger drift",
      mutate: (value) => {
        const statement = value.statement as Record<string, unknown>;
        (statement.ledger as Record<string, unknown>).balanceJmd = 999_999;
      },
    },
    {
      name: "statement snapshot commitment uses a noncanonical format",
      mutate: (value) => {
        const statement = value.statement as Record<string, unknown>;
        (statement.source as Record<string, unknown>).snapshotCommitment = `sha256:${"b".repeat(64)}`;
      },
    },
    {
      name: "customer extra KYC",
      mutate: (value) => {
        (value.customer as Record<string, unknown>).verificationArchive = "PRIVATE_KYC_SENTINEL";
      },
    },
    {
      name: "customer identity does not match statement",
      mutate: (value) => { (value.customer as Record<string, unknown>).id = "CUST-CROSS-OWNER"; },
    },
    {
      name: "vehicle identity does not match statement",
      mutate: (value) => { (value.vehicle as Record<string, unknown>).id = "VEH-CROSS-OWNER"; },
    },
    {
      name: "top hidden field",
      mutate: (value) => { Object.defineProperty(value, "hidden", { value: true }); },
    },
    {
      name: "top symbol field",
      mutate: (value) => { Object.defineProperty(value, Symbol("private"), { value: true, enumerable: true }); },
    },
    {
      name: "top custom prototype",
      mutate: (value) => { Object.setPrototypeOf(value, { inherited: true }); },
    },
    {
      name: "vehicle hidden field",
      mutate: (value) => { Object.defineProperty(value.vehicle, "hidden", { value: true }); },
    },
    {
      name: "customer symbol",
      mutate: (value) => {
        Object.defineProperty(value.customer, Symbol("private"), { value: true, enumerable: true });
      },
    },
    {
      name: "vehicle custom prototype",
      mutate: (value) => { Object.setPrototypeOf(value.vehicle as object, { inherited: true }); },
    },
  ];
  for (const mutant of mutants) {
    const value = structuredClone(valid);
    mutant.mutate(value);
    expect(() => pdfAssertion(value), mutant.name).toThrow();
  }

  let customerGetterCalls = 0;
  const accessor = structuredClone(valid);
  Object.defineProperty(accessor.customer, "nameZh", {
    configurable: true,
    enumerable: true,
    get() {
      customerGetterCalls += 1;
      throw new Error("CUSTOMER_GETTER_SENTINEL");
    },
  });
  expect(() => pdfAssertion(accessor)).toThrow();
  expect(customerGetterCalls).toBe(0);

  let topGetterCalls = 0;
  const topAccessor = structuredClone(valid);
  Object.defineProperty(topAccessor, "customer", {
    configurable: true,
    enumerable: true,
    get() {
      topGetterCalls += 1;
      throw new Error("PDF_SOURCE_GETTER_SENTINEL");
    },
  });
  expect(() => pdfAssertion(topAccessor)).toThrow();
  expect(topGetterCalls).toBe(0);

  let vehicleGetterCalls = 0;
  const vehicleAccessor = structuredClone(valid);
  Object.defineProperty(vehicleAccessor.vehicle, "plate", {
    configurable: true,
    enumerable: true,
    get() {
      vehicleGetterCalls += 1;
      throw new Error("VEHICLE_GETTER_SENTINEL");
    },
  });
  expect(() => pdfAssertion(vehicleAccessor)).toThrow();
  expect(vehicleGetterCalls).toBe(0);
});

test("client PDF builder emits canonical and legacy customer files but rejects provisional Invoice impersonation", async () => {
  const valid = validPdfSource();
  const languageHashes: string[] = [];
  const languageText = new Map<string, string>();
  for (const language of ["zh", "en", "bilingual"] as const) {
    const bytes = await buildPdf(structuredClone(valid), language);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder("ascii").decode(bytes.slice(0, 5))).toBe("%PDF-");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(0);
    for (const page of document.getPages()) {
      const { width, height } = page.getSize();
      expect(width).toBeCloseTo(595.28, 1);
      expect(height).toBeCloseTo(841.89, 1);
    }
    languageHashes.push(createHash("sha256").update(bytes).digest("hex"));
    const text = await extractPdfText(bytes);
    languageText.set(language, text);
    expect(text, `${language} Invoice identity`).toContain("INV-PDF-CANONICAL");
    expect(text, `${language} effective version`).toMatch(/V2|Version 2/);
    expect(text, `${language} immutable total`).toContain("17,500");
    expect(text, `${language} customer phone`).toContain("+1 876 555 0101");
    expect(text, `${language} vehicle plate`).toContain("1234 AB");
    expect(text, `${language} payment amount`).toContain("4,000");
    expect(text, `${language} receivable reduction`).toContain("5,000");
    expect(text, `${language} balance`).toContain("8,500");
    expect(text, `${language} canonical receipt deferral`).not.toMatch(
      /KGN-WH-RF-|退款单号|Refund Receipt No/i,
    );
    if (language !== "en") {
      expect(text, `${language} Chinese customer`).toContain("测试客户");
      expect(text, `${language} Chinese unit line`).toContain("安全检查工时");
      expect(text, `${language} Chinese fixed line`).toContain("拖车");
      expectPdfTextNearby(text, "安全检查工时", "10,000", `${language} Chinese unit line amount`);
      expectPdfTextNearby(text, "拖车", "7,500", `${language} Chinese fixed line amount`);
      expect(text, `${language} Chinese payment copy`).toMatch(/付款[\s\S]{0,80}4,000/);
      expect(text, `${language} Chinese reduction copy`).toMatch(/应收冲减[\s\S]{0,80}5,000/);
      expect(text, `${language} Chinese balance copy`).toMatch(/余额[\s\S]{0,80}8,500/);
    }
    if (language !== "zh") {
      expect(text, `${language} English customer`).toContain("Test Customer");
      expect(text, `${language} English unit line`).toContain("Safety inspection labor");
      expect(text, `${language} English fixed line`).toContain("Towing");
      expectPdfTextNearby(text, "Safety inspection labor", "10,000", `${language} English unit line amount`);
      expectPdfTextNearby(text, "Towing", "7,500", `${language} English fixed line amount`);
      expect(text, `${language} English payment copy`).toMatch(/Payment[\s\S]{0,80}4,000/i);
      expect(text, `${language} English reduction copy`).toMatch(/Receivable reduction[\s\S]{0,80}5,000/i);
      expect(text, `${language} English balance copy`).toMatch(/Balance[\s\S]{0,80}8,500/i);
    }
    if (language === "zh") {
      expect(text, "zh excludes English line copy").not.toMatch(/Safety inspection labor|\bTowing\b/);
    } else if (language === "en") {
      expect(text, "en excludes Chinese line copy").not.toMatch(/安全检查工时|拖车/);
    }
  }
  expect(new Set(languageHashes).size).toBe(3);
  expect(languageText.get("zh")).toContain("实际退还现金");
  expect(languageText.get("zh")).toContain("JMD 0");
  expect(languageText.get("zh")).toContain("未退还现金");
  expect(languageText.get("en")).toMatch(/Cash returned/i);
  expect(languageText.get("en")).toMatch(/No cash returned/i);
  expect(languageText.get("bilingual")).toContain("实际退还现金");
  expect(languageText.get("bilingual")).toMatch(/Cash returned/i);

  const changed = structuredClone(valid);
  const changedStatement = changed.statement as Record<string, unknown>;
  (changedStatement.source as Record<string, unknown>).invoiceNo = "INV-PDF-CANONICAL-CHANGED";
  const changedBytes = await buildPdf(changed, "zh");
  expect(createHash("sha256").update(changedBytes).digest("hex")).not.toBe(languageHashes[0]);
  expect(await extractPdfText(changedBytes)).toContain("INV-PDF-CANONICAL-CHANGED");

  const legacyBytes = await buildPdf(validLegacyPdfSource(), "bilingual");
  expect(new TextDecoder("ascii").decode(legacyBytes.slice(0, 5))).toBe("%PDF-");
  const legacyDocument = await PDFDocument.load(legacyBytes);
  expect(legacyDocument.getPageCount()).toBeGreaterThan(0);
  for (const page of legacyDocument.getPages()) {
    expect(page.getSize().width).toBeCloseTo(595.28, 1);
    expect(page.getSize().height).toBeCloseTo(841.89, 1);
  }
  const legacyText = await extractPdfText(legacyBytes);
  expect(legacyText).toContain("KGN-WH-PDF-LEGACY");
  expect(legacyText).toContain("10,000");
  expect(legacyText).toContain("4,000");
  expect(legacyText).toContain("1,000");
  expect(legacyText).toContain("实际退还现金");
  expect(legacyText).toMatch(/Cash returned/i);
  expectPdfTextNearby(legacyText, "旧版安全检查工时", "10,000", "legacy Chinese line amount");
  expectPdfTextNearby(legacyText, "Legacy safety inspection labor", "10,000", "legacy English line amount");
  expectPdfTextNearby(legacyText, "旧版客户付款", "4,000", "legacy payment entry amount");
  expectPdfTextNearby(legacyText, "旧版现金退款", "1,000", "legacy refund entry amount");

  for (const [label, field, wrongId] of [
    ["customer", "customer", "CUST-CROSS-OWNER"],
    ["vehicle", "vehicle", "VEH-CROSS-OWNER"],
  ] as const) {
    const wrongOwner = structuredClone(valid);
    ((wrongOwner as Record<string, unknown>)[field] as Record<string, unknown>).id = wrongId;
    expect(() => pdfAssertion(wrongOwner), `${label} assertion ownership`).toThrow();
    await expect(buildPdf(wrongOwner, "zh"), `${label} builder ownership`).rejects.toThrow();
  }

  const provisional = structuredClone(valid);
  const statement = provisional.statement as Record<string, unknown>;
  statement.source = { kind: "shared_uninvoiced" };
  statement.charges = {
    kind: "shared_uninvoiced",
    status: "provisional",
    lines: [],
    totals: {
      laborGrossJmd: 0,
      laborDiscountJmd: 0,
      laborNetJmd: 0,
      partsGrossJmd: 0,
      partsDiscountJmd: 0,
      partsNetJmd: 0,
      otherFeeTotalJmd: 0,
      parkingTotalJmd: 0,
      totalDiscountJmd: 0,
      pendingPartsCount: 0,
      chargeSubtotalJmd: 0,
      grandTotalJmd: 0,
    },
  };
  statement.ledger = {
    invoiceTotalJmd: null,
    receivableJmd: 0,
    grossPaidJmd: 0,
    cashRefundedJmd: 0,
    receivableReductionJmd: 0,
    netPaidJmd: 0,
    balanceJmd: 0,
    paymentStatus: "unpaid",
    settlementStatus: "settled",
    hasPaymentHistory: false,
  };
  statement.entries = [];
  await expect(buildPdf(provisional, "zh")).rejects.toThrow(/provisional|Invoice|未开票|暂记/i);
});

test("bilingual financial summary reserves a measurable gap between every label and amount", async () => {
  const items = await extractPdfTextGeometry(await buildPdf(validPdfSource(), "bilingual"));
  const rows = [
    { label: "账单金额 / Billed", amount: "JMD 17,500" },
    { label: "付款 / Payment", amount: "JMD 4,000" },
    { label: "应收冲减 / Receivable reduction", amount: "JMD 5,000" },
    { label: "实际退还现金 / Cash returned", amount: "JMD 0" },
    { label: "余额 / Balance", amount: "JMD 8,500" },
  ] as const;

  for (const row of rows) {
    const label = items.find((item) => item.text === row.label);
    expect(label, `${row.label} label geometry`).toBeDefined();
    const amount = items.find((item) => (
      item.text === row.amount
      && Math.abs(item.y - label!.y) < 0.01
    ));
    expect(amount, `${row.label} amount geometry`).toBeDefined();
    expect(
      amount!.x - (label!.x + label!.width),
      `${row.label} label-to-amount gap in PDF points`,
    ).toBeGreaterThanOrEqual(6);
  }
});

test("PDF generation cache reuses exact preview bytes and fences changed or unmounted sources", async () => {
  const calls: Array<Readonly<{ source: unknown; options: unknown }>> = [];
  const pending: Array<Readonly<{
    resolve(bytes: Uint8Array): void;
    reject(error: Error): void;
  }>> = [];
  const cache = createPdfGenerationCache((sourceValue, options) => {
    calls.push({ source: sourceValue, options });
    return new Promise<Uint8Array>((resolvePending, rejectPending) => pending.push({
      resolve: resolvePending,
      reject: rejectPending,
    }));
  });
  const assets = {
    language: "zh" as const,
    fontBytes: new Uint8Array([1, 2]),
    logoBytes: new Uint8Array([3, 4]),
  };
  const sourceA = validPdfSource();

  const preview = cache.load(sourceA, assets);
  const download = cache.load(structuredClone(sourceA), {
    ...assets,
    fontBytes: assets.fontBytes.slice(),
    logoBytes: assets.logoBytes.slice(),
  });
  await Promise.resolve();
  expect(calls).toHaveLength(1);
  const exactBytes = new Uint8Array([37, 80, 68, 70, 45, 65]);
  pending.shift()?.resolve(exactBytes);
  expect(await preview).toBe(exactBytes);
  expect(await download).toBe(exactBytes);
  const settledDownload = await cache.load(structuredClone(sourceA), {
    ...assets,
    fontBytes: assets.fontBytes.slice(),
    logoBytes: assets.logoBytes.slice(),
  });
  expect(calls).toHaveLength(1);
  expect(settledDownload).toBe(exactBytes);

  const crossOwner = structuredClone(sourceA);
  ((crossOwner as Record<string, unknown>).customer as Record<string, unknown>).id = "CUST-CROSS-OWNER";
  let toJSONCalls = 0;
  Object.defineProperty(crossOwner, "toJSON", {
    configurable: true,
    enumerable: false,
    value() {
      toJSONCalls += 1;
      return structuredClone(sourceA);
    },
  });
  await expect(
    cache.load(crossOwner, assets),
    "invalid cross-owner source must not alias an already-cached PDF through hidden toJSON",
  ).rejects.toThrow();
  expect(toJSONCalls, "cache validation must reject hidden toJSON without executing it").toBe(0);
  expect(calls, "invalid cache input must not reach the builder").toHaveLength(1);

  const sourceB = structuredClone(sourceA);
  const statementB = sourceB.statement as Record<string, unknown>;
  (statementB.source as Record<string, unknown>).invoiceNo = "INV-PDF-SOURCE-B";
  const staleSource = cache.load(sourceB, assets);
  const freshLanguage = cache.load(sourceB, { ...assets, language: "en" });
  await Promise.resolve();
  expect(calls).toHaveLength(3);
  pending.shift()?.reject(new Error("STALE_LANGUAGE_BUILD_SENTINEL"));
  expect(await staleSource).toBeNull();
  const englishBytes = new Uint8Array([2, 2, 2]);
  pending.shift()?.resolve(englishBytes);
  expect(await freshLanguage).toBe(englishBytes);

  const staleUnmount = cache.load(sourceA, assets);
  await Promise.resolve();
  expect(calls).toHaveLength(4);
  cache.invalidate();
  pending.shift()?.reject(new Error("STALE_UNMOUNT_BUILD_SENTINEL"));
  expect(await staleUnmount).toBeNull();

  const section = source(PDF_SECTION_PATH);
  expect(section).toMatch(/createQuickInvoicePdfGenerationCache/);
  expect(section).toMatch(/\.load\s*\(\s*source/);
  expect(section).not.toMatch(/buildQuickInvoicePdf\s*\(\s*source\s*,/);
  expect(section).toMatch(/const\s+preview[\s\S]{0,240}await\s+generate\s*\(\s*\)/);
  expect(section).toMatch(/const\s+download[\s\S]{0,240}await\s+generate\s*\(\s*\)/);
  expect(section).toMatch(/return\s*\(\s*\)\s*=>\s*\{?\s*\w+\.invalidate\s*\(/);
  expect(section).toMatch(/data-testid=["']quick-invoice-pdf-language["'][\s\S]{0,180}disabled=\{busy\}/);
  expect(section).toMatch(/if\s*\(\s*!bytes\s*\)\s*return[\s\S]{0,120}setPreviewBytes\s*\(\s*bytes\s*\)/);
  expect(section).toMatch(/if\s*\(\s*!bytes\s*\)\s*return[\s\S]{0,180}new\s+Blob\s*\(\s*\[\s*bytes/);
  expect(section).toMatch(/quickInvoicePdfFileName\s*\(\s*source\s*,\s*language\s*\)/);
  expect(section).not.toMatch(/quickInvoicePdfFileName\s*\(\s*statement\.order\.businessOrderNo/);
});

test("PDF renders exact branch totals, canonical credit, and source-aware customer filenames", async () => {
  const canonical = structuredClone(validPdfSource());
  const canonicalStatement = canonical.statement as Record<string, unknown>;
  const canonicalCharges = canonicalStatement.charges as Record<string, unknown>;
  const canonicalLines = canonicalCharges.lines as Array<Record<string, unknown>>;
  Object.assign(canonicalLines[0]!, {
    unitDiscountJmd: 500,
    finalUnitPriceJmd: 4_500,
    finalLineJmd: 9_000,
  });
  canonicalLines.push({
    pricingMode: "unit",
    chargeLineId: "pdf-parts-line",
    category: "parts",
    descZh: "刹车片",
    descEn: "Brake pads",
    remarkZh: "客户文件配件",
    remarkEn: "Customer-file parts",
    unit: "件",
    unitEn: "piece",
    quantity: 2,
    unitPriceJmd: 3_000,
    unitDiscountJmd: 500,
    finalUnitPriceJmd: 2_500,
    finalLineJmd: 5_000,
  });
  canonicalLines.push({
    pricingMode: "parking_projection",
    chargeLineId: "pdf-parking-line",
    category: "other_service",
    code: "parking_overtime",
    descZh: "停车超时费",
    descEn: "Parking overtime",
    remarkZh: "",
    remarkEn: "",
    parkingCaseId: "PARK-PDF-001",
    sourceRevision: 2,
    asOf: "2026-08-22T12:00:00.000-05:00",
    amountJmd: 2_500,
  });
  canonicalCharges.totals = {
    ...(canonicalCharges.totals as Record<string, unknown>),
    laborDiscountJmd: 1_000,
    laborNetJmd: 9_000,
    partsGrossJmd: 6_000,
    partsDiscountJmd: 1_000,
    partsNetJmd: 5_000,
    parkingTotalJmd: 2_500,
    totalDiscountJmd: 2_000,
    chargeSubtotalJmd: 24_000,
    adjustmentsJmd: -500,
    grandTotalJmd: 23_500,
  };
  canonicalStatement.ledger = {
    ...(canonicalStatement.ledger as Record<string, unknown>),
    invoiceTotalJmd: 23_500,
    receivableJmd: 18_500,
    balanceJmd: 14_500,
  };
  expect(() => pdfAssertion(canonical)).not.toThrow();
  const canonicalAxes = [
    ["工时原价", "Labor gross", "JMD 10,000"],
    ["工时优惠", "Labor discount", "-JMD 1,000"],
    ["工时净额", "Labor net", "JMD 9,000"],
    ["配件原价", "Parts gross", "JMD 6,000"],
    ["配件优惠", "Parts discount", "-JMD 1,000"],
    ["配件净额", "Parts net", "JMD 5,000"],
    ["其他费用", "Other fees", "JMD 7,500"],
    ["停车费用", "Parking", "JMD 2,500"],
    ["优惠合计", "Total discount", "-JMD 2,000"],
    ["收费小计", "Charge subtotal", "JMD 24,000"],
    ["调整", "Adjustments", "-JMD 500"],
    ["总计", "Grand total", "JMD 23,500"],
  ] as const;

  const legacy = structuredClone(validLegacyPdfSource());
  const legacyStatement = legacy.statement as Record<string, unknown>;
  const legacyCharges = legacyStatement.charges as Record<string, unknown>;
  (legacyCharges.items as Array<Record<string, unknown>>).push({
    id: "pdf-legacy-parts",
    descZh: "旧版刹车片",
    descEn: "Legacy brake pads",
    remarkZh: "类别优惠配件",
    remarkEn: "Category-discount parts",
    category: "parts",
    unit: "件",
    unitEn: "piece",
    unitPriceJmd: 3_000,
    quantity: 2,
    pendingQuote: false,
  });
  legacyCharges.totals = {
    ...(legacyCharges.totals as Record<string, unknown>),
    partsGrossJmd: 6_000,
    laborDiscountJmd: 1_000,
    partsDiscountJmd: 500,
    totalDiscountJmd: 1_500,
    grandTotalJmd: 14_500,
  };
  legacyStatement.ledger = {
    ...(legacyStatement.ledger as Record<string, unknown>),
    invoiceTotalJmd: 14_500,
    receivableJmd: 14_500,
    balanceJmd: 11_500,
  };
  expect(() => pdfAssertion(legacy)).not.toThrow();
  const legacyAxes = [
    ["工时原价", "Labor gross", "JMD 10,000"],
    ["工时优惠", "Labor discount", "-JMD 1,000"],
    ["配件原价", "Parts gross", "JMD 6,000"],
    ["配件优惠", "Parts discount", "-JMD 500"],
    ["优惠合计", "Total discount", "-JMD 1,500"],
    ["总计", "Grand total", "JMD 14,500"],
  ] as const;
  for (const language of ["zh", "en", "bilingual"] as const) {
    const label = (zh: string, en: string): string => (
      language === "zh" ? zh : language === "en" ? en : `${zh} / ${en}`
    );
    const canonicalText = await extractPdfText(await buildPdf(canonical, language));
    for (const [zh, en, amount] of canonicalAxes) {
      expectPdfTextNearby(canonicalText, label(zh, en), amount, `canonical ${language} ${en}`);
    }
    const legacyText = await extractPdfText(await buildPdf(legacy, language));
    for (const [zh, en, amount] of legacyAxes) {
      expectPdfTextNearby(legacyText, label(zh, en), amount, `legacy ${language} ${en}`);
    }
  }

  const overpaid = structuredClone(validPdfSource());
  const overpaidStatement = overpaid.statement as Record<string, unknown>;
  const overpaidEntries = overpaidStatement.entries as Array<Record<string, unknown>>;
  overpaidEntries[0]!.amountJmd = 13_500;
  overpaidStatement.ledger = {
    ...(overpaidStatement.ledger as Record<string, unknown>),
    grossPaidJmd: 13_500,
    netPaidJmd: 13_500,
    balanceJmd: -1_000,
    paymentStatus: "paid",
    settlementStatus: "overpaid",
  };
  expect(() => pdfAssertion(overpaid)).not.toThrow();
  const overpaidText = await extractPdfText(await buildPdf(overpaid, "bilingual"));
  expectPdfTextNearby(overpaidText, "客户贷方 / Customer credit", "1,000", "overpaid credit");

  for (const [language, suffix] of [["zh", "ZH"], ["en", "EN"], ["bilingual", "BI"]] as const) {
    expect(pdfFileName(canonical, language)).toBe(`INV-PDF-CANONICAL-V2-${suffix}.pdf`);
    const legacyFileName = pdfFileName(legacy, language);
    expect(legacyFileName).toBe(`KGN-WH-PDF-LEGACY-${suffix}.pdf`);
    expect(legacyFileName).not.toMatch(/invoice|inv/i);
  }
});

test("PDF accepts schema-valid pending identity coordinates and renders explicit placeholders", async () => {
  const pending = structuredClone(validPdfSource());
  pending.customer = {
    ...(pending.customer as Record<string, unknown>),
    nameZh: null,
    nameEn: null,
    organizationName: null,
    phone: null,
  };
  pending.vehicle = {
    ...(pending.vehicle as Record<string, unknown>),
    plate: "",
    vin: "",
  };
  expect(() => pdfAssertion(pending)).not.toThrow();
  const text = await extractPdfText(await buildPdf(pending, "bilingual"));
  expect(text.match(/—/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  expect(text).toMatch(
    /客户 \/ Customer[\s\S]{0,100}—[\s\S]{0,100}电话 \/ Phone[\s\S]{0,100}—[\s\S]{0,100}车辆 \/ Vehicle[\s\S]{0,100}— · 卡罗拉 \/ Corolla[\s\S]{0,100}VIN \/ VIN[\s\S]{0,100}—/,
  );
  expectPdfTextNearby(text, "客户 / Customer", "—", "pending customer placeholder");
  expectPdfTextNearby(text, "电话 / Phone", "—", "pending phone placeholder");
  expectPdfTextNearby(text, "车辆 / Vehicle", "— · 卡罗拉 / Corolla", "pending vehicle placeholder");
  expectPdfTextNearby(text, "VIN / VIN", "—", "pending VIN placeholder");
});

test("preview and download runtime never uploads browser storage or calls the retired server route", () => {
  for (const path of [PDF_DOMAIN_PATH, PDF_SECTION_PATH, QUICK_PRINT_PATH]) {
    const runtime = source(path);
    expect(runtime, path).not.toMatch(/storageSnapshot/);
    expect(runtime, path).not.toMatch(/window\.localStorage|window\.sessionStorage/);
    expect(runtime, path).not.toMatch(/startsWith\(\s*["']wh_/);
    expect(runtime, path).not.toMatch(/["']\/api\/pdf\/invoice["']/);
    expect(runtime, path).not.toMatch(/from\s+["']playwright["']|\bchromium\b/);
  }
  const section = source(PDF_SECTION_PATH);
  expect(section).toMatch(/previewBytes/);
  expect(section).toMatch(/buildQuickInvoicePdf/);
  expect(section).toMatch(/Blob\s*\(\s*\[\s*(?:previewBytes|bytes)/);
});

test("retired Invoice PDF route returns 410 before JSON, URL, storage, browser, or linked-state access", async () => {
  const sentinels = ["CALLER_A_PRIVATE_STORAGE_SENTINEL", "CALLER_B_PRIVATE_STORAGE_SENTINEL"];
  const bodies: string[] = [];
  for (const [index, sentinel] of sentinels.entries()) {
    let jsonCalls = 0;
    let urlGetterCalls = 0;
    let headersGetterCalls = 0;
    let cookiesGetterCalls = 0;
    let authGetterCalls = 0;
    const request = {
      get url() {
        urlGetterCalls += 1;
        throw new Error(`URL_GETTER_${sentinel}`);
      },
      get headers() {
        headersGetterCalls += 1;
        throw new Error(`HEADERS_GETTER_${sentinel}`);
      },
      get cookies() {
        cookiesGetterCalls += 1;
        throw new Error(`COOKIES_GETTER_${sentinel}`);
      },
      get auth() {
        authGetterCalls += 1;
        throw new Error(`AUTH_GETTER_${sentinel}`);
      },
      async json() {
        jsonCalls += 1;
        return {
          orderId: `invalid-${index}`,
          language: "zh",
          storage: {
            wh_session: sentinel,
            wh_linked_operations_state_v1: sentinel,
          },
        };
      },
    } as unknown as Request;
    const response = await POST(request);
    const body = await response.text();
    bodies.push(body);
    expect(response.status).toBe(410);
    expect(jsonCalls).toBe(0);
    expect(urlGetterCalls).toBe(0);
    expect(headersGetterCalls).toBe(0);
    expect(cookiesGetterCalls).toBe(0);
    expect(authGetterCalls).toBe(0);
    expect(body).not.toContain(sentinel);
    expect(body).not.toMatch(/wh_session|wh_linked_operations|storageSnapshot/);
  }
  expect(bodies[0]).toBe(bodies[1]);
});

test("retired server route contains no reusable Chromium or storage replay implementation", () => {
  const route = source(ROUTE_PATH);
  expect(route).not.toMatch(/from\s+["']playwright["']/);
  expect(route).not.toMatch(/\bchromium\b|__whInvoicePdfBrowser|Browser/);
  expect(route).not.toMatch(/request\.json\s*\(/);
  expect(route).not.toMatch(/request\.(?:headers|cookies|auth)\b|\b(?:headers|cookies)\s*\(/);
  expect(route).not.toMatch(/localStorage|sessionStorage|storageEntries|startsWith\(\s*["']wh_/);
  expect(route).not.toMatch(/getMockLinkedOperationsStore|LINKED_OPERATIONS_STORAGE_KEY/);
  expect(route).toMatch(/status\s*:\s*410|\{\s*status\s*:\s*410\s*\}/);
});
