import { describe, expect, it } from "vitest";
import {
  fromBusinessDateKey,
  nextBusinessDateStart,
  toBusinessDateKey,
  toBusinessMonthKey,
} from "@/lib/time";

describe("Jamaica business calendar", () => {
  it("keeps a UTC September timestamp in the Jamaica August business day", () => {
    const instant = new Date("2026-09-01T04:30:00.000Z");

    expect(toBusinessDateKey(instant)).toBe("2026-08-31");
    expect(toBusinessMonthKey(instant)).toBe("2026-08");
  });

  it("moves into the next Jamaica business day at local midnight", () => {
    const instant = new Date("2026-09-01T05:00:00.000Z");

    expect(toBusinessDateKey(instant)).toBe("2026-09-01");
    expect(toBusinessMonthKey(instant)).toBe("2026-09");
  });

  it("converts a Jamaica date filter to an exact UTC range", () => {
    expect(fromBusinessDateKey("2026-08-24")?.toISOString()).toBe(
      "2026-08-24T05:00:00.000Z",
    );
    expect(nextBusinessDateStart("2026-08-24")?.toISOString()).toBe(
      "2026-08-25T05:00:00.000Z",
    );
    expect(fromBusinessDateKey("2026-02-30")).toBeNull();
    expect(fromBusinessDateKey("2026-13-01")).toBeNull();
    expect(fromBusinessDateKey("not-a-date")).toBeNull();
  });
});
