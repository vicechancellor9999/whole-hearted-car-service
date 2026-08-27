import { expect, test } from "@playwright/test";
import {
  parkingElapsedDays,
  parkingLocalCalendarDate,
  parkingReminderDue,
} from "../../src/lib/api/mock-parking-followup";

// The public parking API contract now lives in parking-public-api.spec.ts.
// This file intentionally keeps only the pure Jamaica calendar boundary.
test("停车业务日期使用 Jamaica 本地公历日而不是 UTC 日", () => {
  const jamaicaLateEvening = Date.parse("2026-08-14T02:00:00.000Z");
  expect(parkingLocalCalendarDate(0, jamaicaLateEvening)).toBe("2026-08-13");
  expect(parkingLocalCalendarDate(-33, jamaicaLateEvening)).toBe("2026-07-11");
  expect(parkingElapsedDays("2026-07-11", jamaicaLateEvening)).toBe(33);
  expect(parkingReminderDue("2026-07-11", jamaicaLateEvening)).toBe(true);
});
