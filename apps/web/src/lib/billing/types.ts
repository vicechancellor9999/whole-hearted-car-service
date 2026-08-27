import type { InvoiceChargeSnapshot } from "./invoice-snapshots";

export type ChargeCategory = "labor" | "parts" | "other_service";
export type ChargeCode =
  | "inspection"
  | "diagnosis"
  | "maintenance"
  | "repair"
  | "part"
  | "parking_overtime"
  | "towing"
  | "offsite_service"
  | "other";
export type PaymentStatus = "unpaid" | "partially_paid" | "paid";
export type SettlementArrangement = "normal" | "credit" | "special_agreement";

export interface ChargeLine {
  readonly id: string;
  readonly category: ChargeCategory;
  readonly code: ChargeCode;
  readonly descriptionZh: string;
  readonly descriptionEn: string;
  readonly quantity: number;
  readonly unitPriceJmd: number;
  readonly sourceId?: string;
}

export interface ChargeLineText {
  readonly descZh: string;
  readonly descEn: string;
  readonly remarkZh: string;
  readonly remarkEn: string;
}

export interface UnitPricedChargeLine extends ChargeLineText {
  readonly id: string;
  readonly category: "labor" | "parts";
  readonly pricingMode: "unit";
  readonly unit: string;
  readonly unitEn: string;
  readonly quantity: number;
  readonly unitPriceJmd: number;
  readonly unitDiscountJmd: number;
  readonly pendingQuote: boolean;
  readonly sourceId?: string;
}

export interface FixedTotalChargeLine extends ChargeLineText {
  readonly id: string;
  readonly category: "other_service";
  readonly pricingMode: "fixed_total";
  readonly code: "towing" | "offsite_service" | "other";
  readonly amountJmd: number;
  readonly sourceId?: string;
}

export interface ParkingProjectionChargeLine extends ChargeLineText {
  readonly id: string;
  readonly category: "other_service";
  readonly pricingMode: "parking_projection";
  readonly code: "parking_overtime";
  readonly parkingCaseId: string;
  readonly sourceRevision: number;
  readonly asOf: string;
  readonly amountJmd: number;
  readonly sourceId?: string;
}

export type QuotedChargeLine =
  | UnitPricedChargeLine
  | FixedTotalChargeLine
  | ParkingProjectionChargeLine;

export interface QuotedChargeTotals {
  readonly laborGrossJmd: number;
  readonly laborDiscountJmd: number;
  readonly laborNetJmd: number;
  readonly partsGrossJmd: number;
  readonly partsDiscountJmd: number;
  readonly partsNetJmd: number;
  readonly otherFeeTotalJmd: number;
  readonly parkingTotalJmd: number;
  readonly totalDiscountJmd: number;
  readonly pendingPartsCount: number;
  readonly chargeSubtotalJmd: number;
  readonly grandTotalJmd: number;
}

export interface InvoiceAdjustment {
  readonly id: string;
  readonly kind: "discount" | "waiver" | "write_off" | "rounding";
  readonly amountJmd: number;
}

export interface InvoiceTotals {
  readonly laborJmd: number;
  readonly partsJmd: number;
  readonly otherServiceJmd: number;
  readonly adjustmentsJmd: number;
  readonly totalJmd: number;
}

export interface InvoiceCalculationInput {
  readonly lines: ReadonlyArray<ChargeLine>;
  readonly adjustments: ReadonlyArray<InvoiceAdjustment>;
}

export interface NonDiscountInvoiceAdjustment extends Omit<InvoiceAdjustment, "kind"> {
  readonly kind: Exclude<InvoiceAdjustment["kind"], "discount">;
}

export interface QuotedChargeInvoiceCalculationInput {
  readonly lines: ReadonlyArray<QuotedChargeLine>;
  /** New shared-line writes accept only non-discount adjustments. */
  readonly adjustments: ReadonlyArray<NonDiscountInvoiceAdjustment>;
}

export type PaymentMethod = string;

interface InvoicePaymentFactBase {
  readonly id: string;
  readonly invoiceId: string;
  readonly amountJmd: number;
  readonly receivedAt: string;
  /** 支付方式（2026-08-14 收款功能）。 */
  readonly method?: PaymentMethod;
  /** 收款人姓名。 */
  readonly receivedBy?: string;
  readonly note?: string;
}

/** Historical persisted payment fact.  The absent own discriminator is the legacy contract. */
export interface LegacyInvoicePaymentFact extends InvoicePaymentFactBase {
  readonly paymentContract?: never;
  readonly mutationId?: never;
  readonly committedRevision?: never;
  readonly receivedById?: never;
}

/** Server-committed payment fact ordered by the canonical billing ledger revision. */
export interface ModernInvoicePaymentFact extends InvoicePaymentFactBase {
  readonly paymentContract: "invoice_payment_v1";
  readonly invoiceVersionId: string;
  readonly mutationId: string;
  readonly committedRevision: number;
  readonly method: PaymentMethod;
  readonly receivedBy: string;
  readonly receivedById: string;
}

export type InvoicePaymentFact = LegacyInvoicePaymentFact | ModernInvoicePaymentFact;

export function isModernInvoicePaymentFact(payment: InvoicePaymentFact): payment is ModernInvoicePaymentFact {
  return Object.prototype.hasOwnProperty.call(payment, "paymentContract")
    && payment.paymentContract === "invoice_payment_v1";
}

export interface InvoicePaymentSummary {
  readonly paidJmd: number;
  readonly balanceJmd: number;
  readonly paymentStatus: PaymentStatus;
  /** 收款明细（2026-08-14 收款功能）。 */
  readonly payments: ReadonlyArray<InvoicePaymentFact>;
}

export interface InvoicePaymentSummaryInput {
  readonly invoiceId: string;
  readonly totalJmd: number;
  readonly payments: ReadonlyArray<InvoicePaymentFact>;
}

export interface CustomerCreditFacility {
  readonly customerId: string;
  readonly status: "not_enabled" | "active" | "revoked";
  readonly currentGrantId?: string;
  readonly activatedAt?: string;
  readonly revokedAt?: string;
}

/** Historical persisted Invoice version retained byte-for-byte for legacy reads. */
export interface LegacyInvoiceVersion {
  readonly id: string;
  readonly version: number;
  readonly lines: ReadonlyArray<ChargeLine>;
  readonly adjustments: ReadonlyArray<InvoiceAdjustment>;
  readonly totals: InvoiceTotals;
  readonly issuedAt: string;
  readonly chargeContract?: never;
  readonly snapshot?: never;
}

/** Canonical shared-charge Invoice version. The snapshot is the only charge truth. */
export interface SharedChargeInvoiceVersion {
  readonly id: string;
  readonly version: number;
  readonly chargeContract: "shared_v1";
  readonly snapshot: InvoiceChargeSnapshot;
  /** Strong immutable commitment to the canonical charge snapshot, not a rendered customer-file hash. */
  readonly snapshotCommitment: string;
  readonly issuedAt: string;
  readonly lines?: never;
  readonly adjustments?: never;
  readonly totals?: never;
}

export type InvoiceVersion = LegacyInvoiceVersion | SharedChargeInvoiceVersion;

/** Customer acknowledgement is tied to the exact financial edition they saw. */
export interface InvoiceCustomerAcknowledgement {
  readonly id: string;
  readonly invoiceId: string;
  readonly invoiceVersionId: string;
  readonly customerId: string;
  readonly payerId: string;
  readonly customerSignerId: string;
  readonly signatureEvidence: Readonly<{
    signatureId: string;
    signatureHash: string;
    blobRef: string;
  }>;
  readonly balanceJmd: number;
  readonly documentEdition: "zh" | "en" | "bilingual";
  readonly fileHash: string;
  readonly signedAt: string;
}

interface InvoiceBase {
  readonly id: string;
  readonly invoiceNo: string;
  readonly businessOrderId: string;
  readonly settlementArrangement: SettlementArrangement;
}

export interface LegacyInvoice extends InvoiceBase {
  readonly versions: ReadonlyArray<LegacyInvoiceVersion>;
  readonly invoiceContract?: never;
  readonly financiallyEffectiveVersionId?: never;
}

export interface SharedChargeInvoice extends InvoiceBase {
  readonly invoiceContract: "shared_v1";
  readonly financiallyEffectiveVersionId: string | null;
  readonly versions: ReadonlyArray<SharedChargeInvoiceVersion>;
}

export type Invoice = LegacyInvoice | SharedChargeInvoice;

export function isSharedChargeInvoice(invoice: Invoice): invoice is SharedChargeInvoice {
  return invoice.invoiceContract === "shared_v1";
}

export function financiallyEffectiveInvoiceVersion(invoice: Invoice): InvoiceVersion {
  if (isSharedChargeInvoice(invoice)) {
    const version = invoice.financiallyEffectiveVersionId === null
      ? undefined
      : invoice.versions.find((candidate) => candidate.id === invoice.financiallyEffectiveVersionId);
    if (!version) throw new Error("Invoice 没有财务生效版本");
    return version;
  }
  const version = invoice.versions[invoice.versions.length - 1];
  if (!version) throw new Error("Invoice 没有可用版本");
  return version;
}

export function invoiceVersionTotalJmd(version: InvoiceVersion): number {
  return version.chargeContract === "shared_v1"
    ? version.snapshot.totals.grandTotalJmd
    : version.totals.totalJmd;
}
