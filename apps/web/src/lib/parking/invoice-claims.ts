import type { InvoiceParkingSnapshotLine } from "../billing/invoice-snapshots";

export interface ParkingClaimOwner {
  readonly logicalInvoiceId: string;
  readonly financiallyEffectiveVersionId: string;
  readonly chargeLineId: string;
}

export type ParkingClaimMap = Readonly<Record<string, ParkingClaimOwner>>;

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must not be empty`);
}

function assertMoney(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function validateClaim(caseId: string, claim: ParkingClaimOwner): void {
  assertNonEmpty(caseId, "parking case id");
  if (claim === null || typeof claim !== "object") throw new TypeError("parking claim must be an object");
  assertNonEmpty(claim.logicalInvoiceId, "parking claim logical Invoice id");
  assertNonEmpty(claim.financiallyEffectiveVersionId, "parking claim effective version id");
  assertNonEmpty(claim.chargeLineId, "parking claim charge lineage id");
}

export function transferParkingClaims(input: {
  readonly claims: ParkingClaimMap;
  readonly logicalInvoiceId: string;
  readonly previousEffectiveVersionId: string | null;
  readonly nextEffectiveVersionId: string;
  readonly nextParkingLines: ReadonlyArray<InvoiceParkingSnapshotLine>;
}): Record<string, ParkingClaimOwner> {
  if (input.claims === null || typeof input.claims !== "object" || Array.isArray(input.claims)) {
    throw new TypeError("parking claims must be a record");
  }
  assertNonEmpty(input.logicalInvoiceId, "logical Invoice id");
  assertNonEmpty(input.nextEffectiveVersionId, "next effective Invoice version id");
  if (input.previousEffectiveVersionId !== null) {
    assertNonEmpty(input.previousEffectiveVersionId, "previous effective Invoice version id");
  }
  if (!Array.isArray(input.nextParkingLines)) throw new TypeError("next parking lines must be an array");

  const nextByCase = new Map<string, InvoiceParkingSnapshotLine>();
  for (const line of input.nextParkingLines) {
    assertNonEmpty(line.parkingCaseId, "parking case id");
    assertNonEmpty(line.chargeLineId, "parking charge lineage id");
    if (nextByCase.has(line.parkingCaseId)) throw new RangeError(`duplicate parking case row: ${line.parkingCaseId}`);
    nextByCase.set(line.parkingCaseId, line);
  }

  const result: Record<string, ParkingClaimOwner> = {};
  for (const [caseId, claim] of Object.entries(input.claims)) {
    validateClaim(caseId, claim);
    result[caseId] = { ...claim };
    if (claim.logicalInvoiceId !== input.logicalInvoiceId) continue;
    if (input.previousEffectiveVersionId === null || claim.financiallyEffectiveVersionId !== input.previousEffectiveVersionId) {
      throw new RangeError(`stale parking claim owner for ${caseId}`);
    }
    const nextLine = nextByCase.get(caseId);
    if (!nextLine) throw new RangeError(`partial parking claim transfer is missing ${caseId}`);
    if (nextLine.chargeLineId !== claim.chargeLineId) {
      throw new RangeError(`parking claim ${caseId} must retain its stable charge lineage`);
    }
  }

  for (const [caseId, line] of nextByCase) {
    const claim = result[caseId];
    if (claim && claim.logicalInvoiceId !== input.logicalInvoiceId) {
      throw new RangeError(`parking case ${caseId} is occupied by another logical Invoice claim`);
    }
    if (claim && (
      input.previousEffectiveVersionId === null
      || claim.financiallyEffectiveVersionId !== input.previousEffectiveVersionId
      || claim.chargeLineId !== line.chargeLineId
    )) {
      throw new RangeError(`stale parking claim source for ${caseId}`);
    }
    result[caseId] = {
      logicalInvoiceId: input.logicalInvoiceId,
      financiallyEffectiveVersionId: input.nextEffectiveVersionId,
      chargeLineId: line.chargeLineId,
    };
  }
  return result;
}

export interface ParkingCorrectionAmounts {
  readonly parkingDeltaJmd: number;
  readonly parkingCashRefundJmd: number;
}

export function calculateParkingCorrectionAmounts(input: {
  readonly oldParkingAmountJmd: number;
  readonly newParkingAmountJmd: number;
  readonly receivableAfterCorrectionJmd: number;
  readonly netPaidBeforeJmd: number;
}): ParkingCorrectionAmounts {
  assertMoney(input.oldParkingAmountJmd, "old parking amount");
  assertMoney(input.newParkingAmountJmd, "new parking amount");
  assertMoney(input.receivableAfterCorrectionJmd, "receivable after parking correction");
  assertMoney(input.netPaidBeforeJmd, "net paid before parking correction");
  const parkingDeltaJmd = input.newParkingAmountJmd - input.oldParkingAmountJmd;
  if (!Number.isSafeInteger(parkingDeltaJmd)) throw new RangeError("parking delta exceeds the safe integer range");
  const parkingCashRefundJmd = Math.min(
    Math.max(0, -parkingDeltaJmd),
    Math.max(0, input.netPaidBeforeJmd - input.receivableAfterCorrectionJmd),
  );
  return { parkingDeltaJmd, parkingCashRefundJmd };
}
