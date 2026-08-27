export const ORDERS_BUSINESS_TIME_ZONE = "America/Jamaica" as const;

export type BusinessDate = `${number}${number}${number}${number}${number}${number}${number}${number}`;
export type OrdersDocumentKind = "business_order" | "inspection_report" | "quotation" | "invoice";

export interface DocumentNumberParts {
  branchCode: string;
  brandCode: string;
  businessDate: BusinessDate;
  sequence: number;
}

export interface AtomicDocumentSequenceRequest {
  kind: OrdersDocumentKind;
  branchCode: string;
  brandCode: string;
  businessDate: BusinessDate;
}

export interface AtomicDocumentSequenceAllocation {
  sequence: number;
  allocationId: string;
}

/**
 * Server-owned allocation boundary. Implementations must reserve the next value
 * atomically; callers never provide or scan an existing-number collection.
 */
export interface AtomicDocumentSequenceAllocator {
  allocateNext(
    request: Readonly<AtomicDocumentSequenceRequest>,
  ): Promise<Readonly<AtomicDocumentSequenceAllocation>>;
}

export interface AllocateDocumentNumberInput {
  kind: OrdersDocumentKind;
  branchCode: string;
  brandCode: string;
  occurredAt: Date | string | number;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/;
const BUSINESS_DATE_PATTERN = /^\d{8}$/;

function assertCode(value: string, label: string): void {
  if (!CODE_PATTERN.test(value)) {
    throw new RangeError(`${label}代码必须为 2 至 8 位大写字母或数字`);
  }
}

function assertBusinessDate(value: string): asserts value is BusinessDate {
  if (!BUSINESS_DATE_PATTERN.test(value)) {
    throw new RangeError("业务日期必须为 YYYYMMDD");
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    throw new RangeError("业务日期不是有效公历日期");
  }
}

function assertFiveDigitSequence(sequence: number): void {
  if (!Number.isInteger(sequence) || sequence < 10_000 || sequence > 99_999) {
    throw new RangeError("单据序号必须为 10000 至 99999 的五位整数");
  }
}

function validateParts(parts: DocumentNumberParts): void {
  assertCode(parts.branchCode, "分店");
  assertCode(parts.brandCode, "品牌");
  assertBusinessDate(parts.businessDate);
  assertFiveDigitSequence(parts.sequence);
}

export function businessDateInJamaica(value: Date | string | number): BusinessDate {
  const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("无法从给定时间计算 Jamaica 业务日期");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ORDERS_BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const businessDate = `${part("year")}${part("month")}${part("day")}`;
  assertBusinessDate(businessDate);
  return businessDate;
}

/**
 * Jamaica 业务月份键 YYYYMM（2026-08-18 修复跨月误判）：
 * businessDateInJamaica 返回 YYYYMMDD（无连字符），月键取前 6 位；
 * 之前多处误用 slice(0, 7)，日期一变（19→20 号）同一个月会被当成两个月。
 */
export function jamaicaMonthKey(value: Date | string | number): string {
  return businessDateInJamaica(value).slice(0, 6);
}

export function formatBusinessOrderNo(parts: DocumentNumberParts): string {
  validateParts(parts);
  return `${parts.branchCode}-${parts.brandCode}-${parts.businessDate}${parts.sequence}`;
}

export function formatInspectionReportNo(parts: DocumentNumberParts): string {
  validateParts(parts);
  return `${parts.branchCode}-${parts.brandCode}-IR-${parts.businessDate}${parts.sequence}`;
}

export function formatQuotationNo(parts: DocumentNumberParts): string {
  validateParts(parts);
  return `${parts.branchCode}-${parts.brandCode}-QT-${parts.businessDate}${parts.sequence}`;
}

export function formatInvoiceNo(parts: DocumentNumberParts): string {
  validateParts(parts);
  return `${parts.branchCode}-${parts.brandCode}-INV-${parts.businessDate}${parts.sequence}`;
}

export async function allocateDocumentNumber(
  input: AllocateDocumentNumberInput,
  allocator: AtomicDocumentSequenceAllocator,
): Promise<string> {
  assertCode(input.branchCode, "分店");
  assertCode(input.brandCode, "品牌");
  const businessDate = businessDateInJamaica(input.occurredAt);
  const allocation = await allocator.allocateNext(Object.freeze({
    kind: input.kind,
    branchCode: input.branchCode,
    brandCode: input.brandCode,
    businessDate,
  }));
  const parts = {
    branchCode: input.branchCode,
    brandCode: input.brandCode,
    businessDate,
    sequence: allocation.sequence,
  };

  switch (input.kind) {
    case "business_order":
      return formatBusinessOrderNo(parts);
    case "inspection_report":
      return formatInspectionReportNo(parts);
    case "quotation":
      return formatQuotationNo(parts);
    case "invoice":
      return formatInvoiceNo(parts);
  }
}
