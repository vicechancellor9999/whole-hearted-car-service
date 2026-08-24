import { describe, expect, it } from "vitest";
import { formatMinorAmount, parseMajorAmountToMinor } from "@/lib/money";

describe("exact money conversion", () => {
  it("converts a typed major-unit amount without floating point arithmetic", () => {
    expect(parseMajorAmountToMinor("5000")).toBe(500_000);
    expect(parseMajorAmountToMinor("5000.5")).toBe(500_050);
    expect(parseMajorAmountToMinor("0.01")).toBe(1);
  });

  it("rejects excess precision, separators, negatives and unsafe amounts", () => {
    expect(() => parseMajorAmountToMinor("1.001")).toThrow();
    expect(() => parseMajorAmountToMinor("5,000")).toThrow();
    expect(() => parseMajorAmountToMinor("-1")).toThrow();
    expect(() => parseMajorAmountToMinor("999999999999999999999")).toThrow();
  });

  it("formats stored minor units with exactly two decimals", () => {
    expect(formatMinorAmount(500_050)).toBe("5,000.50");
    expect(formatMinorAmount(1)).toBe("0.01");
  });
});
