import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { BusinessOrderDocumentRenderSnapshot } from "@formal/db/schema/business-order-document";
import {
  applyDocumentOverrides,
  buildBusinessOrderDocumentContent,
  validateDocumentOverrides,
} from "@formal/modules/business-order/business-order-document-content";

export const BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION = "bo-a4-v9";
export const A4_WIDTH_POINTS = 595.28;
export const A4_HEIGHT_POINTS = 841.89;

const MARGIN = 30;
const CONTENT_WIDTH = A4_WIDTH_POINTS - MARGIN * 2;
const PAGE_BOTTOM = 42;
const BLUE = rgb(0.11, 0.41, 0.83);
const BLUE_DARK = rgb(0.05, 0.19, 0.36);
const INK = rgb(0.15, 0.15, 0.15);
const MUTED = rgb(0.39, 0.42, 0.46);
const LINE = rgb(0.80, 0.82, 0.84);
const HAIRLINE = rgb(0.90, 0.90, 0.90);
const SOFT = rgb(0.965, 0.97, 0.975);
const WHITE = rgb(1, 1, 1);

export type RenderBusinessOrderDocumentPdfInput = {
  documentNo: string;
  revisionNo: number;
  snapshot: BusinessOrderDocumentRenderSnapshot;
  fieldOverrides: Record<string, string>;
  language?: "zh" | "en";
};

export class BusinessOrderDocumentEnglishTranslationError extends Error {
  constructor(readonly missingFields: string[]) {
    super(`英文版缺少翻译：${missingFields.join("、")}`);
    this.name = "BusinessOrderDocumentEnglishTranslationError";
  }
}

type TableCell = { text: string; align?: "left" | "right" | "center"; color?: RGB };

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const result: string[] = [];
  for (const paragraph of String(text ?? "").replaceAll("\r\n", "\n").split("\n")) {
    if (!paragraph) { result.push(""); continue; }
    let line = "";
    for (const character of paragraph) {
      const next = `${line}${character}`;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
        result.push(line);
        line = character;
      } else {
        line = next;
      }
    }
    result.push(line);
  }
  return result.length ? result : [""];
}

function money(minor: number): string {
  return `JMD ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function documentDate(documentNo: string): string {
  const match = documentNo.match(/-(\d{4})(\d{2})(\d{2})-/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : "—";
}

function kindTitle(kind: BusinessOrderDocumentRenderSnapshot["kind"], language: "zh" | "en"): { primary: string; secondary: string } {
  if (kind === "mechanic_work") return { primary: "维修施工单", secondary: "WORK ORDER" };
  if (language === "en") return kind === "office_archive"
    ? { primary: "OFFICE SIGNATURE COPY", secondary: "SERVICE RECORD" }
    : { primary: "CUSTOMER SERVICE STATEMENT", secondary: "VEHICLE REPAIR & PAYMENT RECORD" };
  if (kind === "office_archive") return { primary: "办公室签字留底联", secondary: "OFFICE SIGNATURE COPY" };
  return { primary: "客户维修结算单", secondary: "CUSTOMER SERVICE STATEMENT" };
}

export function englishBusinessDocumentName(value: string): string | null {
  const segments = value.split("/").map((segment) => segment.trim()).filter(Boolean);
  const englishSegment = segments.findLast((segment) => !/[\u3400-\u9fff]/u.test(segment));
  return englishSegment || null;
}

function validateEnglishSnapshot(snapshot: BusinessOrderDocumentRenderSnapshot) {
  if (snapshot.kind === "mechanic_work") throw new BusinessOrderDocumentEnglishTranslationError(["维修工联不提供英文版"]);
  const missing: string[] = [];
  if (!englishBusinessDocumentName(snapshot.businessOrder.payerName)) missing.push("费用承担方英文名称");
  snapshot.charges.items.forEach((item, index) => {
    if (!item.nameEn?.trim()) missing.push(`收费项目 ${index + 1} 名称`);
    if (item.descriptionZh?.trim() && !item.descriptionEn?.trim()) missing.push(`收费项目 ${index + 1} 说明`);
    if (!item.unitLabelEn?.trim()) missing.push(`收费项目 ${index + 1} 单位`);
  });
  snapshot.charges.notes.forEach((note, index) => {
    if (note.contentZh?.trim() && !note.contentEn?.trim()) missing.push(`备注 ${index + 1}`);
  });
  snapshot.transactions.forEach((transaction, index) => {
    if (!transaction.methodLabelEn?.trim()) missing.push(`收付款 ${index + 1} 方式`);
  });
  if (snapshot.version === 2) {
    if (snapshot.problemDescription.original.contentZh?.trim() && !snapshot.problemDescription.original.contentEn?.trim()) missing.push("原始问题描述");
    const round = snapshot.problemDescription.repairRound;
    if (round?.contentZh?.trim() && !round.contentEn?.trim()) missing.push("本轮问题描述");
  }
  if (!snapshot.approval.statementEn.trim()) missing.push("客户确认文字");
  if (missing.length) throw new BusinessOrderDocumentEnglishTranslationError(missing);
}

export async function renderBusinessOrderDocumentPdf(input: RenderBusinessOrderDocumentPdfInput): Promise<Uint8Array> {
  const language = input.language ?? "zh";
  if (language === "en") validateEnglishSnapshot(input.snapshot);
  const english = language === "en";
  const tr = (zh: string, en: string) => english ? en : zh;
  const overrides = validateDocumentOverrides(input.snapshot, input.fieldOverrides);
  const content = applyDocumentOverrides(buildBusinessOrderDocumentContent(input.snapshot), overrides);
  const values = new Map(content.fields.map((field) => [field.key, field.value]));
  const value = (key: string, fallback: string) => values.get(key) ?? fallback;
  const localizedValue = (key: string, zh: string, en: string | null | undefined) => english ? (en ?? "") : value(key, zh);

  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const fixedDate = new Date("2000-01-01T00:00:00.000Z");
  document.setTitle(`${input.documentNo}-R${input.revisionNo}`);
  document.setAuthor("Whole Hearted Car Service Limited");
  document.setSubject("Business Order formal A4 document");
  document.setCreator(BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION);
  document.setProducer(BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION);
  document.setCreationDate(fixedDate);
  document.setModificationDate(fixedDate);
  document.setLanguage(english ? "en-JM" : "zh-CN");

  const fontBytes = await readFile(path.join(process.cwd(), "apps/web/public/fonts/NotoSansSC-Regular-wh.ttf"));
  const logoBytes = await readFile(path.join(process.cwd(), "apps/web/public/logo-icon.png"));
  const font = await document.embedFont(Uint8Array.from(fontBytes), { subset: false });
  const logo = await document.embedPng(Uint8Array.from(logoBytes));
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const drawText = (text: string, x: number, baseline: number, size = 8, color = INK, maxWidth?: number, align: "left" | "right" | "center" = "left") => {
    let tx = x;
    const width = font.widthOfTextAtSize(text, size);
    if (maxWidth && align === "right") tx = x + maxWidth - width;
    if (maxWidth && align === "center") tx = x + (maxWidth - width) / 2;
    page.drawText(text || " ", { x: tx, y: baseline, size, font, color });
  };

  const drawHeader = (continued: boolean) => {
    const title = kindTitle(input.snapshot.kind, language);
    const logoSize = continued ? 25 : 34;
    const headerTop = A4_HEIGHT_POINTS - MARGIN;
    page.drawImage(logo, { x: MARGIN, y: headerTop - logoSize, width: logoSize, height: logoSize });
    drawText("Whole Hearted Car Service Limited", MARGIN + logoSize + 9, headerTop - 9, continued ? 9.4 : 11.5, BLUE_DARK);
    drawText("16 Ferry Pen, Kingston, Jamaica", MARGIN + logoSize + 9, headerTop - 21, 6.7, MUTED);
    if (!continued) drawText("WhatsApp: 1 876-899-3924 / 1 876-333-3322  ·  TRN 003650332", MARGIN + logoSize + 9, headerTop - 31, 6.4, MUTED);
    drawText(title.primary, MARGIN, headerTop - 10, continued ? 10.5 : 13.5, BLUE_DARK, CONTENT_WIDTH, "right");
    drawText(title.secondary, MARGIN, headerTop - 23, 6.8, BLUE, CONTENT_WIDTH, "right");
    drawText(`${input.documentNo}  ·  R${input.revisionNo}${continued ? tr("  ·  续页", "  ·  CONTINUED") : ""}`, MARGIN, headerTop - 34, 6.7, MUTED, CONTENT_WIDTH, "right");
    const lineY = headerTop - (continued ? 39 : 45);
    page.drawLine({ start: { x: MARGIN, y: lineY }, end: { x: A4_WIDTH_POINTS - MARGIN, y: lineY }, thickness: 1.4, color: BLUE });
    y = lineY - 14;
  };

  const addPage = () => {
    page = document.addPage([A4_WIDTH_POINTS, A4_HEIGHT_POINTS]);
    pages.push(page);
    drawHeader(pages.length > 1);
  };

  const ensure = (height: number, onNewPage?: () => void) => {
    if (y - height >= PAGE_BOTTOM) return false;
    addPage();
    onNewPage?.();
    return true;
  };

  const sectionTitle = (primary: string, secondary?: string) => {
    ensure(24);
    y -= 3;
    drawText(primary, MARGIN, y, 9.2, BLUE_DARK);
    if (secondary) drawText(secondary, MARGIN + 90, y + 0.2, 6.5, MUTED);
    page.drawLine({ start: { x: MARGIN, y: y - 5 }, end: { x: A4_WIDTH_POINTS - MARGIN, y: y - 5 }, thickness: 0.8, color: BLUE });
    y -= 16;
  };

  const infoGrid = (cells: Array<{ label: string; value: string }>, columns = 3) => {
    const rows = Math.ceil(cells.length / columns);
    const cellWidth = CONTENT_WIDTH / columns;
    const rowHeight = 34;
    ensure(rows * rowHeight + 2);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const x = MARGIN + column * cellWidth;
        const top = y - row * rowHeight;
        page.drawRectangle({ x, y: top - rowHeight, width: cellWidth, height: rowHeight, borderColor: LINE, borderWidth: 0.55, color: row % 2 ? WHITE : SOFT });
        const cell = cells[index];
        if (!cell) continue;
        drawText(cell.label, x + 7, top - 11, 6.2, MUTED);
        const lines = wrapText(cell.value || "—", font, 8.1, cellWidth - 14).slice(0, 2);
        lines.forEach((line, lineIndex) => drawText(line, x + 7, top - 23 - lineIndex * 9, 8.1, INK));
      }
    }
    y -= rows * rowHeight + 12;
  };

  const table = (
    section: { primary: string; secondary?: string },
    headers: string[],
    widths: number[],
    rows: TableCell[][],
    options: { fontSize?: number; headerSize?: number; minimumRowHeight?: number } = {},
  ) => {
    const fontSize = options.fontSize ?? 7.2;
    const headerSize = options.headerSize ?? 6.4;
    const headerHeight = 21;
    const minimumRowHeight = options.minimumRowHeight ?? 24;
    const drawTableHeader = () => {
      ensure(headerHeight + 2);
      page.drawRectangle({ x: MARGIN, y: y - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: BLUE_DARK });
      let x = MARGIN;
      headers.forEach((header, index) => {
        drawText(header, x + 5, y - 14, headerSize, WHITE, widths[index] - 10, index >= headers.length - 3 ? "right" : "left");
        x += widths[index];
      });
      y -= headerHeight;
    };
    sectionTitle(section.primary, section.secondary);
    drawTableHeader();
    rows.forEach((row, rowIndex) => {
      const linesByCell = row.map((cell, index) => wrapText(cell.text, font, fontSize, widths[index] - 10));
      const rowHeight = Math.max(minimumRowHeight, Math.max(...linesByCell.map((lines) => lines.length)) * (fontSize + 3) + 10);
      ensure(rowHeight, () => { sectionTitle(`${section.primary}${tr("（续）", " (CONTINUED)")}`, section.secondary); drawTableHeader(); });
      page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: rowIndex % 2 ? SOFT : WHITE });
      let x = MARGIN;
      row.forEach((cell, index) => {
        linesByCell[index].forEach((line, lineIndex) => drawText(line, x + 5, y - 13 - lineIndex * (fontSize + 3), fontSize, cell.color ?? INK, widths[index] - 10, cell.align ?? "left"));
        if (index > 0) page.drawLine({ start: { x, y }, end: { x, y: y - rowHeight }, thickness: 0.35, color: HAIRLINE });
        x += widths[index];
      });
      page.drawLine({ start: { x: MARGIN, y: y - rowHeight }, end: { x: A4_WIDTH_POINTS - MARGIN, y: y - rowHeight }, thickness: 0.45, color: LINE });
      y -= rowHeight;
    });
    y -= 11;
  };

  const noteBlocks = (items: Array<{ label: string; text: string }>) => {
    const visible = items.filter((item) => item.text.trim());
    if (!visible.length) return;
    sectionTitle(tr("备注与服务说明", "NOTES & SERVICE INFORMATION"), english ? undefined : "NOTES & SERVICE INFORMATION");
    for (const item of visible) {
      const lines = wrapText(item.text, font, 7.4, CONTENT_WIDTH - 112);
      const height = Math.max(28, lines.length * 10 + 10);
      ensure(height, () => sectionTitle(tr("备注与服务说明（续）", "NOTES & SERVICE INFORMATION (CONTINUED)"), english ? undefined : "NOTES & SERVICE INFORMATION"));
      page.drawRectangle({ x: MARGIN, y: y - height, width: 104, height, color: SOFT, borderColor: LINE, borderWidth: 0.45 });
      page.drawRectangle({ x: MARGIN + 104, y: y - height, width: CONTENT_WIDTH - 104, height, borderColor: LINE, borderWidth: 0.45 });
      drawText(item.label, MARGIN + 7, y - 16, 6.8, BLUE_DARK);
      lines.forEach((line, index) => drawText(line, MARGIN + 111, y - 15 - index * 10, 7.4, INK));
      y -= height;
    }
    y -= 11;
  };

  const problemBlocks = (items: Array<{ label: string; text: string }>) => {
    const visible = items.filter((item) => item.text.trim());
    if (!visible.length) return;
    sectionTitle(tr("问题描述", "PROBLEM DESCRIPTION"), english ? undefined : "PROBLEM DESCRIPTION");
    visible.forEach((item) => {
      const lines = wrapText(item.text, font, 8.1, CONTENT_WIDTH - 112);
      const height = Math.max(32, lines.length * 11 + 12);
      ensure(height, () => sectionTitle(tr("问题描述（续）", "PROBLEM DESCRIPTION (CONTINUED)"), english ? undefined : "PROBLEM DESCRIPTION"));
      page.drawRectangle({ x: MARGIN, y: y - height, width: 104, height, color: SOFT, borderColor: LINE, borderWidth: 0.45 });
      page.drawRectangle({ x: MARGIN + 104, y: y - height, width: CONTENT_WIDTH - 104, height, borderColor: LINE, borderWidth: 0.45 });
      drawText(item.label, MARGIN + 7, y - 17, 6.8, BLUE_DARK);
      lines.forEach((line, index) => drawText(line, MARGIN + 111, y - 17 - index * 11, 8.1, INK));
      y -= height;
    });
    y -= 11;
  };

  const signatureBlock = (statementZh: string, statementEn: string) => {
    const zh = wrapText(statementZh, font, 6.5, CONTENT_WIDTH - 14);
    const en = wrapText(statementEn, font, 5.9, CONTENT_WIDTH - 14);
    const statementHeight = Math.max(30, zh.length * 8 + en.length * 7 + 8);
    ensure(statementHeight + 59);
    sectionTitle(tr("确认与签字", "ACKNOWLEDGEMENT & SIGNATURE"), english ? undefined : "ACKNOWLEDGEMENT & SIGNATURE");
    page.drawRectangle({ x: MARGIN, y: y - statementHeight, width: CONTENT_WIDTH, height: statementHeight, color: SOFT, borderColor: LINE, borderWidth: 0.5 });
    zh.forEach((line, index) => drawText(line, MARGIN + 7, y - 10 - index * 8, 6.5, INK));
    const enStart = y - 10 - zh.length * 8 - 1;
    en.forEach((line, index) => drawText(line, MARGIN + 7, enStart - index * 7, 5.9, MUTED));
    y -= statementHeight + 4;
    const widths = [CONTENT_WIDTH * 0.45, CONTENT_WIDTH * 0.28, CONTENT_WIDTH * 0.27];
    const labels = english
      ? ["CUSTOMER SIGNATURE", "DATE", "SERVICE ADVISOR"]
      : ["客户签字 / CUSTOMER SIGNATURE", "日期 / DATE", "前台经办 / SERVICE ADVISOR"];
    let x = MARGIN;
    labels.forEach((label, index) => {
      page.drawRectangle({ x, y: y - 32, width: widths[index], height: 32, borderColor: LINE, borderWidth: 0.55 });
      drawText(label, x + 6, y - 27, 5.5, MUTED);
      page.drawLine({ start: { x: x + 6, y: y - 18 }, end: { x: x + widths[index] - 6, y: y - 18 }, thickness: 0.45, color: LINE });
      x += widths[index];
    });
    y -= 38;
  };

  addPage();

  if (input.snapshot.kind === "mechanic_work") {
    const snapshot = input.snapshot;
    infoGrid([
      { label: "BUSINESS ORDER", value: value("facts.orderNo", snapshot.businessOrder.orderNo) },
      { label: "车辆 / VEHICLE", value: value("facts.vehicle", `${snapshot.vehicle.plate} · ${snapshot.vehicle.description}`) },
      { label: "VIN", value: value("facts.vin", snapshot.vehicle.vin ?? "未记录") },
      { label: "维修轮次 / REPAIR ROUND", value: value("facts.repairRound", `第 ${snapshot.repairRound.roundNo} 轮维修`) },
      { label: "维修班组 / TEAM", value: value("facts.team", snapshot.repairRound.teamName ?? "未派单") },
      { label: "单据日期 / DATE", value: documentDate(input.documentNo) },
    ]);
    if (snapshot.version === 2) {
      problemBlocks([
        { label: "本轮问题", text: value("problemDescription.primaryZh", snapshot.problemDescription.primary.contentZh ?? "") },
        ...(snapshot.problemDescription.originalContext ? [{ label: "整单原始问题", text: value("problemDescription.originalZh", snapshot.problemDescription.originalContext.contentZh ?? "") }] : []),
      ]);
    }
    table(
      { primary: "施工项目", secondary: "WORK ITEMS" },
      ["完成", "类别", "项目名称", "工作说明", "数量"],
      [38, 48, 128, 251, 70],
      snapshot.workItems.map((item, index) => [
        { text: "□", align: "center", color: BLUE_DARK },
        { text: item.kind === "labor" ? "工时" : item.kind === "part" ? "配件" : "其他" },
        { text: value(`workItems.${index}.nameZh`, item.nameZh) },
        { text: value(`workItems.${index}.descriptionZh`, item.descriptionZh ?? "—") || "—" },
        { text: value(`workItems.${index}.quantity`, `${item.quantity} ${item.unitLabelZh}`), align: "right" },
      ]),
    );
    noteBlocks(snapshot.notes.map((note, index) => ({
      label: note.kind === "customer_concern" ? "客户诉求" : note.kind === "work_instruction" ? "施工说明" : "责任与提前告知",
      text: value(`notes.${index}.contentZh`, note.contentZh),
    })));
    sectionTitle("维修回单", "WORK COMPLETION");
    ensure(104);
    page.drawRectangle({ x: MARGIN, y: y - 54, width: CONTENT_WIDTH, height: 54, borderColor: LINE, borderWidth: 0.55 });
    drawText("实际完成内容 / WORK COMPLETED", MARGIN + 7, y - 14, 6.4, MUTED);
    [29, 43].forEach((offset) => page.drawLine({ start: { x: MARGIN + 7, y: y - offset }, end: { x: A4_WIDTH_POINTS - MARGIN - 7, y: y - offset }, thickness: 0.35, color: LINE }));
    y -= 63;
    infoGrid([
      { label: "维修人员签字 / TECHNICIAN", value: " " },
      { label: "完工日期 / DATE", value: " " },
      { label: "前台复核 / REVIEWED BY", value: " " },
    ]);
  } else {
    const snapshot = input.snapshot;
    const order = snapshot.businessOrder;
    infoGrid([
      { label: "BUSINESS ORDER", value: value("facts.orderNo", order.orderNo) },
      { label: tr("费用承担方 / PAYER", "PAYER"), value: english ? (englishBusinessDocumentName(order.payerName) ?? "") : value("facts.payer.value", order.payerName) },
      { label: tr("联系电话 / CONTACT", "CONTACT"), value: localizedValue("facts.contact.value", order.payerPhone ?? "未记录", order.payerPhone ?? "NOT RECORDED") },
      { label: tr("车辆 / VEHICLE", "VEHICLE"), value: value("facts.vehicle.value", `${order.plate} · ${order.vehicleDescription}`) },
      { label: "VIN", value: localizedValue("facts.vin.value", order.vin ?? "未记录", order.vin ?? "NOT RECORDED") },
      { label: "TRN", value: localizedValue("facts.trn.value", order.payerTrn ?? "未记录", order.payerTrn ?? "NOT RECORDED") },
    ]);
    if (snapshot.version === 2) {
      const originalText = english
        ? value("problemDescription.originalEn", snapshot.problemDescription.original.contentEn ?? "")
        : [value("problemDescription.originalZh", snapshot.problemDescription.original.contentZh ?? ""), snapshot.problemDescription.original.contentEn ?? ""].filter(Boolean).join("\n");
      const round = snapshot.problemDescription.repairRound;
      const roundText = round ? (english
        ? value("problemDescription.roundEn", round.contentEn ?? "")
        : [value("problemDescription.roundZh", round.contentZh ?? ""), round.contentEn ?? ""].filter(Boolean).join("\n")) : "";
      const originalPair = `${snapshot.problemDescription.original.contentZh?.trim() ?? ""}\u0000${snapshot.problemDescription.original.contentEn?.trim() ?? ""}`;
      const roundPair = `${round?.contentZh?.trim() ?? ""}\u0000${round?.contentEn?.trim() ?? ""}`;
      problemBlocks([
        { label: tr("原始问题", "ORIGINAL PROBLEM"), text: originalText },
        ...(round && roundPair !== originalPair ? [{ label: tr("本轮问题", "THIS REPAIR ROUND"), text: roundText }] : []),
      ]);
    }
    table(
      { primary: tr("收费项目", "SERVICE CHARGES"), secondary: english ? undefined : "SERVICE CHARGES" },
      english
        ? ["TYPE", "ITEM", "DESCRIPTION", "QTY", "UNIT PRICE", "DISCOUNT", "SUBTOTAL"]
        : ["类别", "项目 / ITEM", "说明 / DESCRIPTION", "数量", "含税单价", "折扣", "小计"],
      [42, 98, 143, 48, 72, 60, 72],
      snapshot.charges.items.map((item, index) => [
        { text: english ? (item.kind === "labor" ? "LABOR" : item.kind === "part" ? "PART" : "OTHER") : (item.kind === "labor" ? "工时\nLABOR" : item.kind === "part" ? "配件\nPART" : "其他\nOTHER"), color: MUTED },
        { text: english ? (item.nameEn ?? "") : `${value(`charges.items.${index}.nameZh`, item.nameZh)}${item.nameEn ? `\n${item.nameEn}` : ""}` },
        { text: english ? (item.descriptionEn ?? "—") : (`${value(`charges.items.${index}.descriptionZh`, item.descriptionZh ?? "")}${item.descriptionEn ? `\n${item.descriptionEn}` : ""}` || "—") },
        { text: english ? `${item.quantity} ${item.unitLabelEn}` : value(`charges.items.${index}.quantity`, `${item.quantity} ${item.unitLabelZh}`), align: "right" },
        { text: value(`charges.items.${index}.unitPrice`, money(item.unitPriceMinor)), align: "right" },
        { text: value(`charges.items.${index}.discount`, money(item.itemDiscountMinor)), align: "right", color: item.itemDiscountMinor ? BLUE : MUTED },
        { text: value(`charges.items.${index}.subtotal`, money(item.subtotalMinor)), align: "right" },
      ]),
      { fontSize: 6.8, headerSize: 5.7, minimumRowHeight: 27 },
    );

    sectionTitle(tr("结算汇总", "ACCOUNT SUMMARY"), english ? undefined : "ACCOUNT SUMMARY");
    infoGrid([
      { label: tr("收费原价 / GROSS", "GROSS"), value: money(snapshot.charges.totals.grossMinor) },
      { label: tr("项目折扣 / DISCOUNT", "DISCOUNT"), value: `−${money(snapshot.charges.totals.lineDiscountMinor)}` },
      { label: tr("折后应收 / AMOUNT DUE", "AMOUNT DUE"), value: value("totals.currentDue", money(snapshot.totals.currentDueMinor)) },
      { label: tr("累计收款 / PAID", "TOTAL PAID"), value: value("totals.totalPaid", money(snapshot.totals.totalPaidMinor)) },
      { label: tr("累计退款 / REFUNDED", "TOTAL REFUNDED"), value: value("totals.totalRefunded", money(snapshot.totals.totalRefundedMinor)) },
      { label: tr("未结余额 / BALANCE", "BALANCE"), value: value("totals.balance", money(snapshot.totals.balanceMinor)) },
    ]);

    if (snapshot.transactions.length) {
      table(
        { primary: tr("收付款记录", "PAYMENT HISTORY"), secondary: english ? undefined : "PAYMENT HISTORY" },
        english ? ["TYPE", "REFERENCE", "METHOD", "DATE", "NOTE", "AMOUNT"] : ["类型", "编号", "方式", "日期", "备注", "金额"],
        [45, 105, 80, 84, 141, 80],
        snapshot.transactions.map((transaction) => [
          { text: transaction.type === "payment" ? tr("收款", "PAYMENT") : tr("退款", "REFUND"), color: transaction.type === "payment" ? BLUE_DARK : MUTED },
          { text: transaction.referenceNo },
          { text: english ? (transaction.methodLabelEn ?? "") : `${transaction.methodLabelZh}${transaction.methodLabelEn ? `\n${transaction.methodLabelEn}` : ""}` },
          { text: transaction.occurredAt.slice(0, 10) },
          { text: english ? "—" : (transaction.note ?? "—") },
          { text: money(transaction.amountMinor), align: "right" },
        ]),
        { fontSize: 6.8, headerSize: 5.9 },
      );
    }

    noteBlocks(snapshot.charges.notes.map((note, index) => {
      const label = note.kind === "customer_concern" ? tr("客户诉求", "CUSTOMER CONCERN") : note.kind === "work_instruction" ? tr("施工说明", "WORK INSTRUCTION") : note.kind === "liability_notice" ? tr("责任与提前告知", "NOTICE & RESPONSIBILITY") : tr("内部备注", "INTERNAL NOTE");
      const zh = value(`notes.${index}.contentZh`, note.contentZh ?? "");
      const en = value(`notes.${index}.contentEn`, note.contentEn ?? "");
      return { label, text: english ? en : [zh, en].filter(Boolean).join("\n") };
    }));
    signatureBlock(
      localizedValue("approval.statementZh", snapshot.approval.statementZh, snapshot.approval.statementEn),
      english ? "" : value("approval.statementEn", snapshot.approval.statementEn),
    );
  }

  pages.forEach((currentPage, index) => {
    const footer = `Whole Hearted Car Service Limited  ·  ${input.documentNo}  ·  R${input.revisionNo}`;
    currentPage.drawLine({ start: { x: MARGIN, y: 31 }, end: { x: A4_WIDTH_POINTS - MARGIN, y: 31 }, thickness: 0.45, color: LINE });
    currentPage.drawText(footer, { x: MARGIN, y: 19, size: 6.2, font, color: MUTED });
    const pageNo = `${index + 1} / ${pages.length}`;
    currentPage.drawText(pageNo, { x: A4_WIDTH_POINTS - MARGIN - font.widthOfTextAtSize(pageNo, 6.2), y: 19, size: 6.2, font, color: MUTED });
  });
  return document.save({ useObjectStreams: false, addDefaultPage: false, objectsPerTick: 50 });
}
