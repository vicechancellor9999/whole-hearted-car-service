import { discountApprovalRequirement } from "./discount-approval";
import { calculateInvoiceTotalsFromQuotedCharges } from "./calculations";
import {
  calculateQuotedChargeTotals,
  validateQuotedChargeLine,
} from "./quoted-charges";
import type { NonDiscountInvoiceAdjustment, QuotedChargeLine } from "./types";

interface InvoiceSnapshotText {
  readonly descZh: string;
  readonly descEn: string;
  readonly remarkZh: string;
  readonly remarkEn: string;
}

export interface InvoiceUnitSnapshotLine extends InvoiceSnapshotText {
  readonly pricingMode: "unit";
  readonly chargeLineId: string;
  readonly category: "labor" | "parts";
  readonly unit: string;
  readonly unitEn: string;
  readonly quantity: number;
  readonly unitPriceJmd: number;
  readonly unitDiscountJmd: number;
  readonly finalUnitPriceJmd: number;
  readonly finalLineJmd: number;
}

export interface InvoiceFixedTotalSnapshotLine extends InvoiceSnapshotText {
  readonly pricingMode: "fixed_total";
  readonly chargeLineId: string;
  readonly category: "other_service";
  readonly code: "towing" | "offsite_service" | "other";
  readonly amountJmd: number;
}

export interface InvoiceParkingSnapshotLine extends InvoiceSnapshotText {
  readonly pricingMode: "parking_projection";
  readonly chargeLineId: string;
  readonly category: "other_service";
  readonly code: "parking_overtime";
  readonly parkingCaseId: string;
  readonly sourceRevision: number;
  readonly asOf: string;
  readonly amountJmd: number;
}

export type InvoiceSnapshotLine =
  | InvoiceUnitSnapshotLine
  | InvoiceFixedTotalSnapshotLine
  | InvoiceParkingSnapshotLine;

export interface InvoiceSnapshotTotals {
  readonly laborGrossJmd: number;
  readonly laborDiscountJmd: number;
  readonly laborNetJmd: number;
  readonly partsGrossJmd: number;
  readonly partsDiscountJmd: number;
  readonly partsNetJmd: number;
  readonly otherFeeTotalJmd: number;
  readonly parkingTotalJmd: number;
  readonly totalDiscountJmd: number;
  readonly chargeSubtotalJmd: number;
  readonly adjustmentsJmd: number;
  readonly grandTotalJmd: number;
}

export interface InvoiceChargeSnapshot {
  readonly sourceBusinessOrderId: string;
  readonly sourceBusinessOrderRevision: number;
  readonly lines: ReadonlyArray<InvoiceSnapshotLine>;
  readonly adjustments: ReadonlyArray<NonDiscountInvoiceAdjustment>;
  readonly totals: InvoiceSnapshotTotals;
}

const SNAPSHOT_FIELDS = new Set([
  "sourceBusinessOrderId",
  "sourceBusinessOrderRevision",
  "lines",
  "adjustments",
  "totals",
]);
const SNAPSHOT_INPUT_FIELDS = new Set([
  "sourceBusinessOrderId",
  "sourceBusinessOrderRevision",
  "lines",
  "adjustments",
]);
const SNAPSHOT_INPUT_REQUIRED_FIELDS = new Set(["sourceBusinessOrderId", "sourceBusinessOrderRevision", "lines"]);
const TEXT_FIELDS = ["pricingMode", "chargeLineId", "category", "descZh", "descEn", "remarkZh", "remarkEn"] as const;
const UNIT_FIELDS = new Set([
  ...TEXT_FIELDS,
  "unit",
  "unitEn",
  "quantity",
  "unitPriceJmd",
  "unitDiscountJmd",
  "finalUnitPriceJmd",
  "finalLineJmd",
]);
const FIXED_FIELDS = new Set([...TEXT_FIELDS, "code", "amountJmd"]);
const PARKING_FIELDS = new Set([
  ...TEXT_FIELDS,
  "code",
  "parkingCaseId",
  "sourceRevision",
  "asOf",
  "amountJmd",
]);
const ADJUSTMENT_FIELDS = new Set(["id", "kind", "amountJmd"]);
const TOTAL_FIELDS = new Set([
  "laborGrossJmd",
  "laborDiscountJmd",
  "laborNetJmd",
  "partsGrossJmd",
  "partsDiscountJmd",
  "partsNetJmd",
  "otherFeeTotalJmd",
  "parkingTotalJmd",
  "totalDiscountJmd",
  "chargeSubtotalJmd",
  "adjustmentsJmd",
  "grandTotalJmd",
]);

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must not be empty`);
}

function assertSafeNonNegative(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function assertSafePositive(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function checkedMultiply(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} exceeds the safe integer range`);
  return result;
}

function checkedAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} exceeds the safe integer range`);
  return result;
}

function assertAllowedFields(value: object, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new RangeError(`${label} contains an unexpected field: ${String(key)}`);
    }
  }
}

function assertRequiredFields(value: object, required: ReadonlySet<string>, label: string): void {
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new RangeError(`${label} is missing required field: ${key}`);
    }
  }
}

function assertClosed(value: object, allowed: ReadonlySet<string>, label: string): void {
  assertAllowedFields(value, allowed, label);
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new RangeError(`${label} is missing required field: ${key}`);
    }
  }
}

function quotedFromSnapshot(line: InvoiceSnapshotLine): QuotedChargeLine {
  if (line.pricingMode === "unit") {
    return {
      id: line.chargeLineId,
      category: line.category,
      pricingMode: "unit",
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      unit: line.unit,
      unitEn: line.unitEn,
      quantity: line.quantity,
      unitPriceJmd: line.unitPriceJmd,
      unitDiscountJmd: line.unitDiscountJmd,
      pendingQuote: false,
    };
  }
  if (line.pricingMode === "fixed_total") {
    return {
      id: line.chargeLineId,
      category: line.category,
      pricingMode: "fixed_total",
      code: line.code,
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      amountJmd: line.amountJmd,
    };
  }
  return {
    id: line.chargeLineId,
    category: line.category,
    pricingMode: "parking_projection",
    code: line.code,
    descZh: line.descZh,
    descEn: line.descEn,
    remarkZh: line.remarkZh,
    remarkEn: line.remarkEn,
    parkingCaseId: line.parkingCaseId,
    sourceRevision: line.sourceRevision,
    asOf: line.asOf,
    amountJmd: line.amountJmd,
  };
}

function snapshotLine(line: QuotedChargeLine): InvoiceSnapshotLine {
  validateQuotedChargeLine(line);
  if (line.pricingMode === "unit") {
    if (line.pendingQuote) throw new RangeError("an Invoice snapshot cannot contain a pending quoted unit line");
    const finalUnitPriceJmd = line.unitPriceJmd - line.unitDiscountJmd;
    return {
      pricingMode: "unit",
      chargeLineId: line.id,
      category: line.category,
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      unit: line.unit,
      unitEn: line.unitEn,
      quantity: line.quantity,
      unitPriceJmd: line.unitPriceJmd,
      unitDiscountJmd: line.unitDiscountJmd,
      finalUnitPriceJmd,
      finalLineJmd: checkedMultiply(line.quantity, finalUnitPriceJmd, "Invoice final line"),
    };
  }
  if (line.pricingMode === "fixed_total") {
    return {
      pricingMode: "fixed_total",
      chargeLineId: line.id,
      category: "other_service",
      code: line.code,
      descZh: line.descZh,
      descEn: line.descEn,
      remarkZh: line.remarkZh,
      remarkEn: line.remarkEn,
      amountJmd: line.amountJmd,
    };
  }
  return {
    pricingMode: "parking_projection",
    chargeLineId: line.id,
    category: "other_service",
    code: "parking_overtime",
    descZh: line.descZh,
    descEn: line.descEn,
    remarkZh: line.remarkZh,
    remarkEn: line.remarkEn,
    parkingCaseId: line.parkingCaseId,
    sourceRevision: line.sourceRevision,
    asOf: line.asOf,
    amountJmd: line.amountJmd,
  };
}

function validateSnapshotAdjustment(adjustment: NonDiscountInvoiceAdjustment): void {
  if (adjustment === null || typeof adjustment !== "object") {
    throw new TypeError("Invoice adjustment must be an object");
  }
  assertClosed(adjustment, ADJUSTMENT_FIELDS, "Invoice adjustment schema");
  assertNonEmpty(adjustment.id, "Invoice adjustment id");
  const runtimeKind: unknown = adjustment.kind;
  if (runtimeKind === "discount") {
    throw new RangeError("legacy discount adjustments cannot be written to a canonical Invoice snapshot");
  }
  if (runtimeKind !== "waiver" && runtimeKind !== "write_off" && runtimeKind !== "rounding") {
    throw new RangeError("Invoice adjustment kind is invalid");
  }
  if (!Number.isSafeInteger(adjustment.amountJmd)) {
    throw new RangeError("Invoice adjustment amount must be a safe integer");
  }
  if ((adjustment.kind === "waiver" || adjustment.kind === "write_off") && adjustment.amountJmd > 0) {
    throw new RangeError(`${adjustment.kind} Invoice adjustments must be non-positive`);
  }
}

function totalsFromSnapshotFacts(
  lines: ReadonlyArray<InvoiceSnapshotLine>,
  adjustments: ReadonlyArray<NonDiscountInvoiceAdjustment>,
): InvoiceSnapshotTotals {
  const quotedLines = lines.map(quotedFromSnapshot);
  const totals = calculateQuotedChargeTotals(quotedLines, { includeParking: true });
  const invoiceTotals = calculateInvoiceTotalsFromQuotedCharges({ lines: quotedLines, adjustments });
  return {
    laborGrossJmd: totals.laborGrossJmd,
    laborDiscountJmd: totals.laborDiscountJmd,
    laborNetJmd: totals.laborNetJmd,
    partsGrossJmd: totals.partsGrossJmd,
    partsDiscountJmd: totals.partsDiscountJmd,
    partsNetJmd: totals.partsNetJmd,
    otherFeeTotalJmd: totals.otherFeeTotalJmd,
    parkingTotalJmd: totals.parkingTotalJmd,
    totalDiscountJmd: totals.totalDiscountJmd,
    chargeSubtotalJmd: totals.chargeSubtotalJmd,
    adjustmentsJmd: invoiceTotals.adjustmentsJmd,
    grandTotalJmd: invoiceTotals.totalJmd,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateInvoiceSnapshotLine(line: InvoiceSnapshotLine): void {
  if (line === null || typeof line !== "object") throw new TypeError("Invoice snapshot line must be an object");
  if (line.pricingMode === "unit") {
    assertClosed(line, UNIT_FIELDS, "Invoice unit snapshot schema");
    assertNonEmpty(line.chargeLineId, "Invoice charge lineage id");
    assertSafePositive(line.quantity, "Invoice unit quantity");
    assertSafeNonNegative(line.unitPriceJmd, "Invoice unit price");
    assertSafeNonNegative(line.unitDiscountJmd, "Invoice unit discount");
    if (line.unitDiscountJmd > line.unitPriceJmd) throw new RangeError("Invoice unit discount exceeds its price");
    const finalUnitPriceJmd = line.unitPriceJmd - line.unitDiscountJmd;
    const finalLineJmd = checkedMultiply(line.quantity, finalUnitPriceJmd, "Invoice final line");
    if (line.finalUnitPriceJmd !== finalUnitPriceJmd || line.finalLineJmd !== finalLineJmd) {
      throw new RangeError("Invoice snapshot derived final money facts do not match their source fields");
    }
  } else if (line.pricingMode === "fixed_total") {
    assertClosed(line, FIXED_FIELDS, "Invoice fixed snapshot schema");
    if (line.category !== "other_service") {
      throw new RangeError("Invoice fixed-total category must be other_service");
    }
    if (line.code !== "towing" && line.code !== "offsite_service" && line.code !== "other") {
      throw new RangeError("Invoice fixed-total code is invalid");
    }
  } else if (line.pricingMode === "parking_projection") {
    assertClosed(line, PARKING_FIELDS, "Invoice parking snapshot schema");
    if (line.category !== "other_service") {
      throw new RangeError("Invoice parking category must be other_service");
    }
    if (line.code !== "parking_overtime") {
      throw new RangeError("Invoice parking code must be parking_overtime");
    }
  } else {
    throw new RangeError("Invoice snapshot pricing mode is invalid");
  }
  validateQuotedChargeLine(quotedFromSnapshot(line));
}

export function validateInvoiceChargeSnapshot(snapshot: InvoiceChargeSnapshot): void {
  if (snapshot === null || typeof snapshot !== "object") throw new TypeError("Invoice snapshot must be an object");
  assertClosed(snapshot, SNAPSHOT_FIELDS, "Invoice snapshot schema");
  assertNonEmpty(snapshot.sourceBusinessOrderId, "Invoice source Business Order id");
  assertSafeNonNegative(snapshot.sourceBusinessOrderRevision, "Invoice source Business Order revision");
  if (!Array.isArray(snapshot.lines) || snapshot.lines.length === 0) {
    throw new RangeError("Invoice snapshot must contain at least one charge line");
  }
  const ids = new Set<string>();
  const parkingCaseIds = new Set<string>();
  for (const line of snapshot.lines) {
    validateInvoiceSnapshotLine(line);
    if (ids.has(line.chargeLineId)) throw new RangeError("duplicate Invoice charge lineage id");
    ids.add(line.chargeLineId);
    if (line.pricingMode === "parking_projection") {
      if (parkingCaseIds.has(line.parkingCaseId)) throw new RangeError("duplicate parking case in one Invoice snapshot");
      parkingCaseIds.add(line.parkingCaseId);
    }
  }
  if (!Array.isArray(snapshot.adjustments)) throw new TypeError("Invoice adjustments must be an array");
  for (const adjustment of snapshot.adjustments) {
    validateSnapshotAdjustment(adjustment);
    if (ids.has(adjustment.id)) throw new RangeError("duplicate Invoice charge or adjustment id");
    ids.add(adjustment.id);
  }
  if (snapshot.totals === null || typeof snapshot.totals !== "object") {
    throw new TypeError("Invoice snapshot totals are required");
  }
  assertClosed(snapshot.totals, TOTAL_FIELDS, "Invoice snapshot totals schema");
  if (!sameJson(snapshot.totals, totalsFromSnapshotFacts(snapshot.lines, snapshot.adjustments))) {
    throw new RangeError("Invoice snapshot totals do not match its derived charge facts");
  }
}

export function buildInvoiceChargeSnapshot(input: {
  readonly sourceBusinessOrderId: string;
  readonly sourceBusinessOrderRevision: number;
  readonly lines: ReadonlyArray<QuotedChargeLine>;
  readonly adjustments?: ReadonlyArray<NonDiscountInvoiceAdjustment>;
}): InvoiceChargeSnapshot {
  if (input === null || typeof input !== "object") throw new TypeError("Invoice snapshot input is required");
  assertAllowedFields(input, SNAPSHOT_INPUT_FIELDS, "Invoice snapshot input schema");
  assertRequiredFields(input, SNAPSHOT_INPUT_REQUIRED_FIELDS, "Invoice snapshot input schema");
  assertNonEmpty(input.sourceBusinessOrderId, "Invoice source Business Order id");
  assertSafeNonNegative(input.sourceBusinessOrderRevision, "Invoice source Business Order revision");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new RangeError("Invoice snapshot must contain at least one charge line");
  }
  const lines = input.lines.map(snapshotLine);
  const sourceAdjustments = input.adjustments ?? [];
  if (!Array.isArray(sourceAdjustments)) throw new TypeError("Invoice adjustments must be an array");
  const adjustments = sourceAdjustments.map((adjustment) => {
    validateSnapshotAdjustment(adjustment);
    return {
      id: adjustment.id,
      kind: adjustment.kind,
      amountJmd: adjustment.amountJmd,
    } satisfies NonDiscountInvoiceAdjustment;
  });
  const snapshot: InvoiceChargeSnapshot = {
    sourceBusinessOrderId: input.sourceBusinessOrderId,
    sourceBusinessOrderRevision: input.sourceBusinessOrderRevision,
    lines,
    adjustments,
    totals: totalsFromSnapshotFacts(lines, adjustments),
  };
  validateInvoiceChargeSnapshot(snapshot);
  return snapshot;
}

export interface InvoiceSnapshotApprovalRequirement {
  readonly required: boolean;
  readonly laborExceeds: boolean;
  readonly partsExceeds: boolean;
  readonly requiredTraceCount: 0 | 1;
  readonly laborGrossJmd: number;
  readonly laborDiscountJmd: number;
  readonly partsGrossJmd: number;
  readonly partsDiscountJmd: number;
}

export function invoiceSnapshotApprovalRequirement(
  snapshot: InvoiceChargeSnapshot,
): InvoiceSnapshotApprovalRequirement {
  validateInvoiceChargeSnapshot(snapshot);
  const requirement = discountApprovalRequirement(snapshot.lines.map(quotedFromSnapshot));
  return {
    required: requirement.required,
    laborExceeds: requirement.labor.exceedsThreshold,
    partsExceeds: requirement.parts.exceedsThreshold,
    requiredTraceCount: requirement.required ? 1 : 0,
    laborGrossJmd: requirement.labor.grossJmd,
    laborDiscountJmd: requirement.labor.discountJmd,
    partsGrossJmd: requirement.parts.grossJmd,
    partsDiscountJmd: requirement.parts.discountJmd,
  };
}

/**
 * A later Invoice version normally needs new raw strokes. The only exemption is
 * an actual fixed-other-service and/or parking-projection change which leaves
 * every labor/parts line and non-discount adjustment byte-for-byte unchanged.
 * Merely reissuing the same financial snapshot is not a parking-only change.
 */
export function invoiceSnapshotRequiresFreshApproval(
  previousSnapshot: InvoiceChargeSnapshot | null,
  nextSnapshot: InvoiceChargeSnapshot,
): boolean {
  const next = invoiceSnapshotApprovalRequirement(nextSnapshot);
  if (!next.required) return false;
  if (previousSnapshot === null) return true;
  const previous = invoiceSnapshotApprovalRequirement(previousSnapshot);
  if (previous.laborGrossJmd !== next.laborGrossJmd
    || previous.laborDiscountJmd !== next.laborDiscountJmd
    || previous.partsGrossJmd !== next.partsGrossJmd
    || previous.partsDiscountJmd !== next.partsDiscountJmd) {
    return true;
  }
  const previousUnitLines = previousSnapshot.lines.filter((line) => line.pricingMode === "unit");
  const nextUnitLines = nextSnapshot.lines.filter((line) => line.pricingMode === "unit");
  if (JSON.stringify(previousUnitLines) !== JSON.stringify(nextUnitLines)
    || JSON.stringify(previousSnapshot.adjustments) !== JSON.stringify(nextSnapshot.adjustments)) {
    return true;
  }
  const previousExemptLines = previousSnapshot.lines.filter((line) => line.pricingMode !== "unit");
  const nextExemptLines = nextSnapshot.lines.filter((line) => line.pricingMode !== "unit");
  return JSON.stringify(previousExemptLines) === JSON.stringify(nextExemptLines);
}

export interface InvoiceLineageOccupancy {
  readonly chargeLineId: string;
  readonly quantity?: number;
  readonly amountJmd: number;
}

export function validateInvoiceLineageTransition(input: {
  readonly previousSnapshots: ReadonlyArray<InvoiceChargeSnapshot>;
  readonly nextSnapshot: InvoiceChargeSnapshot;
  readonly refundOccupancies: ReadonlyArray<InvoiceLineageOccupancy>;
}): void {
  input.previousSnapshots.forEach(validateInvoiceChargeSnapshot);
  validateInvoiceChargeSnapshot(input.nextSnapshot);
  const previousById = new Map<string, InvoiceSnapshotLine>();
  for (const snapshot of input.previousSnapshots) {
    for (const line of snapshot.lines) {
      const existing = previousById.get(line.chargeLineId);
      if (existing && (existing.pricingMode !== line.pricingMode || existing.category !== line.category)) {
        throw new RangeError("stable Invoice lineage cannot change pricing mode or category");
      }
      previousById.set(line.chargeLineId, line);
    }
  }
  const nextById = new Map(input.nextSnapshot.lines.map((line) => [line.chargeLineId, line]));
  for (const [chargeLineId, previous] of previousById) {
    const next = nextById.get(chargeLineId);
    if (next && (previous.pricingMode !== next.pricingMode || previous.category !== next.category)) {
      throw new RangeError("stable Invoice lineage cannot change pricing mode or category");
    }
  }
  const occupiedById = new Map<string, { amountJmd: number; quantity: number }>();
  for (const occupancy of input.refundOccupancies) {
    assertNonEmpty(occupancy.chargeLineId, "refund occupancy charge lineage id");
    assertSafeNonNegative(occupancy.amountJmd, "refund occupancy amount");
    if (occupancy.quantity !== undefined) assertSafePositive(occupancy.quantity, "refund occupancy quantity");
    const previous = previousById.get(occupancy.chargeLineId);
    if (!previous) throw new RangeError("refund occupancy references an unknown Invoice lineage");
    const next = nextById.get(occupancy.chargeLineId);
    if (!next) {
      throw new RangeError("an occupied stable Invoice charge lineage cannot be deleted and recreated with a fresh id");
    }
    if (previous.pricingMode !== next.pricingMode || previous.category !== next.category) {
      throw new RangeError("an occupied stable Invoice lineage cannot change pricing mode or category");
    }
    if (next.pricingMode === "unit") {
      const aggregate = occupiedById.get(occupancy.chargeLineId) ?? { amountJmd: 0, quantity: 0 };
      aggregate.amountJmd = checkedAdd(
        aggregate.amountJmd,
        occupancy.amountJmd,
        "aggregate Invoice refund occupancy amount",
      );
      if (occupancy.quantity !== undefined) {
        aggregate.quantity = checkedAdd(
          aggregate.quantity,
          occupancy.quantity,
          "aggregate Invoice refund occupancy quantity",
        );
      }
      occupiedById.set(occupancy.chargeLineId, aggregate);
    } else if (next.pricingMode === "fixed_total") {
      if (previous.pricingMode !== "fixed_total" || next.amountJmd !== previous.amountJmd) {
        throw new RangeError("fixed-total Invoice lineage is frozen after any refund occupancy");
      }
    } else {
      throw new RangeError("parking projection occupancy is outside ordinary Invoice refunds");
    }
  }
  for (const [chargeLineId, occupied] of occupiedById) {
    const next = nextById.get(chargeLineId);
    if (!next || next.pricingMode !== "unit") {
      throw new RangeError("aggregate Invoice refund occupancy lost its stable unit lineage");
    }
    if (occupied.quantity > next.quantity) {
      throw new RangeError("aggregate occupied quantity exceeds the effective Invoice unit lineage quantity");
    }
    if (occupied.amountJmd > next.finalLineJmd) {
      throw new RangeError("aggregate occupied value exceeds the effective Invoice unit lineage value");
    }
  }
}

export function invoiceSnapshotLineToQuotedCharge(line: InvoiceSnapshotLine): QuotedChargeLine {
  validateInvoiceSnapshotLine(line);
  return quotedFromSnapshot(line);
}
