import { expect, test } from "@playwright/test";
import { saveAccountUiLanguage } from "@/lib/api/account-preferences";

test("formal account language preference is saved through the authenticated same-origin endpoint", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ uiLanguage: "en" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await expect(saveAccountUiLanguage("en", fetcher)).resolves.toBe("en");
  expect(calls).toHaveLength(1);
  expect(calls[0].input).toBe("/api/formal/auth/preferences");
  expect(calls[0].init).toMatchObject({
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uiLanguage: "en" }),
  });
});

test("failed account preference persistence rejects without claiming success", async () => {
  const fetcher: typeof fetch = async () => new Response(
    JSON.stringify({ code: "unauthorized" }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
  await expect(saveAccountUiLanguage("en", fetcher)).rejects.toThrow(/unauthorized/);
});
