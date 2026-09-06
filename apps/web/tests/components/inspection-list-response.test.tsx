import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormalInspectionReportsWorkspace } from "../../src/components/orders/formal-inspection-reports-workspace";
import { fetchFormalInspectionReports } from "../../src/lib/api/formal-inspections";
import { inspectionDetailFixture } from "../fixtures/inspection-detail";

const navigation = vi.hoisted(() => ({ query: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, useSearchParams: () => new URLSearchParams(navigation.query) }));

const { report, vehicle, customer, inspectorName, teamName, sourceBusinessOrder, followupStage } = inspectionDetailFixture;
const item = { report, vehicle, customer, inspectorName, teamName, sourceBusinessOrder, followupStage };
const list = { currentAccountId: 1, items: [item], page: 1, pageSize: 20, pageCount: 1, total: 1 };

beforeEach(() => { navigation.query = ""; vi.clearAllMocks(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows a read failure rather than a false empty list after incomplete HTTP 200, and retries the same filtered read", async () => {
  navigation.query = "search=4321AB";
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return Response.json(requests.length === 1 ? { currentAccountId: 1 } : list);
  });
  render(<FormalInspectionReportsWorkspace />);
  expect((await screen.findByRole("alert")).textContent).toContain("读取失败");
  expect(screen.queryByTestId("inspection-report-empty")).toBeNull();
  expect(screen.getByRole("status").textContent).not.toContain("0 份");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  const table = await screen.findByTestId("inspection-reports-table");
  expect(table.textContent).toContain("IR-20260905-0009");
  expect(table.textContent).toContain("4321AB");
  expect(screen.getByRole("status").textContent).toBe("1 份检查结果");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(requests).toEqual([
    "/api/formal/inspection-reports?page=1&search=4321AB",
    "/api/formal/inspection-reports?page=1&search=4321AB",
  ]);
});

it.each([
  ["missing items", { ...list, items: undefined }],
  ["non-array items", { ...list, items: {} }],
  ["null row", { ...list, items: [null] }],
  ["missing customer", { ...list, items: [{ ...item, customer: undefined }] }],
  ["different vehicle", { ...list, items: [{ ...item, vehicle: { ...vehicle, id: 99 } }] }],
  ["unknown follow-up state", { ...list, items: [{ ...item, followupStage: 7 }] }],
  ["missing total", { ...list, total: undefined }],
  ["negative total", { ...list, total: -1 }],
  ["fractional total", { ...list, total: 1.5 }],
  ["unsafe total", { ...list, total: Number.MAX_SAFE_INTEGER + 1 }],
  ["string page", { ...list, page: "1" }],
  ["zero page size", { ...list, pageSize: 0 }],
  ["missing page count", { ...list, pageCount: undefined }],
  ["page beyond last page", { ...list, page: 2 }],
  ["invalid supplied account", { ...list, currentAccountId: -1 }],
])("rejects %s before consumers can use a damaged list", async (_name, payload) => {
  vi.stubGlobal("fetch", async () => Response.json(payload));
  await expect(fetchFormalInspectionReports()).rejects.toThrow(/重新读取/);
});

it.each(["null", "[]", '{"items":', "<html>upstream error</html>"])("rejects an unusable HTTP 200 body: %s", async (body) => {
  vi.stubGlobal("fetch", async () => new Response(body));
  await expect(fetchFormalInspectionReports()).rejects.toThrow(/重新读取/);
});

it("keeps an actual empty result distinct from a read failure", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ...list, items: [], total: 0 }));
  render(<FormalInspectionReportsWorkspace />);
  expect((await screen.findByTestId("inspection-report-empty")).textContent).toContain("没有符合条件");
  expect(screen.getByRole("status").textContent).toBe("0 份检查结果");
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each([{ label: "short page", items: [item] }, { label: "empty page", items: [] }])("accepts a server-clamped $label during concurrent changes", async ({ items }) => {
  vi.stubGlobal("fetch", async () => Response.json({ ...list, items, total: 21, page: 2, pageCount: 2 }));
  const result = await fetchFormalInspectionReports({ page: 999 });
  expect(result.page).toBe(2);
  expect(result.total).toBe(21);
  expect(result.items.length).toBe(items.length);
});

it("preserves nullable business information and response extensions without requiring detail-only fields", async () => {
  vi.stubGlobal("fetch", async () => Response.json({
    ...list, currentAccountId: undefined, trace: "fixture-trace",
    items: [{ ...item, report: { ...report, summaryZh: "", currentWorkspaceVersionNo: 0, createdBy: 5 }, customer: { name: null, phone: null, whatsapp: null, email: null } }],
  }));
  const result = await fetchFormalInspectionReports();
  expect(result.items[0].customer.name).toBeNull();
  expect(result.items[0].report.summaryZh).toBe("");
  expect(result.items[0].sourceBusinessOrder).toBeNull();
  expect(result.items[0].report.findings).toEqual([]);
  expect(result.items[0].report).toHaveProperty("createdBy", 5);
  expect(result).toHaveProperty("trace", "fixture-trace");
});

it("does not replace a successful filtered list with a false zero count when the next read is malformed", async () => {
  let reads = 0;
  vi.stubGlobal("fetch", async () => Response.json(++reads === 1 ? list : { currentAccountId: 1 }));
  const view = render(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-reports-table");
  navigation.query = "search=4321AB";
  view.rerender(<FormalInspectionReportsWorkspace />);
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
  expect(screen.queryByTestId("inspection-report-empty")).toBeNull();
  expect(screen.getByRole("status").textContent).not.toContain("0 份");
  expect((screen.getByRole("button", { name: "新建检查结果" }) as HTMLButtonElement).disabled).toBe(false);
});
