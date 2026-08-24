import { describe, expect, it } from "vitest";
import { toBusinessDateKey, toBusinessMonthKey } from "@/lib/time";

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
});
