import { expect, test } from "@playwright/test";
import RevenuePage from "../../src/app/revenue/page";

test("the formal revenue page accepts the day range used by the dashboard card", () => {
  expect(() => RevenuePage({ searchParams: { range: "day" } })).not.toThrow();
});
