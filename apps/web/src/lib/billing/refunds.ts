import {
  validateInvoiceSnapshotLine,
  type InvoiceSnapshotLine,
} from "./invoice-snapshots";

export interface OrdinaryRefundHistoryFact {
  readonly chargeLineId: string;
  readonly quantity?: number;
  readonly receivableReductionJmd: number;
}

export interface LegacyRefundOccupancyFact {
  readonly chargeLineId?: string;
  readonly amountJmd: number;
  readonly quantityUnknown: boolean;
  readonly quantity?: number;
}

export interface OrdinaryLineRefundPreview {
  readonly chargeLineId: string;
  readonly pricingMode: "unit" | "fixed_total";
  readonly refundQuantity?: number;
  readonly wholeLine?: true;
  readonly requestedLineCreditJmd: number;
  readonly receivableReductionJmd: number;
  readonly cashRefundJmd: number;
  readonly outstandingBeforeJmd: number;
}

function assertMoney(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

function checkedAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} exceeds the safe integer range`);
  return result;
}

function checkedMultiply(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} exceeds the safe integer range`);
  return result;
}

export function previewOrdinaryLineRefund(input: {
  readonly line: InvoiceSnapshotLine;
  readonly refundQuantity?: number;
  readonly wholeLine?: true;
  readonly receivableBeforeRefundJmd: number;
  readonly netPaidBeforeJmd: number;
  readonly remainingInvoiceCreditJmd: number;
  readonly remainingLineCreditJmd?: number;
  readonly priorRefunds: ReadonlyArray<OrdinaryRefundHistoryFact>;
  readonly legacyOccupancies: ReadonlyArray<LegacyRefundOccupancyFact>;
  readonly legacyUnassignedOccupancyJmd?: number;
}): OrdinaryLineRefundPreview {
  validateInvoiceSnapshotLine(input.line);
  assertMoney(input.receivableBeforeRefundJmd, "receivable before refund");
  assertMoney(input.netPaidBeforeJmd, "net paid before refund");
  assertMoney(input.remainingInvoiceCreditJmd, "remaining Invoice credit");
  if (input.remainingLineCreditJmd !== undefined) {
    assertMoney(input.remainingLineCreditJmd, "remaining line credit");
  }
  assertMoney(input.legacyUnassignedOccupancyJmd ?? 0, "unassigned legacy occupancy");
  if ((input.legacyUnassignedOccupancyJmd ?? 0) > 0) {
    throw new RangeError("unassigned legacy refund occupancy requires reconciliation before a line refund");
  }
  if (!Array.isArray(input.priorRefunds) || !Array.isArray(input.legacyOccupancies)) {
    throw new TypeError("refund history and legacy occupancy must be arrays");
  }
  if (input.line.pricingMode === "parking_projection") {
    throw new RangeError("parking projections cannot use the ordinary line refund API");
  }

  let priorAmountJmd = 0;
  let priorQuantity = 0;
  let hasPriorLineFact = false;
  for (const refund of input.priorRefunds) {
    if (refund.chargeLineId !== input.line.chargeLineId) continue;
    hasPriorLineFact = true;
    assertMoney(refund.receivableReductionJmd, "prior receivable reduction");
    priorAmountJmd = checkedAdd(priorAmountJmd, refund.receivableReductionJmd, "prior refund total");
    if (refund.quantity !== undefined) {
      assertPositiveInteger(refund.quantity, "prior refund quantity");
      priorQuantity = checkedAdd(priorQuantity, refund.quantity, "prior refund quantity");
    } else if (input.line.pricingMode === "unit") {
      throw new RangeError("prior modern unit refund must retain its refund quantity");
    }
  }

  let occupiedAmountJmd = 0;
  let occupiedQuantity = 0;
  let hasLegacyLineFact = false;
  for (const occupancy of input.legacyOccupancies) {
    if (occupancy.chargeLineId !== input.line.chargeLineId) continue;
    hasLegacyLineFact = true;
    assertMoney(occupancy.amountJmd, "legacy occupancy amount");
    occupiedAmountJmd = checkedAdd(occupiedAmountJmd, occupancy.amountJmd, "legacy occupancy total");
    if (occupancy.quantityUnknown) {
      if (input.line.pricingMode === "unit") {
        throw new RangeError("legacy refund quantity is unknown and requires reconciliation");
      }
    } else if (occupancy.quantity !== undefined) {
      assertPositiveInteger(occupancy.quantity, "legacy occupancy quantity");
      occupiedQuantity = checkedAdd(occupiedQuantity, occupancy.quantity, "legacy occupancy quantity");
    } else if (input.line.pricingMode === "unit") {
      throw new RangeError("known legacy unit occupancy must retain its explicit quantity");
    }
  }

  const outstandingBeforeJmd = Math.max(0, input.receivableBeforeRefundJmd - input.netPaidBeforeJmd);
  if (input.line.pricingMode === "fixed_total") {
    if (input.wholeLine !== true || input.refundQuantity !== undefined) {
      throw new RangeError("fixed-total refunds require one explicit whole-line intent");
    }
    if (hasPriorLineFact || hasLegacyLineFact) {
      throw new RangeError("fixed-total lineage is frozen by an existing refund or occupancy");
    }
    const amountJmd = input.line.amountJmd;
    if (
      input.remainingLineCreditJmd === undefined
      || input.remainingLineCreditJmd < amountJmd
      || input.remainingInvoiceCreditJmd < amountJmd
      || input.receivableBeforeRefundJmd < amountJmd
    ) {
      throw new RangeError("the full fixed-total amount exceeds a line, Invoice, or receivable ceiling");
    }
    const cashRefundJmd = Math.max(0, amountJmd - outstandingBeforeJmd);
    return {
      chargeLineId: input.line.chargeLineId,
      pricingMode: "fixed_total",
      wholeLine: true,
      requestedLineCreditJmd: amountJmd,
      receivableReductionJmd: amountJmd,
      cashRefundJmd,
      outstandingBeforeJmd,
    };
  }

  assertPositiveInteger(input.refundQuantity, "refund quantity");
  if (input.wholeLine !== undefined) throw new RangeError("unit refunds use quantity rather than whole-line intent");
  const usedQuantity = checkedAdd(priorQuantity, occupiedQuantity, "occupied refund quantity");
  if (usedQuantity + input.refundQuantity > input.line.quantity) {
    throw new RangeError("cumulative refund quantity exceeds the effective Invoice line quantity");
  }
  const requestedLineCreditJmd = checkedMultiply(
    input.refundQuantity,
    input.line.finalUnitPriceJmd,
    "requested line credit",
  );
  const usedAmountJmd = checkedAdd(priorAmountJmd, occupiedAmountJmd, "occupied refund value");
  if (usedAmountJmd > input.line.finalLineJmd) {
    throw new RangeError("refund occupancy exceeds the stable Invoice line value");
  }
  const remainingLineCreditJmd = input.line.finalLineJmd - usedAmountJmd;
  const effectiveRemainingLineCreditJmd = input.remainingLineCreditJmd === undefined
    ? remainingLineCreditJmd
    : Math.min(remainingLineCreditJmd, input.remainingLineCreditJmd);
  const receivableReductionJmd = Math.min(
    requestedLineCreditJmd,
    effectiveRemainingLineCreditJmd,
    input.remainingInvoiceCreditJmd,
    input.receivableBeforeRefundJmd,
  );
  if (receivableReductionJmd <= 0) throw new RangeError("ordinary refund has no remaining receivable value");
  const cashRefundJmd = Math.max(0, receivableReductionJmd - outstandingBeforeJmd);
  return {
    chargeLineId: input.line.chargeLineId,
    pricingMode: "unit",
    refundQuantity: input.refundQuantity,
    requestedLineCreditJmd,
    receivableReductionJmd,
    cashRefundJmd,
    outstandingBeforeJmd,
  };
}
