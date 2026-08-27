import type {
  FixedTotalChargeLine,
  ParkingProjectionChargeLine,
  QuotedChargeLine,
  QuotedChargeTotals,
  UnitPricedChargeLine,
} from "./types";

export type {
  FixedTotalChargeLine,
  ParkingProjectionChargeLine,
  QuotedChargeLine,
  QuotedChargeTotals,
  UnitPricedChargeLine,
} from "./types";

const FIXED_TOTAL_CODES = new Set<FixedTotalChargeLine["code"]>(["towing", "offsite_service", "other"]);
const COMMON_REQUIRED_FIELDS = ["id", "category", "pricingMode", "descZh", "descEn", "remarkZh", "remarkEn"] as const;
const UNIT_FIELDS = new Set<string>([
  ...COMMON_REQUIRED_FIELDS,
  "sourceId",
  "unit",
  "unitEn",
  "quantity",
  "unitPriceJmd",
  "unitDiscountJmd",
  "pendingQuote",
]);
const FIXED_TOTAL_FIELDS = new Set<string>([
  ...COMMON_REQUIRED_FIELDS,
  "sourceId",
  "code",
  "amountJmd",
]);
const PARKING_FIELDS = new Set<string>([
  ...COMMON_REQUIRED_FIELDS,
  "sourceId",
  "code",
  "parkingCaseId",
  "sourceRevision",
  "asOf",
  "amountJmd",
]);

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${label} must be text`);
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer JMD value`);
  }
}

function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function assertClosedOwnFields(value: object, allowed: ReadonlySet<string>, required: ReadonlyArray<string>, label: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new RangeError(`${label} contains an unexpected field: ${String(key)}`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new RangeError(`${label} is missing required field: ${key}`);
    }
  }
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError("charge total exceeds the safe integer JMD range");
  return result;
}

function checkedMultiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new RangeError("charge multiplication exceeds the safe integer JMD range");
  return result;
}

function validateCommonLine(line: QuotedChargeLine): void {
  assertNonEmptyString(line.id, "charge line id");
  assertNonEmptyString(line.descZh, "Chinese charge description");
  assertText(line.descEn, "English charge description");
  assertText(line.remarkZh, "Chinese charge remark");
  assertText(line.remarkEn, "English charge remark");
  if (line.sourceId !== undefined) assertNonEmptyString(line.sourceId, "charge source id");
}

function validateUnitLine(line: UnitPricedChargeLine): void {
  assertClosedOwnFields(
    line,
    UNIT_FIELDS,
    [...COMMON_REQUIRED_FIELDS, "unit", "unitEn", "quantity", "unitPriceJmd", "unitDiscountJmd", "pendingQuote"],
    "unit-priced charge schema",
  );
  if (line.category !== "labor" && line.category !== "parts") {
    throw new RangeError("unit-priced charge category must be labor or parts");
  }
  assertNonEmptyString(line.unit, "charge unit");
  assertText(line.unitEn, "English charge unit");
  assertPositiveSafeInteger(line.quantity, "quantity");
  assertNonNegativeSafeInteger(line.unitPriceJmd, "unitPriceJmd");
  assertNonNegativeSafeInteger(line.unitDiscountJmd, "unitDiscountJmd discount");
  if (line.unitDiscountJmd > line.unitPriceJmd) {
    throw new RangeError("unitDiscountJmd discount cannot exceed unitPriceJmd");
  }
  if (typeof line.pendingQuote !== "boolean") throw new TypeError("pendingQuote must be boolean");
  if (line.pendingQuote && line.category !== "parts") {
    throw new RangeError("pending quote is allowed only for parts lines");
  }
  if (line.pendingQuote && line.unitDiscountJmd !== 0) {
    throw new RangeError("pending quote lines must have zero discount");
  }
  checkedMultiply(line.quantity, line.unitPriceJmd);
  checkedMultiply(line.quantity, line.unitDiscountJmd);
}

function validateFixedTotalLine(line: FixedTotalChargeLine): void {
  assertClosedOwnFields(
    line,
    FIXED_TOTAL_FIELDS,
    [...COMMON_REQUIRED_FIELDS, "code", "amountJmd"],
    "fixed-total charge schema",
  );
  if (line.category !== "other_service" || !FIXED_TOTAL_CODES.has(line.code)) {
    throw new RangeError("fixed-total charge must be other_service with a supported code");
  }
  assertNonNegativeSafeInteger(line.amountJmd, "fixed-total amountJmd");
}

function validateParkingLine(line: ParkingProjectionChargeLine): void {
  assertClosedOwnFields(
    line,
    PARKING_FIELDS,
    [...COMMON_REQUIRED_FIELDS, "code", "parkingCaseId", "sourceRevision", "asOf", "amountJmd"],
    "parking projection schema",
  );
  if (line.category !== "other_service" || line.code !== "parking_overtime") {
    throw new RangeError("parking projection must use other_service / parking_overtime");
  }
  assertNonEmptyString(line.parkingCaseId, "parking case id");
  assertNonNegativeSafeInteger(line.sourceRevision, "parking source revision");
  if (typeof line.asOf !== "string" || Number.isNaN(Date.parse(line.asOf))) {
    throw new RangeError("parking asOf must be a valid instant");
  }
  assertNonNegativeSafeInteger(line.amountJmd, "parking amountJmd");
}

export function validateQuotedChargeLine(line: QuotedChargeLine): void {
  if (line === null || typeof line !== "object") throw new TypeError("charge line must be an object");
  validateCommonLine(line);
  if (line.pricingMode === "unit") return validateUnitLine(line);
  if (line.pricingMode === "fixed_total") return validateFixedTotalLine(line);
  if (line.pricingMode === "parking_projection") return validateParkingLine(line);
  throw new RangeError("unsupported charge pricingMode");
}

export interface CalculateQuotedChargeTotalsOptions {
  readonly includeParking?: boolean;
}

export function calculateQuotedChargeTotals(
  lines: ReadonlyArray<QuotedChargeLine>,
  options: CalculateQuotedChargeTotalsOptions = {},
): QuotedChargeTotals {
  if (!Array.isArray(lines)) throw new TypeError("charge lines must be an array");
  const ids = new Set<string>();
  let laborGrossJmd = 0;
  let laborDiscountJmd = 0;
  let laborNetJmd = 0;
  let partsGrossJmd = 0;
  let partsDiscountJmd = 0;
  let partsNetJmd = 0;
  let otherFeeTotalJmd = 0;
  let parkingTotalJmd = 0;
  let pendingPartsCount = 0;

  for (const line of lines) {
    validateQuotedChargeLine(line);
    if (ids.has(line.id)) throw new RangeError("duplicate charge line id");
    ids.add(line.id);

    if (line.pricingMode === "fixed_total") {
      otherFeeTotalJmd = checkedAdd(otherFeeTotalJmd, line.amountJmd);
      continue;
    }
    if (line.pricingMode === "parking_projection") {
      if (options.includeParking === true) parkingTotalJmd = checkedAdd(parkingTotalJmd, line.amountJmd);
      continue;
    }
    if (line.pendingQuote) {
      if (line.category === "parts") pendingPartsCount += 1;
      continue;
    }

    const grossLineJmd = checkedMultiply(line.quantity, line.unitPriceJmd);
    const lineDiscountJmd = checkedMultiply(line.quantity, line.unitDiscountJmd);
    const finalLineJmd = checkedMultiply(line.quantity, line.unitPriceJmd - line.unitDiscountJmd);
    if (line.category === "labor") {
      laborGrossJmd = checkedAdd(laborGrossJmd, grossLineJmd);
      laborDiscountJmd = checkedAdd(laborDiscountJmd, lineDiscountJmd);
      laborNetJmd = checkedAdd(laborNetJmd, finalLineJmd);
    } else {
      partsGrossJmd = checkedAdd(partsGrossJmd, grossLineJmd);
      partsDiscountJmd = checkedAdd(partsDiscountJmd, lineDiscountJmd);
      partsNetJmd = checkedAdd(partsNetJmd, finalLineJmd);
    }
  }

  const totalDiscountJmd = checkedAdd(laborDiscountJmd, partsDiscountJmd);
  const chargeSubtotalJmd = checkedAdd(
    checkedAdd(laborNetJmd, partsNetJmd),
    checkedAdd(otherFeeTotalJmd, parkingTotalJmd),
  );
  return {
    laborGrossJmd,
    laborDiscountJmd,
    laborNetJmd,
    partsGrossJmd,
    partsDiscountJmd,
    partsNetJmd,
    otherFeeTotalJmd,
    parkingTotalJmd,
    totalDiscountJmd,
    pendingPartsCount,
    chargeSubtotalJmd,
    grandTotalJmd: chargeSubtotalJmd,
  };
}

export interface OrderDiscountProposal {
  readonly id: string;
  readonly unitDiscountJmd: number;
  readonly finalUnitPriceJmd: number;
  readonly lineDiscountJmd: number;
  readonly finalLineJmd: number;
}

export interface OrderDiscountAllocation {
  readonly applicable: boolean;
  readonly targetDiscountJmd: number;
  readonly appliedDiscountJmd: number;
  readonly unallocatedDiscountJmd: number;
  readonly wholeOrderDiscountBeforeJmd: number;
  readonly wholeOrderDiscountAfterJmd: number;
  readonly proposals: ReadonlyArray<OrderDiscountProposal>;
}

const MAX_ALLOCATION_STATES = 250_000;
const MAX_ALLOCATION_CELLS = 2_000_000;

interface AllocationVariable {
  readonly line: UnitPricedChargeLine;
  readonly grossLineJmd: number;
  readonly baseDiscountJmd: number;
  readonly stepDiscountJmd: number;
  readonly maxSteps: number;
}

function allocationVariable(line: UnitPricedChargeLine): AllocationVariable {
  return {
    line,
    grossLineJmd: checkedMultiply(line.quantity, line.unitPriceJmd),
    baseDiscountJmd: checkedMultiply(line.quantity, line.unitPriceJmd % 50),
    stepDiscountJmd: checkedMultiply(line.quantity, 50),
    maxSteps: Math.floor(line.unitPriceJmd / 50),
  };
}

function assertSolverComplexity(capacitySteps: number, lineCount: number): void {
  const stateCount = capacitySteps + 1;
  if (
    stateCount > MAX_ALLOCATION_STATES
    || stateCount > Math.floor(MAX_ALLOCATION_CELLS / (lineCount + 1))
  ) {
    throw new RangeError("allocation complexity exceeds the bounded solver state space");
  }
}

/** Bounded-knapsack reachability in O(lines * capacity), without materializing line choices. */
function reachableAllocationSteps(
  variables: ReadonlyArray<AllocationVariable>,
  capacitySteps: number,
): Uint8Array {
  let reachable = new Uint8Array(capacitySteps + 1);
  reachable[0] = 1;
  for (const variable of variables) {
    const weight = variable.line.quantity;
    const next = new Uint8Array(capacitySteps + 1);
    const lastResidue = Math.min(weight - 1, capacitySteps);
    for (let residue = 0; residue <= lastResidue; residue += 1) {
      let remainingUses = -1;
      for (let step = residue; step <= capacitySteps; step += weight) {
        if (reachable[step] === 1) remainingUses = variable.maxSteps;
        else if (remainingUses >= 0) remainingUses -= 1;
        if (remainingUses >= 0) next[step] = 1;
      }
    }
    reachable = next;
  }
  return reachable;
}

function allocationLineScores(
  variable: AllocationVariable,
  capacitySteps: number,
  appliedDiscountJmd: number,
  participatingGrossJmd: number,
): ReadonlyArray<bigint> {
  const availableSteps = Math.min(variable.maxSteps, Math.floor(capacitySteps / variable.line.quantity));
  const scores: bigint[] = [];
  const applied = BigInt(appliedDiscountJmd);
  const grossTotal = BigInt(participatingGrossJmd);
  const grossLine = BigInt(variable.grossLineJmd);
  for (let steps = 0; steps <= availableSteps; steps += 1) {
    const lineDiscountJmd = variable.baseDiscountJmd + variable.stepDiscountJmd * steps;
    const error = BigInt(lineDiscountJmd) * grossTotal - applied * grossLine;
    scores.push(error * error);
  }
  return scores;
}

type AllocationCost = bigint | null;

/**
 * Exact min-plus convolution with a convex quadratic line cost. The Toeplitz
 * cost matrix is Monge, so row minimizers are monotone and divide-and-conquer
 * avoids the old Cartesian transition expansion.
 */
function prependAllocationLineCosts(
  variable: AllocationVariable,
  lineScores: ReadonlyArray<bigint>,
  suffixCosts: ReadonlyArray<AllocationCost>,
  capacitySteps: number,
): ReadonlyArray<AllocationCost> {
  const current: AllocationCost[] = Array.from({ length: capacitySteps + 1 }, () => null);
  const weight = variable.line.quantity;
  const lastResidue = Math.min(weight - 1, capacitySteps);

  for (let residue = 0; residue <= lastResidue; residue += 1) {
    const maxIndex = Math.floor((capacitySteps - residue) / weight);
    const feasibleRows: number[] = [];
    let reachableInWindow = 0;
    for (let row = 0; row <= maxIndex; row += 1) {
      if (suffixCosts[residue + weight * row] !== null) reachableInWindow += 1;
      const expired = row - variable.maxSteps - 1;
      if (expired >= 0 && suffixCosts[residue + weight * expired] !== null) reachableInWindow -= 1;
      if (reachableInWindow > 0) feasibleRows.push(row);
    }

    const solveRows = (rowStart: number, rowEnd: number, optionStart: number, optionEnd: number): void => {
      if (rowStart > rowEnd) return;
      const rowOffset = Math.floor((rowStart + rowEnd) / 2);
      const row = feasibleRows[rowOffset];
      const firstOption = Math.max(optionStart, 0, row - variable.maxSteps);
      const lastOption = Math.min(optionEnd, row);
      let bestCost: AllocationCost = null;
      let bestOption = -1;
      for (let option = firstOption; option <= lastOption; option += 1) {
        const suffixCost = suffixCosts[residue + weight * option];
        if (suffixCost === null) continue;
        const ownSteps = row - option;
        const candidate = suffixCost + lineScores[ownSteps];
        if (bestCost === null || candidate < bestCost) {
          bestCost = candidate;
          bestOption = option;
        }
      }
      if (bestOption < 0 || bestCost === null) {
        throw new Error("allocation solver lost a reachable state");
      }
      current[residue + weight * row] = bestCost;
      solveRows(rowStart, rowOffset - 1, optionStart, bestOption);
      solveRows(rowOffset + 1, rowEnd, bestOption, optionEnd);
    };

    if (feasibleRows.length > 0) solveRows(0, feasibleRows.length - 1, 0, maxIndex);
  }
  return current;
}

function exactAllocationSteps(
  variables: ReadonlyArray<AllocationVariable>,
  capacitySteps: number,
  appliedSteps: number,
  appliedDiscountJmd: number,
  participatingGrossJmd: number,
): ReadonlyArray<number> {
  const lineScores = variables.map((variable) => allocationLineScores(
    variable,
    capacitySteps,
    appliedDiscountJmd,
    participatingGrossJmd,
  ));
  const suffixCosts: Array<ReadonlyArray<AllocationCost>> = Array.from({ length: variables.length + 1 });
  const emptySuffix: AllocationCost[] = Array.from({ length: capacitySteps + 1 }, () => null);
  emptySuffix[0] = 0n;
  suffixCosts[variables.length] = emptySuffix;
  for (let index = variables.length - 1; index >= 0; index -= 1) {
    suffixCosts[index] = prependAllocationLineCosts(
      variables[index],
      lineScores[index],
      suffixCosts[index + 1],
      capacitySteps,
    );
  }

  const selected: number[] = [];
  let remainingSteps = appliedSteps;
  for (let index = 0; index < variables.length; index += 1) {
    const variable = variables[index];
    const targetCost = suffixCosts[index][remainingSteps];
    if (targetCost === null) throw new Error("allocation solver could not reconstruct the optimum");
    const maximum = Math.min(variable.maxSteps, Math.floor(remainingSteps / variable.line.quantity));
    let chosen = -1;
    for (let steps = maximum; steps >= 0; steps -= 1) {
      const nextSteps = remainingSteps - variable.line.quantity * steps;
      const nextCost = suffixCosts[index + 1][nextSteps];
      if (nextCost !== null && lineScores[index][steps] + nextCost === targetCost) {
        chosen = steps;
        remainingSteps = nextSteps;
        break;
      }
    }
    if (chosen < 0) throw new Error("allocation solver could not reconstruct a stable-ID optimum");
    selected.push(chosen);
  }
  if (remainingSteps !== 0) throw new Error("allocation solver reconstruction did not conserve the discount");
  return selected;
}

export function allocateOrderDiscount(
  lines: ReadonlyArray<QuotedChargeLine>,
  targetDiscountJmd: number,
  participatingIds: ReadonlyArray<string>,
): OrderDiscountAllocation {
  const totalsBefore = calculateQuotedChargeTotals(lines, { includeParking: true });
  assertNonNegativeSafeInteger(targetDiscountJmd, "target discount");
  if (!Array.isArray(participatingIds)) throw new TypeError("participant IDs must be an array");

  const byId = new Map(lines.map((line) => [line.id, line] as const));
  const requested = new Set<string>();
  for (const id of participatingIds) {
    assertNonEmptyString(id, "participant id");
    if (requested.has(id)) throw new RangeError("duplicate participant id");
    requested.add(id);
    const line = byId.get(id);
    if (line === undefined) throw new RangeError(`unknown participant id: ${id}`);
    if (line.pricingMode !== "unit") throw new RangeError(`participant ${id} must be a unit-priced labor or parts line`);
    if (line.pendingQuote) throw new RangeError(`pending quote participant ${id} is not eligible`);
  }

  const participants = participatingIds
    .map((id) => byId.get(id) as UnitPricedChargeLine)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  let participatingGrossJmd = 0;
  for (const line of participants) {
    participatingGrossJmd = checkedAdd(participatingGrossJmd, checkedMultiply(line.quantity, line.unitPriceJmd));
  }
  if (targetDiscountJmd > participatingGrossJmd) {
    throw new RangeError("target discount cannot exceed participating gross total");
  }

  const nonApplicable = (): OrderDiscountAllocation => ({
    applicable: false,
    targetDiscountJmd,
    appliedDiscountJmd: 0,
    unallocatedDiscountJmd: targetDiscountJmd,
    wholeOrderDiscountBeforeJmd: totalsBefore.totalDiscountJmd,
    wholeOrderDiscountAfterJmd: totalsBefore.totalDiscountJmd,
    proposals: [],
  });
  if (participants.length === 0) return nonApplicable();

  const variables = participants.map(allocationVariable);
  let baseDiscountJmd = 0;
  let totalAvailableSteps = 0;
  for (const variable of variables) {
    baseDiscountJmd = checkedAdd(baseDiscountJmd, variable.baseDiscountJmd);
    totalAvailableSteps = checkedAdd(
      totalAvailableSteps,
      checkedMultiply(variable.line.quantity, variable.maxSteps),
    );
  }
  if (baseDiscountJmd > targetDiscountJmd) return nonApplicable();
  const targetCapacitySteps = Math.floor((targetDiscountJmd - baseDiscountJmd) / 50);
  const capacitySteps = Math.min(targetCapacitySteps, totalAvailableSteps);
  assertSolverComplexity(capacitySteps, variables.length);
  const reachable = reachableAllocationSteps(variables, capacitySteps);
  let appliedSteps = capacitySteps;
  while (appliedSteps >= 0 && reachable[appliedSteps] !== 1) appliedSteps -= 1;
  if (appliedSteps < 0) return nonApplicable();
  const appliedDiscountJmd = checkedAdd(baseDiscountJmd, checkedMultiply(appliedSteps, 50));
  const selectedSteps = exactAllocationSteps(
    variables,
    capacitySteps,
    appliedSteps,
    appliedDiscountJmd,
    participatingGrossJmd,
  );
  const proposals = participants.map((line, index): OrderDiscountProposal => {
    const unitDiscountJmd = line.unitPriceJmd % 50 + selectedSteps[index] * 50;
    const finalUnitPriceJmd = line.unitPriceJmd - unitDiscountJmd;
    return {
      id: line.id,
      unitDiscountJmd,
      finalUnitPriceJmd,
      lineDiscountJmd: checkedMultiply(line.quantity, unitDiscountJmd),
      finalLineJmd: checkedMultiply(line.quantity, finalUnitPriceJmd),
    };
  });
  let previousParticipatingDiscountJmd = 0;
  for (const line of participants) {
    previousParticipatingDiscountJmd = checkedAdd(
      previousParticipatingDiscountJmd,
      checkedMultiply(line.quantity, line.unitDiscountJmd),
    );
  }
  const wholeOrderDiscountAfterJmd = checkedAdd(
    totalsBefore.totalDiscountJmd - previousParticipatingDiscountJmd,
    appliedDiscountJmd,
  );
  return {
    applicable: true,
    targetDiscountJmd,
    appliedDiscountJmd,
    unallocatedDiscountJmd: targetDiscountJmd - appliedDiscountJmd,
    wholeOrderDiscountBeforeJmd: totalsBefore.totalDiscountJmd,
    wholeOrderDiscountAfterJmd,
    proposals,
  };
}
