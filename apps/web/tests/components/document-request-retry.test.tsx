import { afterEach, expect, it, vi } from "vitest";
import { generateFormalDocument } from "../../src/lib/api/formal-business-orders";

afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });

it("reuses the request identity after a lost response, but starts a new identity after confirmed success", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ ok: true, json: async () => ({ id: 42, documentNo: "OFF-42", businessOrderId: 42, kind: "office_archive" }) });
  vi.stubGlobal("fetch", fetcher);
  await expect(generateFormalDocument(42, "office_archive")).rejects.toThrow("offline");
  await generateFormalDocument(42, "office_archive");
  await generateFormalDocument(42, "office_archive");
  const keys = fetcher.mock.calls.map((call) => new Headers(call[1].headers).get("x-request-id"));
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

it("does not let a late response clear a newer pending request identity", async () => {
  const response = { ok: true, json: async () => ({ id: 43, documentNo: "OFF-43", businessOrderId: 43, kind: "office_archive" }) };
  let finishOld!: (value: typeof response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(response)
    .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(response);
  vi.stubGlobal("fetch", fetcher);
  const first = generateFormalDocument(43, "office_archive");
  const late = generateFormalDocument(43, "office_archive");
  await first;
  await expect(generateFormalDocument(43, "office_archive")).rejects.toThrow("offline");
  finishOld(response);
  await late;
  await generateFormalDocument(43, "office_archive");
  const keys = fetcher.mock.calls.map((call) => new Headers(call[1].headers).get("x-request-id"));
  expect(keys[2]).not.toBe(keys[0]);
  expect(keys[3]).toBe(keys[2]);
});

it("retains the request identity when a successful response body is interrupted", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("body interrupted"); } })
    .mockResolvedValue({ ok: true, json: async () => ({ id: 44, documentNo: "OFF-44", businessOrderId: 44, kind: "office_archive" }) });
  vi.stubGlobal("fetch", fetcher);
  await expect(generateFormalDocument(44, "office_archive")).rejects.toThrow();
  await generateFormalDocument(44, "office_archive");
  const keys = fetcher.mock.calls.map((call) => new Headers(call[1].headers).get("x-request-id"));
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});
