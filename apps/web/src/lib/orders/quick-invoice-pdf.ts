import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import {
  assertQuickOrderFinancialStatement,
  type QuickOrderFinancialStatement,
  type QuickOrderStatementCanonicalLine,
  type QuickOrderStatementEntry,
} from "../billing/quick-order-financial-statement";
import {
  CONTENT_W,
  FAINT,
  MARGIN_X,
  PAGE_W,
  Painter,
  SOFT,
  drawBrandHeader,
  drawCompanyStrip,
  formatWholeJmd,
  labelOf,
  loadPdfFont,
  type PdfLabels,
} from "./pdf-shared";

export type QuickInvoicePdfLanguage = "zh" | "en" | "bilingual";

export interface QuickInvoicePdfCustomer {
  readonly id: string;
  readonly nameZh: string | null;
  readonly nameEn: string | null;
  readonly organizationName: string | null;
  readonly phone: string | null;
}

export interface QuickInvoicePdfVehicle {
  readonly id: string;
  readonly plate: string;
  readonly model: string;
  readonly modelZh: string | null;
  readonly vin: string;
}

export interface QuickInvoicePdfSource {
  readonly contract: "quick_invoice_pdf_source_v1";
  readonly statement: QuickOrderFinancialStatement;
  readonly customer: QuickInvoicePdfCustomer;
  readonly vehicle: QuickInvoicePdfVehicle;
}

export interface QuickInvoicePdfBuildOptions {
  readonly language: QuickInvoicePdfLanguage;
  readonly fontBytes?: Uint8Array;
  readonly logoBytes?: Uint8Array;
}

export interface QuickInvoicePdfGenerationCache {
  load(source: unknown, options: QuickInvoicePdfBuildOptions): Promise<Uint8Array | null>;
  invalidate(): void;
}

export type QuickInvoicePdfBuilder = (
  source: unknown,
  options: QuickInvoicePdfBuildOptions,
) => Promise<Uint8Array>;

const SOURCE_FIELDS = ["contract", "statement", "customer", "vehicle"] as const;
const CUSTOMER_FIELDS = ["id", "nameZh", "nameEn", "organizationName", "phone"] as const;
const VEHICLE_FIELDS = ["id", "plate", "model", "modelZh", "vin"] as const;

const L: PdfLabels = {
  zh: {
    title: "发票客户文件",
    legacyTitle: "旧版业务单客户文件",
    customer: "客户",
    phone: "电话",
    vehicle: "车辆",
    plate: "车牌",
    model: "车型",
    vin: "VIN",
    source: "单据来源",
    version: "版本",
    issuedAt: "开具时间",
    charges: "收费项目",
    quantity: "数量",
    financial: "账务汇总",
    invoiceTotal: "账单金额",
    paid: "付款",
    reduction: "应收冲减",
    cashRefunded: "实际退还现金",
    balance: "余额",
    history: "付款与退款历史",
    noCashReturned: "未退还现金",
    cashReturned: "已退还现金",
    legacyRefund: "旧版现金退款",
    chargeTotals: "收费汇总",
    laborGross: "工时原价",
    laborDiscount: "工时优惠",
    laborNet: "工时净额",
    partsGross: "配件原价",
    partsDiscount: "配件优惠",
    partsNet: "配件净额",
    otherFees: "其他费用",
    parking: "停车费用",
    totalDiscount: "优惠合计",
    chargeSubtotal: "收费小计",
    adjustments: "调整",
    grandTotal: "总计",
    customerCredit: "客户贷方",
    footer: "全心全意汽车维修服务 · 客户文件",
    signature: "客户签字",
    date: "日期",
  },
  en: {
    title: "Invoice Customer File",
    legacyTitle: "Legacy Business Order Customer File",
    customer: "Customer",
    phone: "Phone",
    vehicle: "Vehicle",
    plate: "Plate",
    model: "Model",
    vin: "VIN",
    source: "Document source",
    version: "Version",
    issuedAt: "Issued at",
    charges: "Charge lines",
    quantity: "Quantity",
    financial: "Financial summary",
    invoiceTotal: "Billed",
    paid: "Payment",
    reduction: "Receivable reduction",
    cashRefunded: "Cash returned",
    balance: "Balance",
    history: "Payment and refund history",
    noCashReturned: "No cash returned",
    cashReturned: "Cash returned",
    legacyRefund: "Legacy cash refund",
    chargeTotals: "Charge totals",
    laborGross: "Labor gross",
    laborDiscount: "Labor discount",
    laborNet: "Labor net",
    partsGross: "Parts gross",
    partsDiscount: "Parts discount",
    partsNet: "Parts net",
    otherFees: "Other fees",
    parking: "Parking",
    totalDiscount: "Total discount",
    chargeSubtotal: "Charge subtotal",
    adjustments: "Adjustments",
    grandTotal: "Grand total",
    customerCredit: "Customer credit",
    footer: "Whole Hearted Car Service · Customer file",
    signature: "Customer signature",
    date: "Date",
  },
};

function assertClosedDataObject(
  value: unknown,
  fields: ReadonlyArray<string>,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const expected = new Set(fields);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== fields.length) throw new TypeError(`${label} has an unexpected field count`);
  for (const key of ownKeys) {
    if (typeof key !== "string" || !expected.has(key)) {
      throw new TypeError(`${label} has an unexpected field: ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an own enumerable data field`);
    }
    if (descriptor.value === undefined) throw new TypeError(`${label}.${key} must not be undefined`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw new TypeError(`${label}.${field} is missing`);
  }
}

function assertNonBlank(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-blank string`);
  }
}

function assertNullableNonBlank(value: unknown, label: string): asserts value is string | null {
  if (value === null) return;
  assertNonBlank(value, label);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
}

function sharedStatementCandidate(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const statementDescriptor = Object.getOwnPropertyDescriptor(value, "statement");
  if (!statementDescriptor || !("value" in statementDescriptor)) return false;
  const statement = statementDescriptor.value;
  if (statement === null || typeof statement !== "object" || Array.isArray(statement)) return false;
  const sourceDescriptor = Object.getOwnPropertyDescriptor(statement, "source");
  if (!sourceDescriptor || !("value" in sourceDescriptor)) return false;
  const source = sourceDescriptor.value;
  if (source === null || typeof source !== "object" || Array.isArray(source)) return false;
  const kindDescriptor = Object.getOwnPropertyDescriptor(source, "kind");
  return Boolean(kindDescriptor && "value" in kindDescriptor && kindDescriptor.value === "shared_uninvoiced");
}

export function assertQuickInvoicePdfSource(value: unknown): asserts value is QuickInvoicePdfSource {
  assertClosedDataObject(value, SOURCE_FIELDS, "QuickInvoicePdfSource");
  if (value.contract !== "quick_invoice_pdf_source_v1") {
    throw new TypeError("QuickInvoicePdfSource.contract is invalid");
  }
  assertQuickOrderFinancialStatement(value.statement);

  assertClosedDataObject(value.customer, CUSTOMER_FIELDS, "QuickInvoicePdfSource.customer");
  assertNonBlank(value.customer.id, "QuickInvoicePdfSource.customer.id");
  assertNullableNonBlank(value.customer.nameZh, "QuickInvoicePdfSource.customer.nameZh");
  assertNullableNonBlank(value.customer.nameEn, "QuickInvoicePdfSource.customer.nameEn");
  assertNullableNonBlank(value.customer.organizationName, "QuickInvoicePdfSource.customer.organizationName");
  assertNullableNonBlank(value.customer.phone, "QuickInvoicePdfSource.customer.phone");

  assertClosedDataObject(value.vehicle, VEHICLE_FIELDS, "QuickInvoicePdfSource.vehicle");
  assertNonBlank(value.vehicle.id, "QuickInvoicePdfSource.vehicle.id");
  assertString(value.vehicle.plate, "QuickInvoicePdfSource.vehicle.plate");
  assertNonBlank(value.vehicle.model, "QuickInvoicePdfSource.vehicle.model");
  assertNullableNonBlank(value.vehicle.modelZh, "QuickInvoicePdfSource.vehicle.modelZh");
  assertString(value.vehicle.vin, "QuickInvoicePdfSource.vehicle.vin");

  if (value.customer.id !== value.statement.order.customerId) {
    throw new TypeError("QuickInvoicePdfSource.customer does not own the statement");
  }
  if (value.vehicle.id !== value.statement.order.vehicleId) {
    throw new TypeError("QuickInvoicePdfSource.vehicle does not own the statement");
  }
}

function localized(zh: string | null, en: string | null, language: QuickInvoicePdfLanguage): string {
  const safeZh = zh?.trim() || en?.trim() || "—";
  const safeEn = en?.trim() || zh?.trim() || "—";
  if (language === "zh") return safeZh;
  if (language === "en") return safeEn;
  return safeZh === safeEn ? safeZh : `${safeZh} / ${safeEn}`;
}

function lineAmount(line: QuickOrderStatementCanonicalLine): number {
  if (line.pricingMode === "unit") return line.finalLineJmd;
  return line.amountJmd;
}

function drawMoneyMeta(painter: Painter, key: string, amountJmd: number): void {
  painter.meta(key, `JMD ${formatWholeJmd(amountJmd)}`);
}

function drawSignedMoneyMeta(painter: Painter, key: string, amountJmd: number): void {
  const prefix = amountJmd < 0 ? "-" : "";
  painter.meta(key, `${prefix}JMD ${formatWholeJmd(Math.abs(amountJmd))}`);
}

function drawDiscountMeta(painter: Painter, key: string, amountJmd: number): void {
  painter.meta(key, `-JMD ${formatWholeJmd(amountJmd)}`);
}

function drawFinancialSummary(painter: Painter, statement: QuickOrderFinancialStatement): void {
  const balanceRow = statement.ledger.balanceJmd < 0
    ? ["customerCredit", `JMD ${formatWholeJmd(Math.abs(statement.ledger.balanceJmd))}`] as const
    : ["balance", `JMD ${formatWholeJmd(statement.ledger.balanceJmd)}`] as const;
  const rows = [
    ["invoiceTotal", `JMD ${formatWholeJmd(statement.ledger.invoiceTotalJmd ?? 0)}`],
    ["paid", `JMD ${formatWholeJmd(statement.ledger.grossPaidJmd)}`],
    ["reduction", `JMD ${formatWholeJmd(statement.ledger.receivableReductionJmd)}`],
    ["cashRefunded", `JMD ${formatWholeJmd(statement.ledger.cashRefundedJmd)}`],
    balanceRow,
  ] as const;
  const size = 9;
  const gap = 8;
  const labelWidth = Math.max(...rows.map(([key]) => (
    painter.font.widthOfTextAtSize(labelOf(L, key, painter.language), size)
  )));
  const valueX = MARGIN_X + labelWidth + gap;

  for (const [key, value] of rows) {
    painter.textAt(labelOf(L, key, painter.language), MARGIN_X, {
      size,
      color: SOFT,
      width: labelWidth,
    });
    painter.textAt(value, valueX, {
      size,
      width: CONTENT_W - labelWidth - gap,
    });
    painter.y -= 13;
  }
}

function drawChargeTotals(painter: Painter, statement: QuickOrderFinancialStatement): void {
  painter.heading("chargeTotals");
  if (statement.charges.kind === "legacy_quick") {
    const totals = statement.charges.totals;
    drawMoneyMeta(painter, "laborGross", totals.laborGrossJmd);
    drawDiscountMeta(painter, "laborDiscount", totals.laborDiscountJmd);
    drawMoneyMeta(painter, "partsGross", totals.partsGrossJmd);
    drawDiscountMeta(painter, "partsDiscount", totals.partsDiscountJmd);
    drawDiscountMeta(painter, "totalDiscount", totals.totalDiscountJmd);
    drawMoneyMeta(painter, "grandTotal", totals.grandTotalJmd);
    return;
  }
  const totals = statement.charges.totals;
  drawMoneyMeta(painter, "laborGross", totals.laborGrossJmd);
  drawDiscountMeta(painter, "laborDiscount", totals.laborDiscountJmd);
  drawMoneyMeta(painter, "laborNet", totals.laborNetJmd);
  drawMoneyMeta(painter, "partsGross", totals.partsGrossJmd);
  drawDiscountMeta(painter, "partsDiscount", totals.partsDiscountJmd);
  drawMoneyMeta(painter, "partsNet", totals.partsNetJmd);
  drawMoneyMeta(painter, "otherFees", totals.otherFeeTotalJmd);
  drawMoneyMeta(painter, "parking", totals.parkingTotalJmd);
  drawDiscountMeta(painter, "totalDiscount", totals.totalDiscountJmd);
  drawMoneyMeta(painter, "chargeSubtotal", totals.chargeSubtotalJmd);
  if ("adjustmentsJmd" in totals) {
    drawSignedMoneyMeta(painter, "adjustments", totals.adjustmentsJmd);
  }
  drawMoneyMeta(painter, "grandTotal", totals.grandTotalJmd);
}

function drawEntry(painter: Painter, entry: QuickOrderStatementEntry): void {
  const language = painter.language;
  if (entry.kind === "payment") {
    const note = entry.note ? ` · ${entry.note}` : "";
    painter.text(
      `${labelOf(L, "paid", language)}${note} · JMD ${formatWholeJmd(entry.amountJmd)} · ${entry.occurredAt}`,
      { size: 8.2, leading: 12 },
    );
    return;
  }
  if (entry.accounting === "legacy_cash_only") {
    const note = entry.note ?? labelOf(L, "legacyRefund", language);
    const description = entry.lineDescription ? ` · ${entry.lineDescription}` : "";
    painter.text(
      `${note}${description} · ${labelOf(L, "cashRefunded", language)} JMD ${formatWholeJmd(entry.cashRefundJmd)} · ${entry.occurredAt}`,
      { size: 8.2, leading: 12 },
    );
    return;
  }
  if (entry.accounting === "parking_correction_v1") {
    painter.text(`${entry.lineDescription} · ${entry.reason} · ${entry.occurredAt}`, { size: 8.2, leading: 12 });
    painter.text(
      `${labelOf(L, "cashRefunded", language)} JMD ${formatWholeJmd(entry.cashRefundJmd)} · ${labelOf(L, "cashReturned", language)}`,
      { size: 8.2, color: SOFT, leading: 12, indent: 10 },
    );
    return;
  }
  const lineCopy = localized(entry.line.descZh, entry.line.descEn, language);
  painter.text(`${lineCopy} · ${entry.reason} · ${entry.occurredAt}`, { size: 8.2, leading: 12 });
  painter.text(
    `${labelOf(L, "reduction", language)} JMD ${formatWholeJmd(entry.receivableReductionJmd)} · ${labelOf(L, "cashRefunded", language)} JMD ${formatWholeJmd(entry.cashRefundJmd)} · ${labelOf(L, entry.cashRefundJmd > 0 ? "cashReturned" : "noCashReturned", language)}`,
    { size: 8.2, color: SOFT, leading: 12, indent: 10 },
  );
}

export async function buildQuickInvoicePdf(
  value: unknown,
  options: QuickInvoicePdfBuildOptions,
): Promise<Uint8Array> {
  if (sharedStatementCandidate(value)) {
    throw new TypeError("A provisional or 未开票 · 暂记 Business Order is not an Invoice PDF");
  }
  assertQuickInvoicePdfSource(value);
  if (!(["zh", "en", "bilingual"] as const).includes(options.language)) {
    throw new TypeError("Quick Invoice PDF language is invalid");
  }
  if (value.statement.source.kind === "shared_uninvoiced") {
    throw new TypeError("A provisional Business Order is not an Invoice PDF");
  }

  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(options.fontBytes ?? await loadPdfFont(), { subset: false });
  const language = options.language;
  const statement = value.statement;
  const source = statement.source;
  const titleKey = source.kind === "legacy_quick" ? "legacyTitle" : "title";
  const documentNo = source.kind === "canonical_invoice" ? source.invoiceNo : statement.order.businessOrderNo;
  const documentSub = source.kind === "canonical_invoice" ? `V${source.versionNo}` : undefined;
  document.setTitle(`${documentNo} · ${labelOf(L, titleKey, language)}`);
  document.setSubject("Quick Order financial statement customer file");
  document.setProducer("Whole Hearted Car Service Management System");
  const painter = new Painter(document, font, L, language);

  await drawBrandHeader(painter, {
    docTitleKey: titleKey,
    docNo: documentNo,
    ...(documentSub ? { docSub: documentSub } : {}),
    ...(options.logoBytes ? { logoBytes: options.logoBytes } : {}),
  });
  drawCompanyStrip(painter);

  painter.heading("customer");
  painter.meta("customer", localized(value.customer.nameZh ?? value.customer.organizationName, value.customer.nameEn ?? value.customer.organizationName, language));
  painter.meta("phone", value.customer.phone ?? "—");
  painter.meta("vehicle", `${value.vehicle.plate.trim() || "—"} · ${localized(value.vehicle.modelZh, value.vehicle.model, language)}`);
  painter.meta("vin", value.vehicle.vin.trim() || "—");
  if (source.kind === "canonical_invoice") {
    painter.meta("source", `${source.invoiceNo} · ${labelOf(L, "version", language)} ${source.versionNo}`);
    painter.meta("issuedAt", statement.charges.kind === "canonical_invoice" ? statement.charges.issuedAt : "—");
  } else {
    painter.meta("source", `${statement.order.businessOrderNo} · ${labelOf(L, "legacyTitle", language)}`);
  }

  painter.heading("charges");
  if (statement.charges.kind === "legacy_quick") {
    for (const item of statement.charges.items) {
      const copy = localized(item.descZh, item.descEn, language);
      const amount = item.quantity * item.unitPriceJmd;
      painter.text(`${copy} · ${labelOf(L, "quantity", language)} ${item.quantity} · JMD ${formatWholeJmd(amount)}`, { size: 8.6, leading: 13 });
      const remark = localized(item.remarkZh, item.remarkEn, language);
      if (remark !== "—") painter.text(remark, { size: 7.4, color: SOFT, leading: 11, indent: 10 });
    }
  } else if (statement.charges.kind === "canonical_invoice") {
    for (const line of statement.charges.lines) {
      const copy = localized(line.descZh, line.descEn, language);
      const quantityCopy = line.pricingMode === "unit" ? ` · ${labelOf(L, "quantity", language)} ${line.quantity}` : "";
      painter.text(`${copy}${quantityCopy} · JMD ${formatWholeJmd(lineAmount(line))}`, { size: 8.6, leading: 13 });
      const remark = localized(line.remarkZh, line.remarkEn, language);
      if (remark !== "—") painter.text(remark, { size: 7.4, color: SOFT, leading: 11, indent: 10 });
    }
  }

  drawChargeTotals(painter, statement);
  painter.heading("financial");
  drawFinancialSummary(painter, statement);

  painter.heading("history");
  if (statement.entries.length === 0) {
    painter.text("—", { size: 8, color: FAINT });
  } else {
    statement.entries.forEach((entry) => drawEntry(painter, entry));
  }

  painter.ensure(64);
  painter.gap(18);
  const signatureY = painter.y - 18;
  const signatureWidth = CONTENT_W * 0.66;
  painter.page.drawLine({ start: { x: MARGIN_X, y: signatureY }, end: { x: MARGIN_X + signatureWidth, y: signatureY }, thickness: 0.6, color: FAINT });
  painter.page.drawLine({ start: { x: MARGIN_X + signatureWidth + 22, y: signatureY }, end: { x: PAGE_W - MARGIN_X, y: signatureY }, thickness: 0.6, color: FAINT });
  painter.page.drawText(labelOf(L, "signature", language), { x: MARGIN_X, y: signatureY - 13, size: 7.2, font, color: SOFT });
  painter.page.drawText(labelOf(L, "date", language), { x: MARGIN_X + signatureWidth + 22, y: signatureY - 13, size: 7.2, font, color: SOFT });
  painter.page.drawLine({ start: { x: MARGIN_X, y: signatureY - 28 }, end: { x: PAGE_W - MARGIN_X, y: signatureY - 28 }, thickness: 0.35, color: rgb(0.9, 0.9, 0.92) });

  painter.finishFooters();
  return document.save();
}

export function createQuickInvoicePdfGenerationCache(
  builder: QuickInvoicePdfBuilder = buildQuickInvoicePdf,
): QuickInvoicePdfGenerationCache {
  let generation = 0;
  let currentKey: string | null = null;
  let currentRequest: Promise<Uint8Array> | null = null;

  return {
    async load(source, options) {
      assertQuickInvoicePdfSource(source);
      const key = JSON.stringify([source, options.language]);
      if (key !== currentKey) {
        generation += 1;
        currentKey = key;
        currentRequest = null;
      }
      const capturedGeneration = generation;
      const request = currentRequest ?? Promise.resolve().then(() => builder(source, options));
      currentRequest = request;
      try {
        const bytes = await request;
        return capturedGeneration === generation ? bytes : null;
      } catch (caught) {
        if (capturedGeneration !== generation) return null;
        if (currentRequest === request) currentRequest = null;
        throw caught;
      }
    },
    invalidate() {
      generation += 1;
      currentKey = null;
      currentRequest = null;
    },
  };
}

export function quickInvoicePdfFileName(
  source: QuickInvoicePdfSource,
  language: QuickInvoicePdfLanguage,
): string;
export function quickInvoicePdfFileName(orderNo: string, language: QuickInvoicePdfLanguage): string;
export function quickInvoicePdfFileName(
  sourceOrOrderNo: QuickInvoicePdfSource | string,
  language: QuickInvoicePdfLanguage,
): string {
  let base: string;
  if (typeof sourceOrOrderNo === "string") {
    base = sourceOrOrderNo.includes("-INV-") || sourceOrOrderNo.includes("-INV")
      ? sourceOrOrderNo
      : `${sourceOrOrderNo}-INV`;
  } else {
    assertQuickInvoicePdfSource(sourceOrOrderNo);
    const statement = sourceOrOrderNo.statement;
    base = statement.source.kind === "canonical_invoice"
      ? `${statement.source.invoiceNo}-V${statement.source.versionNo}`
      : statement.order.businessOrderNo;
  }
  const suffix = language === "zh" ? "ZH" : language === "en" ? "EN" : "BI";
  return base.replace(/[^0-9A-Za-z-]/g, "-") + "-" + suffix + ".pdf";
}
