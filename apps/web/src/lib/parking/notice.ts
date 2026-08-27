import { parseParkingCalendarDate } from "./calculations";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ParkingNoticeFacts {
  readonly notificationDate: string;
  readonly graceThroughDate: string;
  readonly chargeStartsDate: string;
  readonly dailyRateJmd: number;
  readonly pickupDayExcluded: true;
}

function calendarDateFromTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Customer-facing parking wording must use the first canonical notice date.
 * Calling this helper later is pure: it never replaces D with today's date.
 */
export function canonicalParkingNoticeFacts(
  parking: { readonly notificationDate: string; readonly pickupDate?: string; readonly dailyRateJmd: number } | null,
): ParkingNoticeFacts | null {
  if (!parking) return null;
  const notificationAt = parseParkingCalendarDate(parking.notificationDate, "首次通知日期");
  if (parking.pickupDate) {
    parseParkingCalendarDate(parking.pickupDate, "取车日期");
    return null;
  }
  if (!Number.isSafeInteger(parking.dailyRateJmd) || parking.dailyRateJmd <= 0) {
    throw new RangeError("每日停车费必须为正整数");
  }
  return {
    notificationDate: parking.notificationDate,
    graceThroughDate: calendarDateFromTimestamp(notificationAt + DAY_MS),
    chargeStartsDate: calendarDateFromTimestamp(notificationAt + (2 * DAY_MS)),
    dailyRateJmd: parking.dailyRateJmd,
    pickupDayExcluded: true,
  };
}
