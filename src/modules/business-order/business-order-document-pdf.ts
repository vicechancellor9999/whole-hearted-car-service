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

export const BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION = "bo-a4-v20-complete-identity";
export const A4_WIDTH_POINTS = 595.28;
export const A4_HEIGHT_POINTS = 841.89;

const MARGIN = 30;
const CONTENT_WIDTH = A4_WIDTH_POINTS - MARGIN * 2;
const PAGE_BOTTOM = 42;
const BLUE = rgb(0.06, 0.37, 0.82);
const BLUE_DARK = rgb(0.09, 0.14, 0.21);
const INK = rgb(0.16, 0.20, 0.25);
const MUTED = rgb(0.39, 0.42, 0.46);
const LINE = rgb(0.80, 0.82, 0.84);
const SOFT = rgb(0.965, 0.97, 0.975);

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

type TableCell = { text: string; align?: "left" | "right" | "center"; color?: RGB; noWrap?: boolean };

async function readDocumentAsset(fileName: string) {
  // Next starts in apps/web; scripts and backend tests start at the repository root.
  try {
    return await readFile(path.join(process.cwd(), "public", fileName));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    return readFile(path.join(process.cwd(), "apps/web/public", fileName));
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const result: string[] = [];
  for (const paragraph of String(text ?? "").replaceAll("\r\n", "\n").split("\n")) {
    if (!paragraph) { result.push(""); continue; }
    let line = "";
    const tokens = paragraph.match(/[^\s\u3400-\u9fff]+|[\u3400-\u9fff]|\s+/gu) ?? [];
    for (const token of tokens) {
      if (line && !/^[。，；：！？、）】》]/u.test(token) && font.widthOfTextAtSize(line + token, size) > maxWidth) {
        result.push(line.trimEnd());
        line = "";
      }
      if (!line && !token.trim()) continue;
      for (const character of token) {
        if (line && font.widthOfTextAtSize(line + character, size) > maxWidth) {
          const preceding = Array.from(line);
          if (/^[。，；：！？、）】》]$/u.test(character) && preceding.length > 1) {
            line = preceding.pop()!;
            result.push(preceding.join("").trimEnd());
          } else {
            result.push(line.trimEnd());
            line = "";
          }
        }
        line += character;
      }
    }
    result.push(line);
  }
  return result.length ? result : [""];
}

function money(minor: number): string {
  return `JMD ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function printedMoneyMinor(text: string): number | null {
  const match = text.trim().match(/^(?:JMD\s+)?(-?)(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/iu);
  if (!match) return null;
  const amount = (Number(match[2].replaceAll(",", "")) * 100 + Number((match[3] ?? "").padEnd(2, "0"))) * (match[1] ? -1 : 1);
  return Number.isSafeInteger(amount) ? amount : null;
}

function quantityColumns(quantity: string, unit: string, override?: string): [string, string] {
  const text = override ?? `${quantity} ${unit}`;
  const match = text.trim().match(/^([+-]?\d+)(?:\.(\d+))?(?:\s+(.*))?$/u);
  if (!match) return [text, ""];
  const fraction = match[2]?.replace(/0+$/, "");
  // Remove storage padding, never round an actual fractional quantity.
  return [`${match[1]}${fraction ? `.${fraction}` : ""}`, match[3] ?? ""];
}

function documentDate(documentNo: string): string {
  const match = documentNo.match(/-(\d{4})(\d{2})(\d{2})-/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : "—";
}

function kindTitle(kind: BusinessOrderDocumentRenderSnapshot["kind"], language: "zh" | "en"): { primary: string; secondary: string } {
  if (kind === "mechanic_work") return { primary: "维修施工单", secondary: "WORK ORDER" };
  if (language === "en") return { primary: "SERVICE AUTHORIZATION", secondary: kind === "office_archive" ? "OFFICE COPY" : "CUSTOMER COPY" };
  return { primary: "维修费用与责任确认单", secondary: kind === "office_archive" ? "办公室联" : "客户联" };
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
    if (item.kind !== "labor" && !item.unitLabelEn?.trim()) missing.push(`收费项目 ${index + 1} 单位`);
  });
  snapshot.charges.notes.forEach((note, index) => {
    if (note.contentZh?.trim() && !note.contentEn?.trim()) missing.push(`备注 ${index + 1}`);
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

  const [fontBytes, logoBytes, displayFontBytes] = await Promise.all([
    readDocumentAsset("fonts/NotoSansSC-Regular-wh.ttf"),
    readDocumentAsset("logo-icon.png"),
    readDocumentAsset("fonts/LiberationSans-Bold.ttf"),
  ]);
  const font = await document.embedFont(Uint8Array.from(fontBytes), { subset: false });
  const displayFont = await document.embedFont(Uint8Array.from(displayFontBytes), { subset: true });
  const logo = await document.embedPng(Uint8Array.from(logoBytes));
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  let copyKind = input.snapshot.kind;
  let copyStartPage = 0;

  // The display face is used for Latin headings and figures only; CJK keeps its embedded font.
  const face = (text: string, display: boolean) => display && /^[\x20-\x7e]*$/u.test(text) ? displayFont : font;
  const drawText = (text: string, x: number, baseline: number, size = 8, color = INK, maxWidth?: number, align: "left" | "right" | "center" = "left", display = false) => {
    let tx = x;
    const selectedFont = face(text, display);
    const width = selectedFont.widthOfTextAtSize(text, size);
    if (maxWidth && align === "right") tx = x + maxWidth - width;
    if (maxWidth && align === "center") tx = x + (maxWidth - width) / 2;
    page.drawText(text || " ", { x: tx, y: baseline, size, font: selectedFont, color });
  };

  const fittedSize = (text: string, size: number, width: number, display = false) => Math.min(size, size * width / Math.max(1, face(text, display).widthOfTextAtSize(text, size)));

  const amountSummary = (label: string, amount: string, details: Array<{ label: string; value: string }>) => {
    ensure(72);
    const split = 266;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 1.1, color: BLUE_DARK });
    details.forEach((detail, index) => {
      const baseline = y - 23 - index * 18;
      drawText(detail.label, MARGIN, baseline, 7.5, MUTED);
      drawText(detail.value, MARGIN + 110, baseline, fittedSize(detail.value, 9, split - 144), INK, split - 144, "right");
    });
    drawText(label, MARGIN + split, y - 19, 7.5, BLUE, CONTENT_WIDTH - split, "right", true);
    drawText(amount, MARGIN + split, y - 46, fittedSize(amount, 25, CONTENT_WIDTH - split, true), BLUE, CONTENT_WIDTH - split, "right", true);
    y -= 72;
  };

  const drawHeader = (continued: boolean) => {
    const title = kindTitle(copyKind, language);
    const logoSize = continued ? 25 : 32;
    const headerTop = A4_HEIGHT_POINTS - MARGIN;
    page.drawImage(logo, { x: MARGIN, y: headerTop - logoSize, width: logoSize, height: logoSize });
    drawText("Whole Hearted Car Service Limited", MARGIN + logoSize + 10, headerTop - 10, continued ? 10 : 11, BLUE_DARK, undefined, "left", true);
    drawText("16 Ferry Pen, Kingston, Jamaica", MARGIN + logoSize + 10, headerTop - 23, 7, MUTED);
    if (!continued) {
      drawText("1 876-899-3924 / 1 876-333-3322", MARGIN, headerTop - 10, 7, MUTED, CONTENT_WIDTH, "right");
      drawText("TRN 003650332", MARGIN, headerTop - 23, 7, MUTED, CONTENT_WIDTH, "right");
    }
    const titleBaseline = headerTop - (continued ? 49 : 61);
    drawText(title.primary, MARGIN, titleBaseline, continued ? 16 : 21, BLUE_DARK, undefined, "left", true);
    drawText(title.secondary, MARGIN, titleBaseline + 2, 8, BLUE, CONTENT_WIDTH, "right", true);
    drawText(`${input.documentNo}  ·  R${input.revisionNo}${continued ? tr("  ·  续页", "  ·  CONTINUED") : ""}`, MARGIN, titleBaseline - 16, 7, MUTED, CONTENT_WIDTH, "right");
    y = titleBaseline - 16;
    if (input.snapshot.kind !== "mechanic_work") {
      drawText(tr("费用与责任确认 · 非税务发票", "Fee and responsibility confirmation · NOT A TAX INVOICE"), MARGIN, y, 7, MUTED);
    }
    page.drawLine({ start: { x: MARGIN, y: y - 12 }, end: { x: A4_WIDTH_POINTS - MARGIN, y: y - 12 }, thickness: 0.65, color: LINE });
    y -= 23;
  };

  const addPage = () => {
    page = document.addPage([A4_WIDTH_POINTS, A4_HEIGHT_POINTS]);
    pages.push(page);
    drawHeader(pages.length > copyStartPage + 1);
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
    drawText(primary, MARGIN, y, 10, BLUE_DARK, undefined, "left", true);
    if (secondary) drawText(secondary, MARGIN + 90, y + 0.2, 6.5, MUTED);
    y -= 16;
  };

  const infoGrid = (cells: Array<{ label: string; value: string }>, columns = 3) => {
    const cellWidth = CONTENT_WIDTH / columns;
    const rows = Array.from({ length: Math.ceil(cells.length / columns) }, (_, index) => {
      const row = cells.slice(index * columns, (index + 1) * columns).map((cell) => ({ ...cell, lines: wrapText(cell.value || "—", font, 8.1, cellWidth - 14) }));
      const lineCount = Math.max(...row.map((cell) => cell.lines.length));
      return { cells: row, lineCount, height: Math.max(34, lineCount * 9 + 16) };
    });
    const freshCapacity = A4_HEIGHT_POINTS - MARGIN - 49 - 16 - 23 - PAGE_BOTTOM;
    const gridHeight = rows.reduce((sum, row) => sum + row.height, 0);
    // Keep ordinary metadata together; exceptionally long identities flow to
    // continuation sheets rather than being truncated or crossing the footer.
    ensure(gridHeight + 2 <= freshCapacity ? gridHeight + 2 : 34);
    for (const row of rows) {
      ensure(row.height <= freshCapacity ? row.height : 34);
      let offset = 0;
      while (offset < row.lineCount) {
        const count = Math.min(row.lineCount - offset, Math.floor((y - PAGE_BOTTOM - 16) / 9));
        if (count < 1) { addPage(); continue; }
        const height = Math.max(34, count * 9 + 16);
        row.cells.forEach((cell, column) => {
          if (offset >= cell.lines.length) return;
          const x = MARGIN + column * cellWidth;
          if (!cell.value.trim()) page.drawLine({ start: { x, y: y - height }, end: { x: x + cellWidth - 20, y: y - height }, color: LINE, thickness: 0.6 });
          drawText(`${cell.label}${offset ? tr("（续）", " (CONTINUED)") : ""}`, x, y - 8, 6.8, MUTED);
          cell.lines.slice(offset, offset + count).forEach((line, index) => drawText(line, x, y - 21 - index * 9, 8.1, INK));
        });
        y -= height;
        offset += count;
        if (offset < row.lineCount) addPage();
      }
    }
    y -= 12;
  };

  const table = (
    section: { primary: string; secondary?: string },
    headers: string[],
    widths: number[],
    rows: TableCell[][],
    options: { fontSize?: number; headerSize?: number; minimumRowHeight?: number; footer?: { label: string; value: string } } = {},
  ) => {
    const fontSize = options.fontSize ?? 7.2;
    const headerSize = options.headerSize ?? 6.4;
    const headerHeight = 20;
    const minimumRowHeight = options.minimumRowHeight ?? 24;
    const drawTableHeader = () => {
      ensure(headerHeight + 2);
      page.drawRectangle({ x: MARGIN, y: y - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: SOFT });
      let x = MARGIN;
      headers.forEach((header, index) => {
        drawText(header, x + 5, y - 13, headerSize, MUTED, widths[index] - 10, rows[0]?.[index]?.align ?? "left");
        x += widths[index];
      });
      y -= headerHeight;
    };
    const cellLines = (cell: TableCell, index: number) => cell.noWrap ? [cell.text] : wrapText(cell.text, font, fontSize, widths[index] - 10);
    const firstRowHeight = rows[0] ? Math.max(minimumRowHeight, Math.max(...rows[0].map((cell, index) => cellLines(cell, index).length)) * (fontSize + 3) + 10) : 0;
    const freshRowCapacity = A4_HEIGHT_POINTS - MARGIN - 49 - 16 - 23 - 19 - headerHeight - PAGE_BOTTOM;
    ensure(19 + headerHeight + (firstRowHeight > freshRowCapacity ? minimumRowHeight : firstRowHeight) + (rows.length === 1 && options.footer ? 25 : 0));
    sectionTitle(section.primary, section.secondary);
    drawTableHeader();
    rows.forEach((row, rowIndex) => {
      const linesByCell = row.map(cellLines);
      const rowHeight = Math.max(minimumRowHeight, Math.max(...linesByCell.map((lines) => lines.length)) * (fontSize + 3) + 10);
      const continuedHeader = () => { sectionTitle(`${section.primary}${tr("（续）", " (CONTINUED)")}`, section.secondary); drawTableHeader(); };
      const reservedHeight = rowHeight + (rowIndex === rows.length - 1 && options.footer ? 25 : 0);
      ensure(reservedHeight > freshRowCapacity ? minimumRowHeight : reservedHeight, continuedHeader);
      const lineCount = Math.max(...linesByCell.map((lines) => lines.length));
      let offset = 0;
      while (offset < lineCount) {
        const count = Math.min(lineCount - offset, Math.floor((y - PAGE_BOTTOM - 10) / (fontSize + 3)));
        if (count < 1) { addPage(); continuedHeader(); continue; }
        const fragmentHeight = Math.max(minimumRowHeight, count * (fontSize + 3) + 10);
        let x = MARGIN;
        row.forEach((cell, index) => {
          const size = cell.noWrap ? fittedSize(cell.text, fontSize, widths[index] - 10) : fontSize;
          linesByCell[index].slice(offset, offset + count).forEach((line, lineIndex) => drawText(line, x + 5, y - 13 - lineIndex * (fontSize + 3), size, cell.color ?? INK, widths[index] - 10, cell.align ?? "left"));
          x += widths[index];
        });
        page.drawLine({ start: { x: MARGIN, y: y - fragmentHeight }, end: { x: A4_WIDTH_POINTS - MARGIN, y: y - fragmentHeight }, thickness: 0.45, color: LINE });
        y -= fragmentHeight;
        offset += count;
        if (offset < lineCount) { addPage(); continuedHeader(); }
      }
    });
    if (options.footer) {
      ensure(25, () => sectionTitle(`${section.primary}${tr("（续）", " (CONTINUED)")}`, section.secondary));
      drawText(options.footer.label, MARGIN + 5, y - 16, 8, MUTED);
      drawText(options.footer.value, MARGIN + 5, y - 17, 11, BLUE_DARK, CONTENT_WIDTH - 10, "right", true);
      y -= 25;
    }
    y -= 11;
  };

  // A paragraph can be taller than an entire sheet. Consume bounded fragments
  // instead of moving the whole paragraph once and drawing beyond the footer.
  const flowingLines = (lines: string[], options: { size: number; leading: number; x: number; top: number; padding: number; minimum: number; onNewPage: () => void; beforeFragment?: () => void }) => {
    const freshCapacity = A4_HEIGHT_POINTS - MARGIN - 49 - 16 - 23 - 19 - PAGE_BOTTOM;
    const height = Math.max(options.minimum, lines.length * options.leading + options.padding);
    ensure(height > freshCapacity ? options.minimum : height, options.onNewPage);
    let offset = 0;
    while (offset < lines.length) {
      const count = Math.min(lines.length - offset, Math.floor((y - PAGE_BOTTOM - options.padding) / options.leading));
      if (count < 1) { addPage(); options.onNewPage(); continue; }
      options.beforeFragment?.();
      lines.slice(offset, offset + count).forEach((line, index) => drawText(line, options.x, y - options.top - index * options.leading, options.size, INK));
      y -= Math.max(options.minimum, count * options.leading + options.padding);
      offset += count;
      if (offset < lines.length) { addPage(); options.onNewPage(); }
    }
  };

  const noteBlocks = (items: Array<{ label: string; text: string }>) => {
    const visible = items.filter((item) => item.text.trim());
    if (!visible.length) return;
    sectionTitle(tr("备注与服务说明", "NOTES & SERVICE INFORMATION"));
    for (const item of visible) {
      const lines = wrapText(item.text, font, 8, CONTENT_WIDTH - 112);
      flowingLines(lines, { size: 8, leading: 11, x: MARGIN + 112, top: 12, padding: 7, minimum: 25,
        onNewPage: () => sectionTitle(tr("备注与服务说明（续）", "NOTES & SERVICE INFORMATION (CONTINUED)")),
        beforeFragment: () => drawText(item.label, MARGIN, y - 12, 7, MUTED),
      });
    }
    y -= 11;
  };

  const problemBlocks = (items: Array<{ label: string; text: string }>) => {
    const visible = items.filter((item) => item.text.trim());
    if (!visible.length) return;
    sectionTitle(tr("问题描述", "PROBLEM DESCRIPTION"));
    visible.forEach((item) => {
      const lines = wrapText(item.text, font, 8.1, CONTENT_WIDTH - 112);
      flowingLines(lines, { size: 8.1, leading: 11, x: MARGIN + 112, top: 13, padding: 12, minimum: 32,
        onNewPage: () => sectionTitle(tr("问题描述（续）", "PROBLEM DESCRIPTION (CONTINUED)")),
        beforeFragment: () => drawText(item.label, MARGIN, y - 13, 7, MUTED),
      });
    });
    y -= 11;
  };

  const signatureBlock = (statementZh: string, statementEn: string) => {
    const zh = wrapText(statementZh, font, 7.5, CONTENT_WIDTH);
    const en = statementEn.trim() ? wrapText(statementEn, font, 7.5, CONTENT_WIDTH) : [];
    const statementHeight = (zh.length + en.length) * 10.5 + 6;
    ensure(Math.min(statementHeight + 59, 100));
    sectionTitle(tr("确认与签字", "ACKNOWLEDGEMENT & SIGNATURE"));
    flowingLines([...zh, ...en], { size: 7.5, leading: 10.5, x: MARGIN, top: 10, padding: 6, minimum: 17,
      onNewPage: () => sectionTitle(tr("确认与签字（续）", "ACKNOWLEDGEMENT & SIGNATURE (CONTINUED)")),
    });
    y -= 4;
    ensure(38, () => sectionTitle(tr("确认与签字（续）", "ACKNOWLEDGEMENT & SIGNATURE (CONTINUED)")));
    const widths = [CONTENT_WIDTH * 0.45, CONTENT_WIDTH * 0.28, CONTENT_WIDTH * 0.27];
    const labels = english
      ? ["CUSTOMER SIGNATURE", "DATE", "SERVICE ADVISOR"]
      : ["客户签字", "日期", "前台经办"];
    let x = MARGIN;
    labels.forEach((label, index) => {
      drawText(label, x, y - 35, 6.8, MUTED);
      page.drawLine({ start: { x, y: y - 23 }, end: { x: x + widths[index] - 20, y: y - 23 }, thickness: 0.6, color: LINE });
      x += widths[index];
    });
    y -= 38;
  };

  // Both recipients get the exact same frozen facts and manual overrides in one
  // immutable, single-language file. Legacy office-only snapshots stay readable.
  const copies = input.snapshot.kind === "customer_copy"
    ? ["office_archive", "customer_copy"] as const
    : [input.snapshot.kind];
  for (const kind of copies) {
    copyKind = kind;
    copyStartPage = pages.length;
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
    amountSummary("本单本轮绩效 / ORDER & ROUND PERFORMANCE", snapshot.repairRound.performanceMinor == null ? "待填写" : money(snapshot.repairRound.performanceMinor), [
      { label: "状态 / STATUS", value: snapshot.repairRound.performanceSource === "handoff" ? "已交单绩效" : snapshot.repairRound.performanceSource === "draft" ? "本轮预设绩效" : "尚未记录" },
      { label: "范围 / SCOPE", value: `本业务单 · 第 ${snapshot.repairRound.roundNo} 轮维修` },
    ]);
    for (const kind of ["labor", "part", "other"] as const) {
      const items = snapshot.workItems.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === kind);
      if (!items.length) continue;
      table(
      { primary: `${kind === "labor" ? "工时项目" : kind === "part" ? "配件项目" : "其他项目"} · ${items.length} 项`, secondary: kind === "labor" ? "LABOR" : kind === "part" ? "PARTS" : "OTHER" },
      ["完成", "项目名称", "工作说明", "数量", "单位"],
      [38, 145, 267, 40, 45],
      items.map(({ item, index }) => {
        const [quantity, unit] = quantityColumns(item.quantity, item.unitLabelZh, overrides[`workItems.${index}.quantity`]);
        return [
        { text: "□", align: "center", color: BLUE_DARK },
        { text: value(`workItems.${index}.nameZh`, item.nameZh) },
        { text: value(`workItems.${index}.descriptionZh`, item.descriptionZh ?? "—") || "—" },
        { text: quantity, align: "right" },
        { text: kind === "labor" ? "JOB" : unit },
      ]; }),
    );
    }
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
      { label: tr("业务单号", "BUSINESS ORDER"), value: value("facts.orderNo", order.orderNo) },
      { label: tr("费用承担方", "PAYER"), value: english ? (englishBusinessDocumentName(order.payerName) ?? "") : (value("facts.payer.value", order.payerName).split("/").map((part) => part.trim()).find((part) => /[\u3400-\u9fff]/u.test(part)) ?? value("facts.payer.value", order.payerName)) },
      { label: tr("联系电话", "CONTACT"), value: localizedValue("facts.contact.value", order.payerPhone ?? "未记录", order.payerPhone ?? "NOT RECORDED") },
      { label: tr("车辆", "VEHICLE"), value: value("facts.vehicle.value", `${order.plate} · ${order.vehicleDescription}`) },
      { label: "VIN", value: localizedValue("facts.vin.value", order.vin ?? "未记录", order.vin ?? "NOT RECORDED") },
      { label: "TRN", value: localizedValue("facts.trn.value", order.payerTrn ?? "未记录", order.payerTrn ?? "NOT RECORDED") },
    ]);
    if (snapshot.version === 2) {
      const originalText = english
        ? value("problemDescription.originalEn", snapshot.problemDescription.original.contentEn ?? "")
        : value("problemDescription.originalZh", snapshot.problemDescription.original.contentZh ?? "");
      const round = snapshot.problemDescription.repairRound;
      const roundText = round ? (english
        ? value("problemDescription.roundEn", round.contentEn ?? "")
        : value("problemDescription.roundZh", round.contentZh ?? "")) : "";
      const originalPair = `${snapshot.problemDescription.original.contentZh?.trim() ?? ""}\u0000${snapshot.problemDescription.original.contentEn?.trim() ?? ""}`;
      const roundPair = `${round?.contentZh?.trim() ?? ""}\u0000${round?.contentEn?.trim() ?? ""}`;
      problemBlocks([
        { label: tr("原始问题", "ORIGINAL PROBLEM"), text: originalText },
        ...(round && roundPair !== originalPair ? [{ label: tr("本轮问题", "THIS REPAIR ROUND"), text: roundText }] : []),
      ]);
    }
    for (const kind of ["labor", "part", "other"] as const) {
      const items = snapshot.charges.items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === kind);
      const discount = kind === "labor" ? snapshot.charges.totals.laborDiscountMinor : kind === "part" ? snapshot.charges.totals.partDiscountMinor : snapshot.charges.totals.otherDiscountMinor;
      if (!items.length && !discount) continue;
      const label = kind === "labor" ? tr("工时", "LABOR") : kind === "part" ? tr("配件", "PARTS") : tr("其他", "OTHER");
      const pendingCount = items.filter(({ item }) => item.pendingQuote).length;
      const printedSubtotals = items.map(({ item, index }) => {
        const printed = value(`charges.items.${index}.subtotal`, money(item.subtotalMinor));
        return item.pendingQuote && printed === "—" ? 0 : printedMoneyMinor(printed);
      });
      const total = printedSubtotals.some((subtotal) => subtotal === null)
        ? null
        : printedSubtotals.reduce<number>((sum, subtotal) => sum + subtotal!, 0) - discount;
      table(
      { primary: `${label}${tr("项目", " CHARGES")}` },
      english
        ? ["ITEM", "DESCRIPTION", "QTY", "UNIT", "UNIT PRICE", "DISCOUNT", "SUBTOTAL"]
        : ["项目", "说明", "数量", "单位", "含税单价", "折扣", "小计"],
      [108, 131, 40, 40, 72, 72, 72],
      items.map(({ item, index }) => {
        const [quantity, unit] = quantityColumns(item.quantity, english ? item.unitLabelEn ?? "" : item.unitLabelZh, english ? undefined : overrides[`charges.items.${index}.quantity`]);
        return [
        { text: english ? (item.nameEn ?? "") : value(`charges.items.${index}.nameZh`, item.nameZh) },
        { text: english ? (item.descriptionEn ?? "—") : (value(`charges.items.${index}.descriptionZh`, item.descriptionZh ?? "") || "—") },
        { text: quantity, align: "right" },
        { text: kind === "labor" ? "JOB" : unit },
        { text: item.pendingQuote ? (overrides[`charges.items.${index}.unitPrice`] ?? tr("待报价", "Pending quote")) : value(`charges.items.${index}.unitPrice`, money(item.unitPriceMinor)), align: "right", noWrap: true },
        { text: value(`charges.items.${index}.discount`, money(item.itemDiscountMinor)), align: "right", color: item.itemDiscountMinor ? BLUE : MUTED, noWrap: true },
        { text: value(`charges.items.${index}.subtotal`, money(item.subtotalMinor)), align: "right", noWrap: true },
      ]; }),
      { fontSize: 8.5, headerSize: 7, minimumRowHeight: 30, footer: { label: `${label}${pendingCount ? tr("已报价合计（含税）", " QUOTED TOTAL (TAX INCLUSIVE)") : tr("合计（含税）", " TOTAL (TAX INCLUSIVE)")}${discount ? ` · ${tr("分类折扣", "CATEGORY DISCOUNT")} ${money(discount)}` : ""}`, value: total === null ? tr("请核对项目小计", "REVIEW LINE SUBTOTALS") : money(total) } },
    );
    }

    const pendingQuoteCount = snapshot.charges.items.filter((item) => item.pendingQuote).length;
    amountSummary(pendingQuoteCount ? tr("已报价金额（含税）", "QUOTED CHARGES (TAX INCLUSIVE)") : tr("费用总额（含税）", "TOTAL AGREED CHARGES (TAX INCLUSIVE)"), value("totals.currentDue", money(snapshot.totals.currentDueMinor)), [
      { label: tr("收费原价", "GROSS"), value: money(snapshot.charges.totals.grossMinor) },
      { label: tr("折扣合计", "TOTAL DISCOUNT"), value: `−${money(snapshot.charges.totals.grossMinor - snapshot.totals.currentDueMinor)}` },
    ]);

    noteBlocks([...(pendingQuoteCount ? [{ label: tr("待报价", "PENDING QUOTE"), text: tr(`${pendingQuoteCount} 项待报价，当前合计仅含已报价部分；待补价格确认后更新费用。`, `${pendingQuoteCount} ${pendingQuoteCount === 1 ? "item" : "items"} pending quote. Current totals include priced items only; charges will be updated after the remaining prices are confirmed.`) }] : []), ...snapshot.charges.notes.map((note, index) => {
      const label = note.kind === "customer_concern" ? tr("客户诉求", "CUSTOMER CONCERN") : note.kind === "work_instruction" ? tr("施工说明", "WORK INSTRUCTION") : note.kind === "liability_notice" ? tr("责任与提前告知", "NOTICE & RESPONSIBILITY") : tr("内部备注", "INTERNAL NOTE");
      const zh = value(`notes.${index}.contentZh`, note.contentZh ?? "");
      const en = value(`notes.${index}.contentEn`, note.contentEn ?? "");
      return { label, text: english ? en : zh };
    })]);
    signatureBlock(
      localizedValue("approval.statementZh", snapshot.approval.statementZh, snapshot.approval.statementEn),
      "",
    );
  }

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
