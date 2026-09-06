import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormalInspectionCreateDialog } from "../../src/components/orders/formal-inspection-create-dialog";
import { createFormalInspectionReport } from "../../src/lib/api/formal-inspections";
import { fetchFormalMasterData } from "../../src/lib/api/formal-master-data";
import { fetchFormalVehicleSearch, type FormalVehicle } from "../../src/lib/customers/formal-customer-vehicle-adapter";

vi.mock("../../src/lib/api/formal-inspections", () => ({ createFormalInspectionReport: vi.fn() }));
vi.mock("../../src/lib/api/formal-master-data", () => ({ fetchFormalMasterData: vi.fn().mockResolvedValue({ teams: [{ id: 3, name: "车间一组", isActive: true }], staff: [] }) }));
vi.mock("../../src/components/customers/form-dialogs", () => ({ VehicleFormDialog: () => null }));
vi.mock("../../src/lib/customers/formal-customer-vehicle-adapter", () => ({
  fetchFormalVehicleSearch: vi.fn(),
  fetchFormalCustomerVehicleWorkspace: vi.fn(),
  adaptFormalCustomerVehicleWorkspace: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.mocked(fetchFormalVehicleSearch).mockReset(); });

it("passes the created report to the caller with original vehicle and source order intact", async () => {
  const report = { id: 91, reportNo: "IR-TEST-91" };
  vi.mocked(createFormalInspectionReport).mockResolvedValue(report as Awaited<ReturnType<typeof createFormalInspectionReport>>);
  const created = vi.fn();
  render(<FormalInspectionCreateDialog vehicleId={8} vehicleLabel="4321 AB · Nissan X-Trail" sourceBusinessOrderId={12} submitLabel="创建并打开报告" onClose={vi.fn()} onCreated={created} />);
  expect(screen.getByText("4321 AB · Nissan X-Trail")).toBeTruthy();
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "检查发动机异响" } });
  fireEvent.click(screen.getByRole("button", { name: "创建并打开报告" }));
  await waitFor(() => expect(created).toHaveBeenCalledWith(report));
  expect(createFormalInspectionReport).toHaveBeenCalledWith(expect.objectContaining({ vehicleId: 8, sourceBusinessOrderId: 12, inspectionTeamId: 3, summaryZh: "检查发动机异响" }));
});

it("records a pending submission before sending and restores its original order from the report list", async () => {
  const track = vi.fn();
  let rejectSave!: (error: Error) => void;
  vi.mocked(createFormalInspectionReport).mockImplementation((input) => {
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ id: "original-attempt", status: "pending", draft: expect.objectContaining({ sourceBusinessOrderId: 12, selectedVehicle: expect.objectContaining({ id: 8 }) }) }));
    expect(input).toMatchObject({ sourceBusinessOrderId: 12, vehicleId: 8 });
    return new Promise((_resolve, reject) => { rejectSave = reject; });
  });
  const view = render(<FormalInspectionCreateDialog initialDraft={{ recoveryAttemptId: "original-attempt", sourceBusinessOrderId: 12, selectedVehicle: { id: 8, title: "4321AB", detail: "Nissan" }, plateQuery: "4321AB", inspectionTeamId: "3", inspectorId: "", summaryZh: "原始检查", specialCaseNotesZh: "原始备注" }} onBackgroundStatus={track} onClose={vi.fn()} onCreated={vi.fn()} />);
  await screen.findByRole("radio", { name: /车间一组/ });
  fireEvent.click(screen.getByRole("button", { name: "创建检查结果" }));
  expect(createFormalInspectionReport).toHaveBeenCalledOnce();
  view.unmount();
  await act(async () => rejectSave(new Error("提交结果未知")));
  expect(track).toHaveBeenLastCalledWith(expect.objectContaining({ id: "original-attempt", status: "unconfirmed", error: "提交结果未知" }));
});

it("keeps the entered work and stays in the dialog after a failed submission", async () => {
  vi.mocked(createFormalInspectionReport).mockRejectedValue(new Error("暂时无法保存"));
  const created = vi.fn();
  render(<FormalInspectionCreateDialog vehicleId={8} onClose={vi.fn()} onCreated={created} />);
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  const summary = screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement;
  fireEvent.change(summary, { target: { value: "保留我的检查内容" } });
  fireEvent.click(screen.getByRole("button", { name: "创建检查结果" }));
  expect((await screen.findByRole("alert")).textContent).toContain("暂时无法保存");
  expect(summary.value).toBe("保留我的检查内容");
  expect(created).not.toHaveBeenCalled();
});

it("retries failed team loading in place without losing the inspection draft", async () => {
  vi.mocked(fetchFormalMasterData).mockRejectedValueOnce(new Error("班组资料暂时不可用"));
  render(<FormalInspectionCreateDialog vehicleId={8} onClose={vi.fn()} onCreated={vi.fn()} />);
  const summary = screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement;
  fireEvent.change(summary, { target: { value: "保留待录入检查" } });
  await screen.findByText("班组资料暂时不可用");
  fireEvent.click(screen.getByRole("button", { name: "重新加载班组" }));
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  expect(summary.value).toBe("保留待录入检查");
  expect(screen.queryByText("班组资料暂时不可用")).toBeNull();
  expect((screen.getByRole("button", { name: "创建检查结果" }) as HTMLButtonElement).disabled).toBe(false);
});

it("does not offer vehicle creation while search is pending or failed and retries the same plate", async () => {
  vi.mocked(fetchFormalVehicleSearch).mockRejectedValueOnce(new Error("车辆服务暂时不可用")).mockResolvedValueOnce([]);
  render(<FormalInspectionCreateDialog onClose={vi.fn()} onCreated={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox", { name: "输入车辆车牌号" }), { target: { value: "123AB" } });
  expect(screen.queryByRole("button", { name: "新建车辆" })).toBeNull();
  await screen.findByText("车辆服务暂时不可用");
  expect(screen.queryByText("没有匹配车辆")).toBeNull();
  expect(screen.queryByRole("button", { name: "新建车辆" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新搜索车辆" }));
  await screen.findByText("没有匹配车辆");
  expect(screen.getByRole("button", { name: "新建车辆" })).toBeTruthy();
  expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("123AB");
});

it("hides old plate matches immediately and ignores their late response", async () => {
  let resolveOld!: (vehicles: FormalVehicle[]) => void;
  vi.mocked(fetchFormalVehicleSearch)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce([{ id: 2, plateDisplay: "NEW22" } as FormalVehicle]);
  render(<FormalInspectionCreateDialog onClose={vi.fn()} onCreated={vi.fn()} />);
  const plate = screen.getByRole("combobox");
  fireEvent.change(plate, { target: { value: "OLD11" } });
  await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
  fireEvent.change(plate, { target: { value: "NEW22" } });
  await screen.findByRole("option", { name: /NEW22/ });
  await act(async () => resolveOld([{ id: 1, plateDisplay: "OLD11" } as FormalVehicle]));
  expect(screen.queryByRole("option", { name: /OLD11/ })).toBeNull();
  expect(screen.getByRole("option", { name: /NEW22/ })).toBeTruthy();
  fireEvent.change(plate, { target: { value: "NEXT33" } });
  expect(screen.queryByRole("option", { name: /NEW22/ })).toBeNull();
});

it("closes a clean dialog with Escape and isolates the background while open", async () => {
  const close = vi.fn();
  const view = render(<FormalInspectionCreateDialog vehicleId={8} onClose={close} onCreated={vi.fn()} />);
  await screen.findByRole("radio", { name: /车间一组/ });
  expect(document.body.style.overflow).toBe("hidden");
  expect(view.container.getAttribute("aria-hidden")).toBe("true");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.body.style.overflow).toBe("");
  expect(view.container.getAttribute("aria-hidden")).toBeNull();
});

it("asks before discarding a draft and keeps its inputs when continuing", async () => {
  const close = vi.fn();
  render(<FormalInspectionCreateDialog vehicleId={8} onClose={close} onCreated={vi.fn()} />);
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "不能丢失的检查记录" } });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect((screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement).value).toBe("不能丢失的检查记录");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "放弃更改" }));
  expect(close).toHaveBeenCalledOnce();
  expect(createFormalInspectionReport).not.toHaveBeenCalled();
});

it("keeps the dialog open and submits only once while creation is pending", async () => {
  let rejectSave!: (reason: Error) => void;
  vi.mocked(createFormalInspectionReport).mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
  const close = vi.fn();
  render(<FormalInspectionCreateDialog vehicleId={8} onClose={close} onCreated={vi.fn()} />);
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  const summary = screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement;
  fireEvent.change(summary, { target: { value: "请求中保留" } });
  const form = summary.closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  expect(createFormalInspectionReport).toHaveBeenCalledTimes(1);
  expect(summary.matches(":disabled")).toBe(true);
  expect(screen.getByText(/关闭窗口不会撤销这次保存/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "继续等待" }));
  await act(async () => rejectSave(new Error("稍后重试")));
  expect((await screen.findByRole("alert")).textContent).toContain("稍后重试");
  expect(summary.matches(":disabled")).toBe(false);
  expect(summary.value).toBe("请求中保留");
});

it("allows an explicit exit from a pending save without submitting again", async () => {
  let resolveSave!: (report: Awaited<ReturnType<typeof createFormalInspectionReport>>) => void;
  vi.mocked(createFormalInspectionReport).mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
  const close = vi.fn();
  const created = vi.fn();
  render(<FormalInspectionCreateDialog vehicleId={8} onClose={close} onCreated={created} />);
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "等待确认" } });
  fireEvent.click(screen.getByRole("button", { name: "创建检查结果" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭窗口，稍后核对" }));
  expect(close).toHaveBeenCalledOnce();
  expect(createFormalInspectionReport).toHaveBeenCalledTimes(1);
  const report = { id: 91, reportNo: "IR-TEST-91" } as Awaited<ReturnType<typeof createFormalInspectionReport>>;
  await act(async () => resolveSave(report));
  expect(created).toHaveBeenCalledWith(report, { background: true });
});

it("keeps the saved report accessible when opening the result fails, without creating it again", async () => {
  const report = { id: 91, reportNo: "IR-TEST-91" } as Awaited<ReturnType<typeof createFormalInspectionReport>>;
  vi.mocked(createFormalInspectionReport).mockResolvedValue(report);
  render(<FormalInspectionCreateDialog vehicleId={8} onClose={vi.fn()} onCreated={() => { throw new Error("导航失败"); }} />);
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "已保存内容" } });
  fireEvent.click(screen.getByRole("button", { name: "创建检查结果" }));
  const link = await screen.findByRole("link", { name: "打开检查结果" });
  expect(link.getAttribute("href")).toBe("/orders/inspections/91");
  expect(screen.getByText(/IR-TEST-91/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "创建检查结果" })).toBeNull();
  expect(screen.getByText(/检查结果已创建/)).toBeTruthy();
  expect(createFormalInspectionReport).toHaveBeenCalledTimes(1);
});
