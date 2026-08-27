import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { WHOLE_HEARTED_COMPANY_IDENTITY, type CompanyIdentity } from "../company-identity";

/** 共享 PDF 引擎：A4 版式、中英双语标签、分页、页脚、品牌头（可嵌 Logo）。 */

export const PDF_FONT_URL = "/fonts/NotoSansSC-Regular-wh.ttf";

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
/** 13 mm left/right and bottom, 12 mm top. */
export const MARGIN_X = 36.85;
const MARGIN_TOP = 34.02;
export const MARGIN_BOTTOM = 36.85;
export const CONTENT_W = PAGE_W - MARGIN_X * 2;
export const CONTENT_TOP = PAGE_H - MARGIN_TOP;

export const INK = rgb(0.12, 0.12, 0.14);
export const SOFT = rgb(0.42, 0.44, 0.47);
export const FAINT = rgb(0.62, 0.64, 0.67);
export const ACCENT = rgb(0.24, 0.24, 0.62);

export type PdfLanguage = "zh" | "en" | "bilingual";

export interface PdfLabels {
  readonly zh: Record<string, string>;
  readonly en: Record<string, string>;
}

export function labelOf(labels: PdfLabels, key: string, language: PdfLanguage): string {
  if (language === "zh") return labels.zh[key] ?? key;
  if (language === "en") return labels.en[key] ?? labels.zh[key] ?? key;
  return `${labels.zh[key] ?? key} / ${labels.en[key] ?? labels.zh[key] ?? key}`;
}

function isCjk(codePoint: number): boolean {
  return (codePoint >= 0x2e80 && codePoint <= 0x9fff)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xff00 && codePoint <= 0xffef)
    || (codePoint >= 0x3000 && codePoint <= 0x303f);
}

function tokensFor(text: string): string[] {
  const tokens: string[] = [];
  let latin = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (isCjk(codePoint) || codePoint <= 0x20) {
      if (latin) { tokens.push(latin); latin = ""; }
      if (character !== " ") tokens.push(character);
    } else {
      latin += character;
    }
  }
  if (latin) tokens.push(latin);
  return tokens;
}

export function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!(maxWidth > 0)) return [""];
  const lines: string[] = [];
  let line = "";
  const fittedTokens = tokensFor(text).flatMap((token) => {
    if (font.widthOfTextAtSize(token, size) <= maxWidth) return [token];
    const chunks: string[] = [];
    let chunk = "";
    for (const character of token) {
      const candidate = `${chunk}${character}`;
      if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        chunks.push(chunk);
        chunk = character;
      } else {
        chunk = candidate;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });
  for (const token of fittedTokens) {
    const candidate = line ? `${line} ${token}` : token;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = token;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function formatJmd(amountJmd: number): string {
  const value = Number.isFinite(amountJmd) ? amountJmd : 0;
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatWholeJmd(amountJmd: number): string {
  if (!Number.isSafeInteger(amountJmd) || amountJmd < 0) {
    throw new RangeError("JMD value must be a non-negative safe integer");
  }
  return amountJmd.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function pdfFileName(base: string, language: PdfLanguage): string {
  const suffix = language === "zh" ? "ZH" : language === "en" ? "EN" : "BI";
  return `${base.replace(/[^0-9A-Za-z-]/g, "-")}-${suffix}.pdf`;
}

export class Painter {
  y: number;
  page: PDFPage;
  readonly pages: PDFPage[] = [];

  constructor(
    readonly document: PDFDocument,
    readonly font: PDFFont,
    readonly labels: PdfLabels,
    readonly language: PdfLanguage,
  ) {
    this.page = this.newPage();
    this.y = CONTENT_TOP;
  }

  private newPage(): PDFPage {
    const page = this.document.addPage([PAGE_W, PAGE_H]);
    this.pages.push(page);
    return page;
  }

  ensure(space: number): void {
    if (this.y - space < MARGIN_BOTTOM) {
      this.page = this.newPage();
      this.y = CONTENT_TOP;
    }
  }

  text(text: string, options: { size?: number; color?: ReturnType<typeof rgb>; leading?: number; maxWidth?: number; indent?: number } = {}): void {
    const size = options.size ?? 10;
    const leading = options.leading ?? size * 1.5;
    const maxWidth = (options.maxWidth ?? CONTENT_W) - (options.indent ?? 0);
    for (const line of wrapPdfText(text, this.font, size, maxWidth)) {
      this.ensure(leading);
      this.page.drawText(line, { x: MARGIN_X + (options.indent ?? 0), y: this.y, size, font: this.font, color: options.color ?? INK });
      this.y -= leading;
    }
  }

  textAt(text: string, x: number, options: { size?: number; color?: ReturnType<typeof rgb>; width?: number; align?: "left" | "right" } = {}): void {
    const size = options.size ?? 10;
    const width = options.width ?? CONTENT_W;
    const xPos = options.align === "right" ? x + width - this.font.widthOfTextAtSize(text, size) : x;
    this.page.drawText(text, { x: xPos, y: this.y, size, font: this.font, color: options.color ?? INK });
  }

  gap(height: number): void {
    this.ensure(height);
    this.y -= height;
  }

  heading(key: string): void {
    this.gap(8);
    this.text(labelOf(this.labels, key, this.language), { size: 11, color: ACCENT });
    this.page.drawLine({
      start: { x: MARGIN_X, y: this.y + 4 },
      end: { x: PAGE_W - MARGIN_X, y: this.y + 4 },
      thickness: 0.6,
      color: rgb(0.85, 0.85, 0.88),
    });
    this.gap(6);
  }

  meta(key: string, value: string): void {
    const labelWidth = 118;
    this.textAt(labelOf(this.labels, key, this.language), MARGIN_X, { size: 9, color: SOFT, width: labelWidth });
    this.textAt(value, MARGIN_X + labelWidth + 6, { size: 9, color: INK, width: CONTENT_W - labelWidth - 6 });
    this.y -= 13;
  }

  finishFooters(): void {
    const totalPages = this.pages.length;
    this.pages.forEach((page, index) => {
      page.drawText(`${labelOf(this.labels, "footer", this.language)}  ·  ${index + 1} / ${totalPages}`, {
        x: MARGIN_X,
        y: 30,
        size: 7.5,
        font: this.font,
        color: FAINT,
      });
    });
  }
}

export interface BrandHeaderSpec {
  readonly docTitleKey: string;
  readonly docNo: string;
  readonly docSub?: string;
  readonly logoBytes?: Uint8Array;
  readonly company?: CompanyIdentity;
  /** IR bilingual titles need their own row; legacy BO/Invoice keep the standard layout. */
  readonly layout?: "standard" | "stacked-title";
}

/** 品牌头：真 Logo + 公司名 + 单据标题/编号。 */
export async function drawBrandHeader(painter: Painter, spec: BrandHeaderSpec): Promise<void> {
  const company = spec.company ?? WHOLE_HEARTED_COMPANY_IDENTITY;
  const right = PAGE_W - MARGIN_X;
  let logo: { width: number; height: number } | null = null;
  if (spec.logoBytes) {
    try {
      const image = await painter.document.embedPng(spec.logoBytes);
      const scaled = image.scaleToFit(48, 48);
      logo = scaled;
      painter.page.drawImage(image, { x: MARGIN_X, y: painter.y - scaled.height + 12, width: scaled.width, height: scaled.height });
    } catch {
      logo = null;
    }
  }
  const textX = MARGIN_X + (logo ? logo.width + 10 : 0);
  const titleText = labelOf(painter.labels, spec.docTitleKey, painter.language);
  painter.page.drawText(company.legalName, { x: textX, y: painter.y - 2, size: 15, font: painter.font, color: INK });
  painter.page.drawText("Kingston, Jamaica", { x: textX, y: painter.y - 22, size: 8, font: painter.font, color: SOFT });
  if (spec.layout === "stacked-title") {
    const titleY = painter.y - 48;
    painter.page.drawText(titleText, { x: MARGIN_X, y: titleY, size: 11, font: painter.font, color: ACCENT });
    painter.page.drawText(spec.docNo, { x: right - painter.font.widthOfTextAtSize(spec.docNo, 8.5), y: titleY, size: 8.5, font: painter.font, color: SOFT });
    if (spec.docSub) {
      painter.page.drawText(spec.docSub, { x: right - painter.font.widthOfTextAtSize(spec.docSub, 8), y: titleY - 14, size: 8, font: painter.font, color: SOFT });
    }
    painter.y -= 72;
  } else {
    painter.page.drawText(titleText, { x: right - painter.font.widthOfTextAtSize(titleText, 13), y: painter.y - 2, size: 13, font: painter.font, color: ACCENT });
    painter.page.drawText(spec.docNo, { x: right - painter.font.widthOfTextAtSize(spec.docNo, 9), y: painter.y - 20, size: 9, font: painter.font, color: SOFT });
    if (spec.docSub) {
      painter.page.drawText(spec.docSub, { x: right - painter.font.widthOfTextAtSize(spec.docSub, 8), y: painter.y - 32, size: 8, font: painter.font, color: SOFT });
    }
    painter.y -= 44;
  }
  painter.page.drawLine({ start: { x: MARGIN_X, y: painter.y }, end: { x: right, y: painter.y }, thickness: 1, color: ACCENT });
  painter.gap(10);
}

/** 公司信息条：地址 / WhatsApp / TRN。 */
export function drawCompanyStrip(
  painter: Painter,
  company: CompanyIdentity = WHOLE_HEARTED_COMPANY_IDENTITY,
): void {
  const labels = [company.address, company.contactLine, `TRN: ${company.trn}`];
  const width = CONTENT_W / labels.length;
  labels.forEach((text, index) => {
    painter.page.drawText(text, { x: MARGIN_X + index * width, y: painter.y, size: 8, font: painter.font, color: SOFT });
  });
  painter.y -= 16;
  painter.page.drawLine({ start: { x: MARGIN_X, y: painter.y + 4 }, end: { x: PAGE_W - MARGIN_X, y: painter.y + 4 }, thickness: 0.5, color: rgb(0.9, 0.9, 0.92) });
  painter.gap(8);
}

export function createPdfFontLoader(
  fetchFont: () => Promise<Response> = () => fetch(PDF_FONT_URL),
): () => Promise<Uint8Array> {
  let fontCache: Promise<Uint8Array> | null = null;
  return () => {
    if (fontCache) return fontCache;
    const request = (async () => {
      const response = await fetchFont();
      if (!response.ok) throw new Error(`字体资源加载失败（${response.status}）`);
      return new Uint8Array(await response.arrayBuffer());
    })();
    fontCache = request;
    void request.catch(() => {
      if (fontCache === request) fontCache = null;
    });
    return request;
  };
}

const loadDefaultPdfFont = createPdfFontLoader();

export function loadPdfFont(): Promise<Uint8Array> {
  return loadDefaultPdfFont();
}
