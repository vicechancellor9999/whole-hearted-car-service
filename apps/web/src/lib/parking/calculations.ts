import type {
  ParkingAccrual,
  ParkingAccrualInput,
  ParkingWaiverInput,
  ParkingWaiverPreview,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ADMINISTRATOR_SIGNATURE_THRESHOLD_JMD = 50_000;

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label}必须为非负整数`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label}必须为正整数`);
  }
}

export function parseParkingCalendarDate(value: string, label: string): number {
  if (typeof value !== "string") throw new TypeError(`${label}必须为 YYYY-MM-DD 日期`);
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new RangeError(`${label}必须为 YYYY-MM-DD 日期`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new RangeError(`${label}不是有效公历日期`);
  }
  return timestamp;
}

function safeMultiply(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label}超过安全整数范围`);
  return result;
}

export function calculateParkingAccrual(input: ParkingAccrualInput): ParkingAccrual {
  const notificationAt = parseParkingCalendarDate(input.notificationDate, "首次通知日期");
  const pickupAt = parseParkingCalendarDate(input.pickupDate, "取车日期");
  assertPositiveInteger(input.dailyRateJmd, "每日停车费");
  if (pickupAt < notificationAt) throw new RangeError("取车日期不得早于首次通知日期");
  const elapsedDays = (pickupAt - notificationAt) / DAY_MS;
  const chargeableDays = Math.max(0, elapsedDays - 2);
  return {
    chargeableDays,
    originalAmountJmd: safeMultiply(chargeableDays, input.dailyRateJmd, "停车费"),
  };
}

function assertWholeDayAmount(value: number, rate: number, label: string): void {
  assertNonNegativeInteger(value, label);
  if (value % rate !== 0) throw new RangeError(`${label}必须为整日金额`);
}

export function validateParkingWaiver(input: ParkingWaiverInput): ParkingWaiverPreview {
  if (typeof input.caseId !== "string" || input.caseId.trim().length === 0) {
    throw new TypeError("停车案件 ID 不能为空");
  }
  assertNonNegativeInteger(input.originalChargeableDays, "原始计费天数");
  assertPositiveInteger(input.dailyRateJmd, "每日停车费");
  assertNonNegativeInteger(input.existingWaivedDays, "既有减免天数");
  assertNonNegativeInteger(input.proposedWaivedDays, "拟减免天数");
  assertWholeDayAmount(input.existingWaivedAmountJmd, input.dailyRateJmd, "既有减免金额");
  assertWholeDayAmount(input.proposedWaivedAmountJmd, input.dailyRateJmd, "拟减免金额");

  const originalAmountJmd = safeMultiply(input.originalChargeableDays, input.dailyRateJmd, "原始停车费");
  if (safeMultiply(input.existingWaivedDays, input.dailyRateJmd, "既有减免天数") !== input.existingWaivedAmountJmd) {
    throw new RangeError("既有减免天数与金额必须一致");
  }
  if (safeMultiply(input.proposedWaivedDays, input.dailyRateJmd, "拟减免天数") !== input.proposedWaivedAmountJmd) {
    throw new RangeError("拟减免天数与金额必须一致");
  }
  const cumulativeWaivedDays = input.existingWaivedDays + input.proposedWaivedDays;
  if (!Number.isSafeInteger(cumulativeWaivedDays)) throw new RangeError("累计减免天数超过安全整数范围");
  if (cumulativeWaivedDays > input.originalChargeableDays) throw new RangeError("累计减免天数不得超过原始计费天数");
  const cumulativeWaivedAmountJmd = input.existingWaivedAmountJmd + input.proposedWaivedAmountJmd;
  if (!Number.isSafeInteger(cumulativeWaivedAmountJmd)) throw new RangeError("累计减免金额超过安全整数范围");
  if (cumulativeWaivedAmountJmd > originalAmountJmd) throw new RangeError("累计减免金额不得超过原始计费");

  return {
    caseId: input.caseId,
    originalChargeableDays: input.originalChargeableDays,
    originalAmountJmd,
    existingWaivedDays: input.existingWaivedDays,
    existingWaivedAmountJmd: input.existingWaivedAmountJmd,
    proposedWaivedDays: input.proposedWaivedDays,
    proposedWaivedAmountJmd: input.proposedWaivedAmountJmd,
    cumulativeWaivedDays,
    cumulativeWaivedAmountJmd,
    requiresAdministratorSignature: cumulativeWaivedAmountJmd > ADMINISTRATOR_SIGNATURE_THRESHOLD_JMD,
    finalChargeableDays: input.originalChargeableDays - cumulativeWaivedDays,
    finalAmountJmd: originalAmountJmd - cumulativeWaivedAmountJmd,
  };
}

export interface ParkingFinalAccrual {
  readonly finalChargeableDays: number;
  readonly finalAmountJmd: number;
}

/** Apply the cumulative historical waiver to the current accrual clock. */
export function deriveParkingFinalAccrual(input: {
  readonly currentAccrual: ParkingAccrual;
  readonly dailyRateJmd: number;
  readonly latestWaiverDecision?: ParkingWaiverPreview;
}): ParkingFinalAccrual {
  assertNonNegativeInteger(input.currentAccrual.chargeableDays, "当前计费天数");
  assertNonNegativeInteger(input.currentAccrual.originalAmountJmd, "当前停车费");
  assertPositiveInteger(input.dailyRateJmd, "每日停车费");
  if (safeMultiply(input.currentAccrual.chargeableDays, input.dailyRateJmd, "当前停车费")
    !== input.currentAccrual.originalAmountJmd) {
    throw new RangeError("当前停车费天数与金额必须一致");
  }
  const cumulativeWaivedDays = input.latestWaiverDecision?.cumulativeWaivedDays ?? 0;
  const cumulativeWaivedAmountJmd = input.latestWaiverDecision?.cumulativeWaivedAmountJmd ?? 0;
  assertNonNegativeInteger(cumulativeWaivedDays, "累计减免天数");
  assertWholeDayAmount(cumulativeWaivedAmountJmd, input.dailyRateJmd, "累计减免金额");
  if (safeMultiply(cumulativeWaivedDays, input.dailyRateJmd, "累计减免天数") !== cumulativeWaivedAmountJmd) {
    throw new RangeError("累计减免天数与金额必须一致");
  }
  if (cumulativeWaivedDays > input.currentAccrual.chargeableDays
    || cumulativeWaivedAmountJmd > input.currentAccrual.originalAmountJmd) {
    throw new RangeError("累计减免不得超过当前停车费");
  }
  return {
    finalChargeableDays: input.currentAccrual.chargeableDays - cumulativeWaivedDays,
    finalAmountJmd: input.currentAccrual.originalAmountJmd - cumulativeWaivedAmountJmd,
  };
}
