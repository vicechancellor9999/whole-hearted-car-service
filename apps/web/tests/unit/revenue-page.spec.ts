import { expect, test } from "@playwright/test";
import RevenuePage from "../../src/app/revenue/page";

test("the formal revenue page accepts the async day range used by the dashboard card", async () => {
  await expect(
    Promise.resolve().then(() =>
      RevenuePage({ searchParams: Promise.resolve({ range: "day" }) } as never),
    ),
  ).resolves.toBeTruthy();
});
