import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import {
  calculateQuotedChargeTotals,
  type FixedTotalChargeLine,
  type QuotedChargeLine,
  type UnitPricedChargeLine,
} from "../billing/quoted-charges";
import {
  ACCENT,
  CONTENT_W,
  FAINT,
  INK,
  MARGIN_X,
  PAGE_H,
  PAGE_W,
  PDF_FONT_URL,
  Painter,
  SOFT,
  drawBrandHeader,
  drawCompanyStrip,
  formatWholeJmd,
  labelOf,
  loadPdfFont,
  pdfFileName,
  wrapPdfText,
} from "./pdf-shared";
import type { IrPdfChargeLine, IrPdfLanguage, IrPdfSource } from "./ir-pdf-contract";

export { IR_PDF_RENDERER_VERSION } from "./ir-pdf-contract";
export type { IrPdfChargeLine, IrPdfLanguage, IrPdfSource } from "./ir-pdf-contract";

export const IR_PDF_FONT_URL = PDF_FONT_URL;

export interface IrPdfBuildOptions {
  readonly fontBytes?: Uint8Array;
  readonly logoBytes?: Uint8Array;
}

const L = {
  zh: {
    title: "检查报告 / 报价单",
    documentIdentity: "INSPECTION REPORT / QUOTATION",
    reportNo: "检查报告编号",
    quotationNo: "报价编号",
    generatedAt: "生成时间（牙买加）",
    customer: "客户",
    phone: "联系电话",
    vehicle: "车辆 / VIN",
    labor: "工时报价",
    parts: "所需配件",
    other: "其他费用",
    itemName: "项目名称",
    itemRemark: "项目备注",
    unit: "单位",
    quantity: "数量",
    price: "价格明细",
    subtotal: "折后小计",
    original: "原单价",
    perUnitDiscount: "每单位优惠",
    finalUnit: "折后单价",
    pending: "待报价",
    categoryGross: "原价",
    categoryDiscount: "优惠",
    categoryNet: "折后净额",
    grandTotal: "报价合计",
    grandTotalExcludingPending: "报价合计（不含待报价配件）",
    overallNote: "总备注 / 有言在先",
    pendingPrompt: "以上标记为“待报价”的配件暂未计入当前报价。客户可以自行准备符合车辆规格的配件，也可以另行联系 Whole Hearted Car Service Limited 配件部门，或向前台提出配件报价要求，由我司另行提供报价。申请报价时请提供本检查报告编号。",
    refund: "工时与配件优惠已逐项列示；退款按实际 Invoice 中对应项目的折后单价及实际可退数量计算。其他费用没有折扣，适用退款时按 Invoice 所列最终一口价处理。",
    signature: "客户签名",
    date: "日期",
    empty: "暂无项目",
    footer: "Whole Hearted 客户文件",
  },
  en: {
    title: "INSPECTION REPORT / QUOTATION",
    documentIdentity: "INSPECTION REPORT / QUOTATION",
    reportNo: "Inspection Report No.",
    quotationNo: "Quotation No.",
    generatedAt: "Generated (Jamaica)",
    customer: "CUSTOMER",
    phone: "Contact",
    vehicle: "VEHICLE / VIN",
    labor: "LABOR QUOTATION",
    parts: "PARTS REQUIRED",
    other: "OTHER CHARGES",
    itemName: "Item name",
    itemRemark: "Item remark",
    unit: "Unit",
    quantity: "Quantity",
    price: "Price detail",
    subtotal: "Net subtotal",
    original: "Original unit",
    perUnitDiscount: "Per-unit discount",
    finalUnit: "Discounted unit",
    pending: "Pending quote",
    categoryGross: "Gross",
    categoryDiscount: "Discount",
    categoryNet: "Net",
    grandTotal: "QUOTATION TOTAL",
    grandTotalExcludingPending: "QUOTATION TOTAL (EXCLUDES PENDING-QUOTE PARTS)",
    overallNote: "OVERALL NOTE / CUSTOMER ADVISED",
    pendingPrompt: "Parts marked “Pending quote” are not included in the current quotation total. The customer may supply suitable parts, contact the Whole Hearted Car Service Limited Parts Department separately, or ask the front desk to obtain a separate quotation from our company. Please provide this Inspection Report number when requesting a quotation.",
    refund: "Labor and parts discounts are shown by item. Any applicable refund is calculated using the discounted unit price and refundable quantity shown on the actual Invoice. Other charges are not discounted; where a refund applies, it uses the final fixed amount shown on the Invoice.",
    signature: "Customer signature",
    date: "Date",
    empty: "No items",
    footer: "Whole Hearted customer file",
  },
} as const;

const LINE = rgb(0.86, 0.88, 0.91);
const PAPER_TINT = rgb(0.972, 0.978, 0.989);
const PENDING_INK = rgb(0.69, 0.39, 0.04);

export function irPdfFileName(reportNo: string, language: IrPdfLanguage): string {
  return pdfFileName(reportNo, language);
}

export { wrapPdfText };

function localizedLines(language: IrPdfLanguage, zh: string, en?: string | null): string[] {
  const primary = zh.trim() || "—";
  const translation = en?.trim() ?? "";
  if (language === "zh") return [primary];
  if (language === "en") return translation ? [translation] : [primary, "Translation pending"];
  if (!translation) return [primary, "Translation pending"];
  return translation === primary ? [primary] : [primary, translation];
}

function lineCopies(
  language: IrPdfLanguage,
  line: IrPdfChargeLine,
): { title: string[]; remark: string[] } {
  const hasRemark = line.remarkZh.trim().length > 0 || line.remarkEn.trim().length > 0;
  return {
    title: localizedLines(language, line.descZh, line.descEn),
    remark: hasRemark
      ? localizedLines(language, line.remarkZh, line.remarkEn).filter((value) => value !== "—")
      : [],
  };
}

function assertSource(source: IrPdfSource): QuotedChargeLine[] {
  if (!Number.isSafeInteger(source.generation.version) || source.generation.version < 1) {
    throw new Error("Generated customer-file version is invalid");
  }
  if (!/-05:00$/.test(source.generation.generatedAt) || Number.isNaN(Date.parse(source.generation.generatedAt))) {
    throw new Error("Generated customer-file time must be a Jamaica -05:00 instant");
  }
  const lines = source.quotation.lines as ReadonlyArray<QuotedChargeLine>;
  if (lines.some((line) => line.pricingMode === "parking_projection")) {
    throw new Error("parking_projection is forbidden in an Inspection Report Quotation PDF");
  }
  if (lines.some((line) => line.pricingMode === "unit" && line.pendingQuote && line.category !== "parts")) {
    throw new Error("pendingQuote is only valid for parts; labor cannot be pending quote");
  }
  calculateQuotedChargeTotals(lines);
  return [...lines];
}

function drawCellLines(
  painter: Painter,
  font: PDFFont,
  lines: ReadonlyArray<string>,
  x: number,
  top: number,
  width: number,
  options: { size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "right"; maxLines?: number } = {},
): number {
  const size = options.size ?? 7.4;
  const leading = size + 2.2;
  let row = 0;
  for (const sourceLine of lines) {
    for (const wrapped of wrapPdfText(sourceLine, font, size, width)) {
      if (options.maxLines !== undefined && row >= options.maxLines) return row;
      const textWidth = font.widthOfTextAtSize(wrapped, size);
      painter.page.drawText(wrapped, {
        x: options.align === "right" ? x + width - textWidth : x,
        y: top - row * leading,
        size,
        font,
        color: options.color ?? INK,
      });
      row += 1;
    }
  }
  return row;
}

function drawRule(painter: Painter, y: number): void {
  painter.page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 0.45, color: LINE });
}

export async function buildInspectionReportPdf(
  source: IrPdfSource,
  language: IrPdfLanguage,
  options: IrPdfBuildOptions = {},
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const chargeLines = assertSource(source);
  const totals = calculateQuotedChargeTotals(chargeLines);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  document.setTitle(`${source.reportNo} · ${labelOf(L, "title", language)} · V${source.generation.version}`);
  document.setSubject("Inspection Report / Quotation customer file");
  document.setProducer("Whole Hearted Car Service Management System");
  document.setCreator(source.company.legalName);
  const font = await document.embedFont(options.fontBytes ?? await loadPdfFont(), { subset: false });
  const painter = new Painter(document, font, L, language);

  await drawBrandHeader(painter, {
    docTitleKey: "title",
    docNo: source.reportNo,
    docSub: `V${source.generation.version}`,
    company: source.company,
    layout: "stacked-title",
    ...(options.logoBytes ? { logoBytes: options.logoBytes } : {}),
  });
  drawCompanyStrip(painter, source.company);

  painter.ensure(92);
  const identityTop = painter.y;
  const identityHeight = 78;
  painter.page.drawRectangle({
    x: MARGIN_X, y: identityTop - identityHeight, width: CONTENT_W, height: identityHeight,
    color: PAPER_TINT, borderColor: LINE, borderWidth: 0.6,
  });
  const third = CONTENT_W / 3;
  const customer = localizedLines(language, source.customer.nameZh, source.customer.nameEn);
  const model = localizedLines(language, source.vehicle.modelZh ?? source.vehicle.modelEn ?? "—", source.vehicle.modelEn);
  const identityColumns = [
    { label: labelOf(L, "customer", language), lines: [...customer, source.customer.phone] },
    { label: labelOf(L, "vehicle", language), lines: [source.vehicle.plate, ...model, `VIN: ${source.vehicle.vin?.trim() || "—"}`] },
    { label: labelOf(L, "generatedAt", language), lines: [source.generation.generatedAt, `${labelOf(L, "quotationNo", language)}: ${source.quotationNo}`, `V${source.generation.version}`] },
  ];
  identityColumns.forEach((column, index) => {
    const x = MARGIN_X + index * third + 8;
    painter.page.drawText(column.label, { x, y: identityTop - 14, size: 7.3, font, color: ACCENT });
    drawCellLines(painter, font, column.lines, x, identityTop - 30, third - 16, { size: 7.2, maxLines: 4 });
    if (index > 0) painter.page.drawLine({ start: { x: MARGIN_X + index * third, y: identityTop - identityHeight + 8 }, end: { x: MARGIN_X + index * third, y: identityTop - 8 }, thickness: 0.4, color: LINE });
  });
  painter.y = identityTop - identityHeight - 10;

  const itemNameCol = 105;
  const itemRemarkCol = 100;
  const unitCol = 50;
  const quantityCol = 38;
  const priceCol = 160;
  const subtotalCol = CONTENT_W - itemNameCol - itemRemarkCol - unitCol - quantityCol - priceCol;
  const xItemName = MARGIN_X;
  const xItemRemark = xItemName + itemNameCol;
  const xUnit = xItemRemark + itemRemarkCol;
  const xQuantity = xUnit + unitCol;
  const xPrice = xQuantity + quantityCol;
  const xSubtotal = xPrice + priceCol;
  const maxCellLinesPerSegment = 22;

  const drawUnitHeader = (titleKey: "labor" | "parts") => {
    painter.ensure(54);
    painter.text(labelOf(L, titleKey, language), { size: 10, color: ACCENT, leading: 15 });
    const top = painter.y;
    painter.page.drawRectangle({ x: MARGIN_X, y: top - 31, width: CONTENT_W, height: 31, color: rgb(0.94, 0.95, 0.97) });
    const y = top - 11;
    drawCellLines(painter, font, [labelOf(L, "itemName", language)], xItemName + 4, y, itemNameCol - 8, { size: 6.2, maxLines: 2 });
    drawCellLines(painter, font, [labelOf(L, "itemRemark", language)], xItemRemark + 4, y, itemRemarkCol - 8, { size: 6.2, maxLines: 2 });
    drawCellLines(painter, font, [labelOf(L, "unit", language)], xUnit + 4, y, unitCol - 8, { size: 6.2, maxLines: 2 });
    drawCellLines(painter, font, [labelOf(L, "quantity", language)], xQuantity + 3, y, quantityCol - 6, { size: 6.1, align: "right", maxLines: 2 });
    drawCellLines(painter, font, [labelOf(L, "price", language)], xPrice + 4, y, priceCol - 8, { size: 6.6 });
    drawCellLines(painter, font, [labelOf(L, "subtotal", language)], xSubtotal + 3, y, subtotalCol - 6, { size: 6.3, align: "right" });
    painter.y = top - 35;
  };

  const drawUnitGroup = (category: "labor" | "parts", titleKey: "labor" | "parts") => {
    const lines = chargeLines.filter((line): line is UnitPricedChargeLine => line.pricingMode === "unit" && line.category === category);
    drawUnitHeader(titleKey);
    if (lines.length === 0) {
      painter.text(labelOf(L, "empty", language), { size: 7.4, color: FAINT, leading: 18 });
      return;
    }
    lines.forEach((line, index) => {
      const copy = lineCopies(language, line);
      const lineDiscountTotal = line.quantity * line.unitDiscountJmd;
      const priceSourceLines = line.pendingQuote ? [labelOf(L, "pending", language)] : [
        `${labelOf(L, "original", language)} ${formatWholeJmd(line.unitPriceJmd)}`,
        line.unitDiscountJmd === 0
          ? `${labelOf(L, "perUnitDiscount", language)} —`
          : `${labelOf(L, "perUnitDiscount", language)} ${formatWholeJmd(line.unitDiscountJmd)} × ${line.quantity} = ${formatWholeJmd(lineDiscountTotal)}`,
        `${labelOf(L, "finalUnit", language)} ${formatWholeJmd(line.unitPriceJmd - line.unitDiscountJmd)}`,
      ];
      const remaining = {
        name: copy.title.flatMap((value) => wrapPdfText(value, font, 7, itemNameCol - 8)),
        remark: (copy.remark.length ? copy.remark : ["—"]).flatMap((value) => wrapPdfText(value, font, 6.5, itemRemarkCol - 8)),
        unit: localizedLines(language, line.unit, line.unitEn).flatMap((value) => wrapPdfText(value, font, 6.5, unitCol - 8)),
        quantity: wrapPdfText(String(line.quantity), font, 6.8, quantityCol - 6),
        price: priceSourceLines.flatMap((value) => wrapPdfText(value, font, 6.1, priceCol - 8)),
        subtotal: wrapPdfText(
          line.pendingQuote ? "—" : formatWholeJmd(line.quantity * (line.unitPriceJmd - line.unitDiscountJmd)),
          font,
          7,
          subtotalCol - 6,
        ),
      };
      while (Object.values(remaining).some((cell) => cell.length > 0)) {
        const segment = {
          name: remaining.name.splice(0, maxCellLinesPerSegment),
          remark: remaining.remark.splice(0, maxCellLinesPerSegment),
          unit: remaining.unit.splice(0, maxCellLinesPerSegment),
          quantity: remaining.quantity.splice(0, maxCellLinesPerSegment),
          price: remaining.price.splice(0, maxCellLinesPerSegment),
          subtotal: remaining.subtotal.splice(0, maxCellLinesPerSegment),
        };
        const segmentLineCount = Math.max(1, ...Object.values(segment).map((cell) => cell.length));
        const rowHeight = Math.max(34, 13 + segmentLineCount * 8.8);
        const pageBefore = painter.page;
        painter.ensure(rowHeight + 4);
        if (painter.page !== pageBefore) drawUnitHeader(titleKey);
        const top = painter.y;
        if (index % 2 === 1) painter.page.drawRectangle({ x: MARGIN_X, y: top - rowHeight, width: CONTENT_W, height: rowHeight, color: rgb(0.987, 0.989, 0.994) });
        drawCellLines(painter, font, segment.name, xItemName + 4, top - 11, itemNameCol - 8, { size: 7 });
        drawCellLines(painter, font, segment.remark, xItemRemark + 4, top - 11, itemRemarkCol - 8, { size: 6.5, color: SOFT });
        drawCellLines(painter, font, segment.unit, xUnit + 4, top - 11, unitCol - 8, { size: 6.5 });
        drawCellLines(painter, font, segment.quantity, xQuantity + 3, top - 11, quantityCol - 6, { size: 6.8, align: "right" });
        drawCellLines(painter, font, segment.price, xPrice + 4, top - 11, priceCol - 8, { size: 6.1, color: line.pendingQuote ? PENDING_INK : INK });
        drawCellLines(painter, font, segment.subtotal, xSubtotal + 3, top - 11, subtotalCol - 6, { size: 7, align: "right" });
        painter.y = top - rowHeight;
        drawRule(painter, painter.y);
      }
    });
    painter.gap(6);
    const categoryValues = category === "labor"
      ? [totals.laborGrossJmd, totals.laborDiscountJmd, totals.laborNetJmd]
      : [totals.partsGrossJmd, totals.partsDiscountJmd, totals.partsNetJmd];
    painter.text([
      `${labelOf(L, "categoryGross", language)} JMD ${formatWholeJmd(categoryValues[0])}`,
      `${labelOf(L, "categoryDiscount", language)} JMD ${formatWholeJmd(categoryValues[1])}`,
      `${labelOf(L, "categoryNet", language)} JMD ${formatWholeJmd(categoryValues[2])}`,
    ].join("   ·   "), { size: 7.2, color: SOFT, leading: 14 });
    painter.gap(5);
  };

  drawUnitGroup("labor", "labor");
  drawUnitGroup("parts", "parts");

  const fixedLines = chargeLines.filter((line): line is FixedTotalChargeLine => line.pricingMode === "fixed_total");
  if (fixedLines.length > 0) {
    const drawFixedHeading = () => {
      painter.ensure(34);
      painter.text(labelOf(L, "other", language), { size: 10, color: ACCENT, leading: 16 });
    };
    drawFixedHeading();
    fixedLines.forEach((line, index) => {
      const copy = lineCopies(language, line);
      const leftWidth = CONTENT_W - 150;
      const details = [
        ...copy.title.flatMap((value) => wrapPdfText(value, font, 7.2, leftWidth - 8)),
        ...copy.remark.flatMap((value) => wrapPdfText(value, font, 6.5, leftWidth - 8)),
      ];
      let firstSegment = true;
      while (details.length > 0) {
        const segment = details.splice(0, maxCellLinesPerSegment);
        const rowHeight = Math.max(30, 13 + segment.length * 8.8);
        const pageBefore = painter.page;
        painter.ensure(rowHeight + 3);
        if (painter.page !== pageBefore) drawFixedHeading();
        const top = painter.y;
        if (index % 2 === 1) painter.page.drawRectangle({ x: MARGIN_X, y: top - rowHeight, width: CONTENT_W, height: rowHeight, color: rgb(0.987, 0.989, 0.994) });
        drawCellLines(painter, font, segment, MARGIN_X + 6, top - 11, leftWidth - 8, { size: 6.7, color: firstSegment ? INK : SOFT });
        if (firstSegment) {
          drawCellLines(painter, font, [`JMD ${formatWholeJmd(line.amountJmd)}`], PAGE_W - MARGIN_X - 132, top - 11, 126, { size: 7.6, align: "right" });
        }
        painter.y = top - rowHeight;
        drawRule(painter, painter.y);
        firstSegment = false;
      }
    });
    painter.text(`${labelOf(L, "categoryNet", language)} JMD ${formatWholeJmd(totals.otherFeeTotalJmd)}`, { size: 7.3, color: SOFT, leading: 16 });
  }

  painter.ensure(52);
  const totalTop = painter.y;
  painter.page.drawRectangle({ x: MARGIN_X, y: totalTop - 42, width: CONTENT_W, height: 42, color: rgb(0.91, 0.94, 0.995) });
  const totalLabelKey = totals.pendingPartsCount > 0 ? "grandTotalExcludingPending" : "grandTotal";
  drawCellLines(painter, font, [labelOf(L, totalLabelKey, language)], MARGIN_X + 10, totalTop - 16, CONTENT_W - 180, { size: 7.4, color: ACCENT, maxLines: 2 });
  const grand = `JMD ${formatWholeJmd(totals.grandTotalJmd)}`;
  painter.page.drawText(grand, { x: PAGE_W - MARGIN_X - 10 - font.widthOfTextAtSize(grand, 10), y: totalTop - 25, size: 10, font, color: ACCENT });
  painter.y = totalTop - 50;

  painter.heading("overallNote");
  const noteLines = localizedLines(language, source.quotation.noteZh, source.quotation.noteEn);
  noteLines.forEach((line, index) => painter.text(line, { size: index === 0 ? 8 : 7.4, color: index === 0 ? INK : SOFT, leading: 12 }));
  if (totals.pendingPartsCount > 0) {
    painter.gap(5);
    painter.text(labelOf(L, "pendingPrompt", language), { size: 7, color: PENDING_INK, leading: 10.5 });
  }
  painter.gap(5);
  painter.text(labelOf(L, "refund", language), { size: 6.8, color: SOFT, leading: 10.2 });

  // One indivisible empty signature block, placed only once on the final page.
  painter.ensure(66);
  painter.gap(15);
  const signatureY = painter.y - 20;
  const signatureWidth = CONTENT_W * 0.68;
  painter.page.drawLine({ start: { x: MARGIN_X, y: signatureY }, end: { x: MARGIN_X + signatureWidth, y: signatureY }, thickness: 0.6, color: FAINT });
  painter.page.drawLine({ start: { x: MARGIN_X + signatureWidth + 22, y: signatureY }, end: { x: PAGE_W - MARGIN_X, y: signatureY }, thickness: 0.6, color: FAINT });
  painter.page.drawText(labelOf(L, "signature", language), { x: MARGIN_X, y: signatureY - 13, size: 7.2, font, color: SOFT });
  painter.page.drawText(labelOf(L, "date", language), { x: MARGIN_X + signatureWidth + 22, y: signatureY - 13, size: 7.2, font, color: SOFT });
  painter.y = signatureY - 28;

  painter.finishFooters();
  const bytes = await document.save();
  return { bytes, fileName: irPdfFileName(source.reportNo, language) };
}

export const IR_PDF_PAGE_GEOMETRY = Object.freeze({ width: PAGE_W, height: PAGE_H, marginX: MARGIN_X });
