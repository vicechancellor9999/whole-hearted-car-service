import { expect, test } from "@playwright/test";
import {
  calculateParkingAccrual,
  validateParkingWaiver,
} from "../../src/lib/parking/calculations";
import { canonicalParkingNoticeFacts } from "../../src/lib/parking/notice";

test("canonical parking notice facts preserve first D across later sends and close invalid/no-case/picked boundaries", () => {
  expect(canonicalParkingNoticeFacts(null)).toBeNull();
  expect(canonicalParkingNoticeFacts({ notificationDate: "2026-08-20", pickupDate: "2026-08-21", dailyRateJmd: 2_500 })).toBeNull();
  const first = canonicalParkingNoticeFacts({ notificationDate: "2026-08-20", dailyRateJmd: 2_500 });
  expect(first).toEqual({
    notificationDate: "2026-08-20",
    graceThroughDate: "2026-08-21",
    chargeStartsDate: "2026-08-22",
    dailyRateJmd: 2_500,
    pickupDayExcluded: true,
  });
  expect(canonicalParkingNoticeFacts({ notificationDate: "2026-08-20", dailyRateJmd: 2_500 })).toEqual(first);
  for (const invalid of ["2026-02-30", "2026-13-01", "2026-8-20", ""] as const) {
    expect(() => canonicalParkingNoticeFacts({ notificationDate: invalid, dailyRateJmd: 2_500 })).toThrow(/日期/);
  }
});

test("8/10 notice and 8/13 pickup charges one day", () => {
  expect(calculateParkingAccrual({
    notificationDate: "2026-08-10",
    pickupDate: "2026-08-13",
    dailyRateJmd: 2_500,
  })).toEqual({ chargeableDays: 1, originalAmountJmd: 2_500 });
});

test("uses every calendar day and gives only D plus one grace day", () => {
  for (const [pickupDate, expectedDays] of [
    ["2026-08-10", 0],
    ["2026-08-11", 0],
    ["2026-08-12", 0],
    ["2026-08-13", 1],
    ["2026-09-01", 20],
    ["2027-01-01", 20],
  ] as const) {
    const notificationDate = pickupDate === "2026-09-01" ? "2026-08-10"
      : pickupDate === "2027-01-01" ? "2026-12-10" : "2026-08-10";
    expect(calculateParkingAccrual({ notificationDate, pickupDate, dailyRateJmd: 2_500 }).chargeableDays)
      .toBe(expectedDays);
  }
  expect(calculateParkingAccrual({
    notificationDate: "2026-08-08",
    pickupDate: "2026-08-11",
    dailyRateJmd: 2_500,
  })).toEqual({ chargeableDays: 1, originalAmountJmd: 2_500 });
  expect(calculateParkingAccrual({
    notificationDate: "2026-08-10",
    pickupDate: "2026-08-12",
    dailyRateJmd: 2_500,
  })).toEqual({ chargeableDays: 0, originalAmountJmd: 0 });
});

test("requires administrator signature only when same-case actual waiver exceeds 50000", () => {
  expect(validateParkingWaiver({
    caseId: "parking-case-1",
    originalChargeableDays: 24,
    dailyRateJmd: 2_500,
    existingWaivedDays: 0,
    existingWaivedAmountJmd: 0,
    proposedWaivedDays: 1,
    proposedWaivedAmountJmd: 2_500,
  })).toEqual({
    caseId: "parking-case-1",
    originalChargeableDays: 24,
    originalAmountJmd: 60_000,
    existingWaivedDays: 0,
    existingWaivedAmountJmd: 0,
    proposedWaivedDays: 1,
    proposedWaivedAmountJmd: 2_500,
    cumulativeWaivedDays: 1,
    cumulativeWaivedAmountJmd: 2_500,
    requiresAdministratorSignature: false,
    finalChargeableDays: 23,
    finalAmountJmd: 57_500,
  });

  expect(validateParkingWaiver({
    caseId: "parking-case-1",
    originalChargeableDays: 25,
    dailyRateJmd: 2_500,
    existingWaivedDays: 20,
    existingWaivedAmountJmd: 50_000,
    proposedWaivedDays: 0,
    proposedWaivedAmountJmd: 0,
  }).requiresAdministratorSignature).toBe(false);
  expect(validateParkingWaiver({
    caseId: "parking-case-1",
    originalChargeableDays: 25,
    dailyRateJmd: 2_500,
    existingWaivedDays: 20,
    existingWaivedAmountJmd: 50_000,
    proposedWaivedDays: 1,
    proposedWaivedAmountJmd: 2_500,
  }).requiresAdministratorSignature).toBe(true);
});

test("rejects invalid dates and non-whole-day or over-original waivers", () => {
  expect(() => calculateParkingAccrual({
    notificationDate: "2026-02-30",
    pickupDate: "2026-03-01",
    dailyRateJmd: 2_500,
  })).toThrow(/日期/);
  expect(() => calculateParkingAccrual({
    notificationDate: "2026-08-10",
    pickupDate: "2026-08-09",
    dailyRateJmd: 2_500,
  })).toThrow(/取车/);
  expect(() => validateParkingWaiver({
    caseId: "parking-case-1",
    originalChargeableDays: 24,
    dailyRateJmd: 2_500,
    existingWaivedDays: 0,
    existingWaivedAmountJmd: 0,
    proposedWaivedDays: 1,
    proposedWaivedAmountJmd: 1_000,
  })).toThrow(/整日/);
  expect(() => validateParkingWaiver({
    caseId: "parking-case-1",
    originalChargeableDays: 1,
    dailyRateJmd: 2_500,
    existingWaivedDays: 1,
    existingWaivedAmountJmd: 2_500,
    proposedWaivedDays: 1,
    proposedWaivedAmountJmd: 2_500,
  })).toThrow(/超过/);
  expect(() => validateParkingWaiver({
    caseId: "parking-case-1",
    originalChargeableDays: 2,
    dailyRateJmd: 2_500,
    existingWaivedDays: 0,
    existingWaivedAmountJmd: 2_500,
    proposedWaivedDays: 1,
    proposedWaivedAmountJmd: 2_500,
  })).toThrow(/天数.*金额/);
});
