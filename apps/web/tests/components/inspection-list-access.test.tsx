import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FormalInspectionReportsWorkspace } from "../../src/components/orders/formal-inspection-reports-workspace";
import { createFormalInspectionReport, fetchFormalInspectionReports, type FormalInspectionListItem, type FormalInspectionReportList } from "../../src/lib/api/formal-inspections";

const item: FormalInspectionListItem = {
  report: { id: 9, reportNo: "IR-TEST-009", vehicleId: 2, sourceBusinessOrderId: null, sourceRepairRoundId: null, correctionOfReportId: null, correctionReason: null, inspectionTeamId: 3, summaryZh: "检查异响", summaryEn: null, specialCaseNotesZh: null, actualInspectorStaffMemberId: null, paperPhotoFileId: null, status: "draft", createdAt: "2026-09-05T08:00:00Z", submittedAt: null, version: 1, findings: [] },
  vehicle: { id: 2, plate: "4321AB", description: "Nissan X-Trail", descriptionZh: "日产 奇骏", descriptionEn: "Nissan X-Trail" },
  customer: { name: "David Blake", phone: "+18765550102", whatsapp: null, email: null },
  inspectorName: null, teamName: "车间一组", sourceBusinessOrder: null, followupStage: 2,
};
const navigation = vi.hoisted(() => ({ query: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, useSearchParams: () => new URLSearchParams(navigation.query) }));
vi.mock("../../src/lib/api/formal-inspections", () => ({ fetchFormalInspectionReports: vi.fn(), createFormalInspectionReport: vi.fn() }));
vi.mock("../../src/lib/api/formal-master-data", () => ({ fetchFormalMasterData: vi.fn().mockResolvedValue({ teams: [{ id: 3, name: "车间一组", isActive: true }], staff: [] }) }));
vi.mock("../../src/lib/customers/formal-customer-vehicle-adapter", () => ({ fetchFormalVehicleSearch: vi.fn().mockResolvedValue([{ id: 2, plateDisplay: "4321AB" }]) }));
vi.mock("../../src/components/customers/form-dialogs", () => ({ VehicleFormDialog: () => null }));
const result: FormalInspectionReportList = { items: [item], total: 1, pageCount: 1, page: 1, pageSize: 20, currentAccountId: 1 };
afterEach(cleanup);
beforeEach(() => { sessionStorage.clear(); navigation.query = ""; navigation.push.mockClear(); navigation.replace.mockClear(); vi.mocked(fetchFormalInspectionReports).mockReset().mockResolvedValue(result); });

it("waits for the initial account identity before accepting a creation draft and exposes retry on failed loading", async () => {
  let fail!: (error: Error) => void;
  vi.mocked(fetchFormalInspectionReports).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  render(<FormalInspectionReportsWorkspace />);
  expect((screen.getByRole("button", { name: "新建检查结果" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => fail(new Error("账号资料暂未读取")));
  expect((screen.getByRole("button", { name: "新建检查结果" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByTestId("inspection-reports-table");
  expect((screen.getByRole("button", { name: "新建检查结果" }) as HTMLButtonElement).disabled).toBe(false);
});

it.each(["success", "failure"])("isolates the next account's inspection dialog from an earlier account's late %s", async (outcome) => {
  let finish!: (report: typeof item.report) => void;
  let fail!: (error: Error) => void;
  vi.mocked(fetchFormalInspectionReports).mockResolvedValue({ ...result, currentAccountId: 1 });
  vi.mocked(createFormalInspectionReport).mockReset().mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const view = render(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-reports-table");
  fireEvent.click(screen.getByRole("button", { name: "新建检查结果" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "4321AB" } });
  fireEvent.click(await screen.findByRole("option", { name: /4321AB/ }));
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "账号一的检查" } });
  fireEvent.click(screen.getByRole("button", { name: "创建检查结果" }));
  navigation.query = "search=4321AB";
  vi.mocked(fetchFormalInspectionReports).mockResolvedValue({ ...result, currentAccountId: 2 });
  view.rerender(<FormalInspectionReportsWorkspace />);
  await waitFor(() => expect(fetchFormalInspectionReports).toHaveBeenCalledTimes(2));
  await act(async () => {});
  const summary = screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement;
  expect(summary.value).toBe("");
  expect(summary.matches(":disabled")).toBe(false);
  fireEvent.change(summary, { target: { value: "账号二的草稿" } });
  await act(async () => { if (outcome === "success") finish(item.report); else fail(new Error("账号一的创建异常")); });
  expect((screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement).value).toBe("账号二的草稿");
  expect(screen.queryByText("账号一的创建异常")).toBeNull();
  expect(fetchFormalInspectionReports).toHaveBeenCalledTimes(2);
  expect(navigation.push).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("wh:inspection-creation:v1:2")).toBeNull();
  expect(JSON.parse(sessionStorage.getItem("wh:inspection-creation:v1:1")!)[0].status).toBe(outcome === "success" ? "saved" : "unconfirmed");
});

it("retains the current account and unsaved inspection when a background list read fails", async () => {
  vi.mocked(fetchFormalInspectionReports).mockResolvedValue({ ...result, currentAccountId: 1 });
  const view = render(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-reports-table");
  fireEvent.click(screen.getByRole("button", { name: "新建检查结果" }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "读取失败也保留" } });
  vi.mocked(fetchFormalInspectionReports).mockRejectedValueOnce(new Error("列表暂时断开"));
  navigation.query = "search=4321AB";
  view.rerender(<FormalInspectionReportsWorkspace />);
  await waitFor(() => expect(fetchFormalInspectionReports).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect((screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement).value).toBe("读取失败也保留");
});

it("refreshes a background creation without closing the next inspection draft", async () => {
  let resolveSave!: (report: typeof item.report) => void;
  vi.mocked(createFormalInspectionReport).mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
  render(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-reports-table");
  fireEvent.click(screen.getByRole("button", { name: "新建检查结果" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "4321AB" } });
  fireEvent.click(await screen.findByRole("option", { name: /4321AB/ }));
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "上一份检查" } });
  fireEvent.click(screen.getByRole("button", { name: "创建检查结果" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭窗口，稍后核对" }));
  fireEvent.click(screen.getByRole("button", { name: "新建检查结果" }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "正在填写第二份" } });
  vi.mocked(fetchFormalInspectionReports).mockResolvedValue({ ...result, total: 2 });
  await act(async () => resolveSave(item.report));
  expect((screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement).value).toBe("正在填写第二份");
  expect(screen.getByRole("dialog", { name: "新建检查结果" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃更改" }));
  await screen.findByText("2 份检查结果");
});

it("recovers a closed failed inspection without replacing the next draft or submitting it again", async () => {
  let fail!: (error: Error) => void;
  vi.mocked(createFormalInspectionReport).mockReset().mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  render(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-reports-table");
  fireEvent.click(screen.getByRole("button", { name: "新建检查结果" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "4321AB" } });
  fireEvent.click(await screen.findByRole("option", { name: /4321AB/ }));
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "恢复第一份异响检查" } });
  fireEvent.change(screen.getByPlaceholderText("仅在有特殊情况时填写"), { target: { value: "保留备注" } });
  fireEvent.click(screen.getByRole("button", { name: "创建检查结果" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭窗口，稍后核对" }));
  const recovery = await screen.findByRole("region", { name: "检查创建恢复" });
  expect(within(recovery).getByText(/正在保存/)).toBeTruthy();
  expect(within(recovery).queryByRole("button", { name: "恢复填写并核对" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "新建检查结果" }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "第二份不被覆盖" } });
  await act(async () => fail(new Error("无法确认保存结果")));
  expect((screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement).value).toBe("第二份不被覆盖");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃更改" }));
  fireEvent.click(within(recovery).getByRole("button", { name: "恢复填写并核对" }));
  expect((screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement).value).toBe("恢复第一份异响检查");
  expect((screen.getByPlaceholderText("仅在有特殊情况时填写") as HTMLTextAreaElement).value).toBe("保留备注");
  expect(await screen.findByRole("radio", { name: /车间一组/, checked: true })).toBeTruthy();
  expect(within(screen.getByRole("dialog", { name: "新建检查结果" })).getByText("4321AB")).toBeTruthy();
  expect(screen.getByRole("link", { name: "打开检查结果列表核对（新标签页）" }).getAttribute("target")).toBe("_blank");
  expect(createFormalInspectionReport).toHaveBeenCalledTimes(1);
});

it("keeps independently submitted drafts when their background failures arrive out of order", async () => {
  const failures: Array<(error: Error) => void> = [];
  vi.mocked(createFormalInspectionReport).mockReset().mockImplementation(() => new Promise((_resolve, reject) => { failures.push(reject); }));
  render(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-reports-table");
  for (const summary of ["第一份原稿", "第二份原稿"]) {
    fireEvent.click(screen.getByRole("button", { name: "新建检查结果" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "4321AB" } });
    fireEvent.click(await screen.findByRole("option", { name: /4321AB/ }));
    fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
    fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: summary } });
    fireEvent.click(screen.getByRole("button", { name: "创建检查结果" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭窗口，稍后核对" }));
  }
  await act(async () => failures[1](new Error("第二次断开")));
  await act(async () => failures[0](new Error("第一次断开")));
  const recovery = screen.getByRole("region", { name: "检查创建恢复" });
  expect(within(recovery).getAllByRole("article")).toHaveLength(2);
  expect(within(recovery).getByText("第一次断开")).toBeTruthy();
  const second = within(recovery).getByText("第二次断开").closest("article")!;
  fireEvent.click(within(second).getByRole("button", { name: "恢复填写并核对" }));
  expect((screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement).value).toBe("第二份原稿");
  expect(createFormalInspectionReport).toHaveBeenCalledTimes(2);
});

it("offers a focusable report link instead of a mouse-only table row", async () => {
  render(<FormalInspectionReportsWorkspace />);
  const table = await screen.findByTestId("inspection-reports-table");
  const link = within(table).getByRole("link", { name: "IR-TEST-009" });
  expect(link.getAttribute("href")).toBe("/orders/inspections/9");
  link.focus();
  expect(document.activeElement).toBe(link);
});

it("keeps vehicle, customer, team and follow-up together in a mobile report card", async () => {
  render(<FormalInspectionReportsWorkspace />);
  const cards = await screen.findByTestId("inspection-report-cards");
  const card = within(cards).getByRole("link", { name: /4321AB/ });
  expect(card.getAttribute("href")).toBe("/orders/inspections/9");
  for (const text of ["IR-TEST-009", "David Blake", "+18765550102", "车间一组", "独立检查"]) expect(card.textContent).toContain(text);
});

it("carries the searched page into desktop links, row clicks and mobile cards", async () => {
  navigation.query = "search=David+%26+4321AB&page=3";
  vi.mocked(fetchFormalInspectionReports).mockResolvedValue({ ...result, page: 3, pageCount: 3, total: 41 });
  render(<FormalInspectionReportsWorkspace />);
  const table = await screen.findByTestId("inspection-reports-table");
  const href = "/orders/inspections/9?listSearch=David+%26+4321AB&listPage=3";
  expect(within(table).getByRole("link", { name: "IR-TEST-009" }).getAttribute("href")).toBe(href);
  expect(within(screen.getByTestId("inspection-report-cards")).getByRole("link").getAttribute("href")).toBe(href);
  fireEvent.click(within(table).getByText("车间一组"));
  expect(navigation.push).toHaveBeenCalledWith(href);
});

for (const page of ["Infinity", "1.5", "-2", "abc", "9007199254740992"]) {
  it(`recovers invalid page ${page} to page one without losing search`, async () => {
    navigation.query = `search=David&page=${page}`;
    render(<FormalInspectionReportsWorkspace />);
    await screen.findByTestId("inspection-reports-table");
    expect(fetchFormalInspectionReports).toHaveBeenCalledWith({ page: 1, search: "David" });
    expect(navigation.replace).toHaveBeenCalledWith("/orders/inspections?search=David", { scroll: false });
    expect(within(screen.getByTestId("inspection-reports-table")).getByRole("link").getAttribute("href")).toBe("/orders/inspections/9?listSearch=David");
  });
}

it("uses the server's actual page for navigation when the saved URL is past the last page", async () => {
  navigation.query = "search=David&page=999";
  vi.mocked(fetchFormalInspectionReports).mockResolvedValue({ ...result, page: 2, pageCount: 2, total: 21 });
  render(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-reports-table");
  expect(screen.getByText("第 2 / 2 页")).toBeTruthy();
  expect(within(screen.getByTestId("inspection-reports-table")).getByRole("link").getAttribute("href")).toBe("/orders/inspections/9?listSearch=David&listPage=2");
  expect(navigation.replace).toHaveBeenCalledWith("/orders/inspections?search=David&page=2", { scroll: false });
  fireEvent.click(screen.getByRole("button", { name: "上一页" }));
  expect(navigation.replace).toHaveBeenLastCalledWith("/orders/inspections?search=David", { scroll: false });
});

it("keeps IME composition visible without navigating until the Chinese text is committed", async () => {
  render(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-reports-table");
  const input = screen.getByRole("textbox", { name: "搜索检查结果" }) as HTMLInputElement;
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "che" } });
  expect(input.value).toBe("che");
  expect(navigation.replace).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "车" } });
  fireEvent.compositionEnd(input, { data: "车" });
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/orders/inspections?search=%E8%BD%A6", { scroll: false }));
});

it("updates the search box when navigation clears a user-entered query", async () => {
  const view = render(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-reports-table");
  fireEvent.change(screen.getByRole("textbox", { name: "搜索检查结果" }), { target: { value: "4321AB" } });
  navigation.query = "search=4321AB";
  view.rerender(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-reports-table");
  navigation.query = "";
  view.rerender(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-reports-table");
  expect((screen.getByRole("textbox", { name: "搜索检查结果" }) as HTMLInputElement).value).toBe("");
});

it("does not show the old total during a new query or after its failure and can retry", async () => {
  const view = render(<FormalInspectionReportsWorkspace />);
  await screen.findByText("1 份检查结果");
  let rejectRead!: (error: Error) => void;
  vi.mocked(fetchFormalInspectionReports).mockImplementationOnce(() => new Promise((_, reject) => { rejectRead = reject; }));
  navigation.query = "search=missing";
  view.rerender(<FormalInspectionReportsWorkspace />);
  expect(screen.getByTestId("inspection-reports-loading")).toBeTruthy();
  expect(screen.queryByText("1 份检查结果")).toBeNull();
  await act(async () => { rejectRead(new Error("连接失败")); });
  expect(screen.getByRole("alert").textContent).toContain("连接失败");
  expect(screen.queryByText(/份检查结果/)).toBeNull();
  vi.mocked(fetchFormalInspectionReports).mockResolvedValueOnce({ ...result, items: [], total: 0 });
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByTestId("inspection-report-empty");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("0 份检查结果")).toBeTruthy();
});

it("ignores an older query response that finishes after the current search", async () => {
  let finishOld!: (value: FormalInspectionReportList) => void;
  vi.mocked(fetchFormalInspectionReports).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  const view = render(<FormalInspectionReportsWorkspace />);
  vi.mocked(fetchFormalInspectionReports).mockResolvedValueOnce({ ...result, items: [], total: 0 });
  navigation.query = "search=missing";
  view.rerender(<FormalInspectionReportsWorkspace />);
  await screen.findByTestId("inspection-report-empty");
  await act(async () => { finishOld(result); });
  expect(screen.queryByTestId("inspection-reports-table")).toBeNull();
  expect(screen.getByText("0 份检查结果")).toBeTruthy();
});
