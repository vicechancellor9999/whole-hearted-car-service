import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FormalInspectionReportDetailView } from "../../src/components/orders/formal-inspection-report-detail";
import { fetchFormalInspectionReport, saveFormalInspectionWorkspace, organizeFormalInspectionReport, recordFormalInspectionNotification, type FormalInspectionReportDetail } from "../../src/lib/api/formal-inspections";

const detail: FormalInspectionReportDetail = {
  report: { id: 9, reportNo: "IR-20260905-0009", vehicleId: 2, sourceBusinessOrderId: null, sourceRepairRoundId: null, correctionOfReportId: null, correctionReason: null, inspectionTeamId: 3, summaryZh: "检查异响", summaryEn: null, specialCaseNotesZh: null, actualInspectorStaffMemberId: null, paperPhotoFileId: null, status: "draft", createdAt: "2026-09-05T08:00:00Z", submittedAt: null, version: 1, findings: [] },
  vehicle: { id: 2, plate: "4321AB", description: "Nissan X-Trail", descriptionZh: "日产 奇骏", descriptionEn: "Nissan X-Trail" },
  customer: { name: "David Blake", phone: "+18765550102", whatsapp: null, email: null },
  inspectorName: null, teamName: "车间一组", sourceBusinessOrder: null, followupStage: 2, communications: [],
  workspace: { versionNo: 0, source: "original", changeReason: "", createdAt: "2026-09-05T08:00:00Z", createdBy: 1, organized: { summaryZh: "检查异响", summaryEn: null, specialCaseNotesZh: null, findings: [] }, quotation: { status: "pending", noteZh: null, noteEn: null, lines: [] } },
};
const navigation = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(navigation.query) }));
vi.mock("../../src/lib/api/formal-inspections", () => ({ fetchFormalInspectionReport: vi.fn(), saveFormalInspectionWorkspace: vi.fn(), organizeFormalInspectionReport: vi.fn(), recordFormalInspectionNotification: vi.fn().mockResolvedValue({}) }));
vi.mock("../../src/components/shared/record-delete-dialog", () => ({ RecordDeleteButton: () => <button>删除</button> }));
afterEach(() => { window.dispatchEvent(new Event("afterprint")); cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
beforeEach(() => {
  navigation.query = "";
  vi.mocked(fetchFormalInspectionReport).mockReset().mockResolvedValue(structuredClone(detail));
  vi.mocked(saveFormalInspectionWorkspace).mockReset();
  vi.mocked(organizeFormalInspectionReport).mockReset();
  vi.mocked(recordFormalInspectionNotification).mockReset().mockResolvedValue({ id: 1, inspectionReportId: 9, vehicleId: 2, sourceBusinessOrderId: null, channel: "whatsapp", targetContact: "+18765550102", initiatedAt: "2026-09-05T08:00:00Z", initiatedBy: 1, status: "initiated", noteOrReply: null });
});

it("prints an isolated report snapshot and removes it after native print cancellation", async () => {
  let printed: HTMLElement | null = null;
  vi.spyOn(window, "print").mockImplementation(() => {
    printed = document.getElementById("wh-inspection-html-print-surface");
    window.dispatchEvent(new Event("beforeprint"));
  });
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "正式报告" }));
  fireEvent.click(screen.getByRole("button", { name: "150%" }));
  const original = document.getElementById("inspection-report-print-sheet")!;
  const text = original.textContent;
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "系统打印 / 存 PDF" })));
  const snapshot = printed as HTMLElement | null;
  expect(snapshot).not.toBeNull();
  expect(snapshot?.parentElement).toBe(document.body);
  expect(snapshot?.textContent).toBe(text);
  expect(snapshot?.style.zoom).toBe("1");
  expect(original.style.zoom).toBe("1.5");
  act(() => window.dispatchEvent(new Event("afterprint")));
  expect(document.getElementById("wh-inspection-html-print-surface")).toBeNull();
  expect(document.getElementById("inspection-report-print-sheet")).toBe(original);
  expect(original.style.zoom).toBe("1.5");
});

it("shows print failure with the report intact and permits retry", async () => {
  const nativePrint = vi.spyOn(window, "print").mockImplementationOnce(() => { throw new Error("模拟打印不可用"); });
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "正式报告" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "系统打印 / 存 PDF" })));
  expect(screen.getByRole("alert").textContent).toContain("模拟打印不可用");
  expect(document.getElementById("wh-inspection-html-print-surface")).toBeNull();
  expect(document.getElementById("inspection-report-print-sheet")?.textContent).toContain("检查异响");
  nativePrint.mockImplementation(() => window.dispatchEvent(new Event("beforeprint")));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "系统打印 / 存 PDF" })));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(nativePrint).toHaveBeenCalledTimes(2);
});

it("reports a silent print host instead of leaving the action waiting indefinitely", async () => {
  vi.spyOn(window, "print").mockImplementation(() => {});
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "正式报告" }));
  vi.useFakeTimers();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "系统打印 / 存 PDF" })));
  await act(async () => vi.advanceTimersByTimeAsync(3500));
  expect(screen.getByRole("alert").textContent).toContain("未启动系统打印");
  expect(document.getElementById("wh-inspection-html-print-surface")).toBeNull();
  expect((screen.getByRole("button", { name: "系统打印 / 存 PDF" }) as HTMLButtonElement).disabled).toBe(false);
});

it("changes report reading scale without changing its content or print action", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "正式报告" }));
  const reader = screen.getByRole("region", { name: "A4 检查报告预览" });
  const sheet = document.getElementById("inspection-report-print-sheet")!;
  const initialText = sheet.textContent;
  expect(reader.tabIndex).toBe(0);
  expect(sheet.style.zoom).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "150%" }));
  expect(sheet.style.zoom).toBe("1.5");
  expect(sheet.textContent).toBe(initialText);
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  expect(sheet.style.zoom).toBe("1");
  expect(screen.getByRole("button", { name: "系统打印 / 存 PDF" })).toBeTruthy();
});

it("fits the fixed A4 sheet to a resized reader and preserves a manual zoom choice", async () => {
  let resized!: ResizeObserverCallback;
  vi.stubGlobal("ResizeObserver", class { constructor(callback: ResizeObserverCallback) { resized = callback; } observe() {} disconnect() {} });
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "正式报告" }));
  const sheet = document.getElementById("inspection-report-print-sheet")!;
  const resize = (width: number) => act(() => resized([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
  resize(400);
  fireEvent.click(screen.getByRole("button", { name: "适合宽度" }));
  expect(Number(sheet.style.zoom)).toBeCloseTo(0.50397, 4);
  resize(600);
  expect(Number(sheet.style.zoom)).toBeCloseTo(0.75595, 4);
  fireEvent.click(screen.getByRole("button", { name: "150%" }));
  resize(300);
  expect(sheet.style.zoom).toBe("1.5");
});

it("distinguishes an unpriced editor line from an explicitly free quote", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  const editor = screen.getByTestId("inspection-quotation-editor");
  const total = () => within(editor).getByText("折后报价").parentElement!;
  expect(total().textContent).toContain("报价待补");
  fireEvent.click(within(editor).getByRole("button", { name: "新增报价项目" }));
  expect(total().textContent).toContain("报价待补");
  const price = within(editor).getByRole("textbox", { name: "含税单价 JMD" });
  fireEvent.change(price, { target: { value: "0" } });
  expect(total().querySelector("strong")?.textContent).toBe("JMD 0.00");
  fireEvent.change(price, { target: { value: "125" } });
  expect(total().querySelector("strong")?.textContent).toBe("JMD 125.00");
  fireEvent.change(price, { target: { value: "" } });
  expect(total().textContent).toContain("报价待补");
  expect(saveFormalInspectionWorkspace).not.toHaveBeenCalled();
});

it.each(["pending", "entered", "not_quoted"] as const)("does not present incomplete %s quotation totals as zero in the view or report", async (status) => {
  const incomplete = structuredClone(detail);
  incomplete.workspace.quotation = { status, noteZh: null, noteEn: null, lines: [{ kind: "labor", nameZh: "诊断", nameEn: "Diagnosis", descriptionZh: null, descriptionEn: null, quantity: "1", unitPriceMinor: null, subtotalMinor: null }] };
  vi.mocked(fetchFormalInspectionReport).mockResolvedValue(incomplete);
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  const quote = await screen.findByTestId("inspection-quote-table");
  const expected = status === "not_quoted" ? "本次不报价" : "报价待补";
  for (const label of within(quote).getAllByText("折后报价")) expect(label.parentElement?.querySelector("strong")?.textContent).toBe(expected);
  fireEvent.click(screen.getByRole("tab", { name: "正式报告" }));
  const report = document.querySelector("#inspection-report-report-workspace")!;
  for (const label of within(report as HTMLElement).getAllByText("折后报价")) expect((label.nextElementSibling ?? label.parentElement?.querySelector("strong"))?.textContent).toBe(expected);
  fireEvent.click(screen.getByRole("radio", { name: "English" }));
  for (const label of within(report as HTMLElement).getAllByText("Discounted quote")) expect((label.nextElementSibling ?? label.parentElement?.querySelector("strong"))?.textContent).toBe(status === "not_quoted" ? "No quote" : "Price pending");
  expect(within(report as HTMLElement).queryByText("待补", { exact: true })).toBeNull();
  expect(within(report as HTMLElement).getAllByText("Pending", { exact: true })).toHaveLength(2);
});

it.each([false, true])("groups the printable quote with qualified category totals (missing price: %s)", async (missingPrice) => {
  const quoted = structuredClone(detail);
  const line = { nameZh: "项目", nameEn: "Item", descriptionZh: null, descriptionEn: null, quantity: "1", unitPriceMinor: 10000, subtotalMinor: 10000 };
  quoted.workspace.quotation = { status: "entered", noteZh: null, noteEn: null, wholeOrderDiscountMinor: 500, lines: [
    { ...line, kind: "part", nameZh: "滤芯", unitPriceMinor: missingPrice ? null : 3000, subtotalMinor: missingPrice ? null : 3000 },
    { ...line, kind: "other", nameZh: "其他项目", unitPriceMinor: 0, subtotalMinor: 0 },
    { ...line, kind: "labor", nameZh: "诊断", itemDiscountMinor: 1000, subtotalMinor: 9000 },
    { ...line, kind: "labor", nameZh: "清洁" },
  ] };
  vi.mocked(fetchFormalInspectionReport).mockResolvedValue(quoted);
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "正式报告" }));
  const sheet = document.getElementById("inspection-report-print-sheet")!;
  const groups = () => [...sheet.querySelectorAll<HTMLElement>("[data-quote-kind]")];
  expect(groups().map((group) => group.dataset.quoteKind)).toEqual(["labor", "part", "other"]);
  expect(groups().map((group) => group.querySelector("[data-category-total]")?.textContent)).toEqual(["JMD 190.00", missingPrice ? "报价待补" : "JMD 30.00", "JMD 0.00"]);
  expect(within(groups()[0]).getByRole("heading", { name: "工时" })).toBeTruthy();
  expect(within(groups()[1]).getByRole("heading", { name: "配件 / 材料" })).toBeTruthy();
  expect(within(groups()[0]).getAllByText("JOB")).toHaveLength(2);
  const total = () => within(sheet).getAllByText("折后报价").at(-1)?.nextElementSibling?.textContent;
  expect(total()).toBe(missingPrice ? "报价待补" : "JMD 215.00");
  fireEvent.click(screen.getByRole("radio", { name: "English" }));
  expect(within(groups()[0]).getByRole("heading", { name: "Labor" })).toBeTruthy();
  expect(within(groups()[1]).getByRole("heading", { name: "Parts / materials" })).toBeTruthy();
  expect(groups()[1].querySelector("[data-category-total]")?.textContent).toBe(missingPrice ? "Price pending" : "JMD 30.00");
  fireEvent.click(screen.getByRole("radio", { name: "中英对照版" }));
  expect(within(groups()[0]).getByRole("heading", { name: "工时 / Labor" })).toBeTruthy();
  expect(within(groups()[1]).getByRole("heading", { name: "配件 / 材料 / Parts / materials" })).toBeTruthy();
  expect(saveFormalInspectionWorkspace).not.toHaveBeenCalled();
});

it("does not invent empty quotation categories on the printable report", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "正式报告" }));
  expect(document.querySelectorAll("#inspection-report-print-sheet [data-quote-kind]")).toHaveLength(0);
});

it("preserves an explicit line total without inventing its unit price, and masks a mixed incomplete total", async () => {
  const priced = structuredClone(detail);
  priced.workspace.quotation = { status: "entered", noteZh: null, noteEn: null, lines: [{ kind: "labor", nameZh: "诊断", nameEn: null, descriptionZh: null, descriptionEn: null, quantity: "2", unitPriceMinor: null, subtotalMinor: 12500 }] };
  vi.mocked(fetchFormalInspectionReport).mockResolvedValue(priced);
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  const quote = await screen.findByTestId("inspection-quote-table");
  for (const label of within(quote).getAllByText("折后报价")) expect(label.parentElement?.querySelector("strong")?.textContent).toBe("JMD 125.00");
  fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
  fireEvent.click(screen.getByRole("button", { name: "新增报价项目" }));
  fireEvent.click(screen.getByRole("button", { name: "完成编辑" }));
  for (const label of within(screen.getByTestId("inspection-quote-table")).getAllByText("折后报价")) expect(label.parentElement?.querySelector("strong")?.textContent).toBe("报价待补");
  expect(within(screen.getByTestId("inspection-quote-table")).getByText("工时合计").parentElement?.querySelector("strong")?.textContent).toBe("JMD 125.00");
});

it("keeps later manual edits until AI suggestions are reviewed and explicitly applied", async () => {
  let complete!: (value: Awaited<ReturnType<typeof organizeFormalInspectionReport>>) => void;
  vi.mocked(organizeFormalInspectionReport).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  const field = screen.getByRole("textbox", { name: "英文检查结论" });
  fireEvent.change(field, { target: { value: "Before AI" } });
  fireEvent.click(screen.getByRole("button", { name: "AI 整理并翻译" }));
  fireEvent.change(field, { target: { value: "My newer manual conclusion" } });
  await act(async () => complete({ organized: { ...detail.workspace.organized, summaryEn: "AI conclusion" }, quotation: detail.workspace.quotation }));
  expect((field as HTMLTextAreaElement).value).toBe("My newer manual conclusion");
  fireEvent.click(screen.getByRole("button", { name: "查看 AI 建议" }));
  const dialog = screen.getByRole("dialog", { name: "核对 AI 建议" });
  expect(within(dialog).getByText("My newer manual conclusion")).toBeTruthy();
  expect(within(dialog).getByText("AI conclusion")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "应用 AI 建议到草稿" }));
  expect((field as HTMLTextAreaElement).value).toBe("AI conclusion");
  expect(saveFormalInspectionWorkspace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "撤销本次整理" }));
  expect((field as HTMLTextAreaElement).value).toBe("My newer manual conclusion");
});

it("restores the unsaved pre-AI draft when an unchanged draft's AI result is reverted", async () => {
  vi.mocked(organizeFormalInspectionReport).mockResolvedValue({ organized: { ...detail.workspace.organized, summaryEn: "AI replacement" }, quotation: detail.workspace.quotation });
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  const field = screen.getByRole("textbox", { name: "英文检查结论" });
  fireEvent.change(field, { target: { value: "Unsaved human draft" } });
  fireEvent.click(screen.getByRole("button", { name: "AI 整理并翻译" }));
  fireEvent.click(await screen.findByRole("button", { name: "撤销本次整理" }));
  expect((field as HTMLTextAreaElement).value).toBe("Unsaved human draft");
});

it("stops an AI request, ignores its late completion and permits a new attempt", async () => {
  let complete!: (value: Awaited<ReturnType<typeof organizeFormalInspectionReport>>) => void;
  vi.mocked(organizeFormalInspectionReport).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  const field = screen.getByRole("textbox", { name: "英文检查结论" });
  fireEvent.change(field, { target: { value: "Keep this" } });
  fireEvent.click(screen.getByRole("button", { name: "AI 整理并翻译" }));
  fireEvent.click(screen.getByRole("button", { name: "停止整理" }));
  expect(vi.mocked(organizeFormalInspectionReport).mock.calls[0][1]?.signal?.aborted).toBe(true);
  let completeRetry!: (value: Awaited<ReturnType<typeof organizeFormalInspectionReport>>) => void;
  vi.mocked(organizeFormalInspectionReport).mockReturnValueOnce(new Promise((resolve) => { completeRetry = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "AI 整理并翻译" }));
  await act(async () => complete({ organized: { ...detail.workspace.organized, summaryEn: "Too late" }, quotation: detail.workspace.quotation }));
  expect((field as HTMLTextAreaElement).value).toBe("Keep this");
  expect(screen.queryByRole("button", { name: "查看 AI 建议" })).toBeNull();
  expect(screen.getByRole("button", { name: "停止整理" })).toBeTruthy();
  await act(async () => completeRetry({ organized: { ...detail.workspace.organized, summaryEn: "Retry result" }, quotation: detail.workspace.quotation }));
  await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe("Retry result"));
  expect(saveFormalInspectionWorkspace).not.toHaveBeenCalled();
});

it("keeps a failed AI attempt's manual draft and instruction available for retry", async () => {
  vi.mocked(organizeFormalInspectionReport).mockRejectedValueOnce(new Error("AI 暂时无法连接"));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  const field = screen.getByRole("textbox", { name: "英文检查结论" });
  fireEvent.change(field, { target: { value: "Manual draft to retain" } });
  fireEvent.change(screen.getByRole("textbox", { name: "告诉 AI 怎么改" }), { target: { value: "保留所有报价项目" } });
  fireEvent.click(screen.getByRole("button", { name: "按要求重新整理" }));
  await screen.findByText("AI 暂时无法连接");
  expect((field as HTMLTextAreaElement).value).toBe("Manual draft to retain");
  expect((screen.getByRole("textbox", { name: "告诉 AI 怎么改" }) as HTMLTextAreaElement).value).toBe("保留所有报价项目");
  expect((screen.getByRole("button", { name: "按要求重新整理" }) as HTMLButtonElement).disabled).toBe(false);
  expect(saveFormalInspectionWorkspace).not.toHaveBeenCalled();
});

it("preserves edits made during a save and uses the confirmed version for the next explicit save", async () => {
  let complete!: (value: FormalInspectionReportDetail) => void;
  vi.mocked(saveFormalInspectionWorkspace).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  const conclusion = screen.getByRole("textbox", { name: "英文检查结论" });
  fireEvent.change(conclusion, { target: { value: "Submitted conclusion" } });
  fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
  fireEvent.change(conclusion, { target: { value: "Newer unsaved conclusion" } });
  const saved = structuredClone(detail);
  saved.report.version = 2;
  saved.workspace.versionNo = 1;
  saved.workspace.source = "manual";
  saved.workspace.organized.summaryEn = "Submitted conclusion";
  await act(async () => complete(saved));
  expect((conclusion as HTMLTextAreaElement).value).toBe("Newer unsaved conclusion");
  expect(screen.getByRole("status").textContent).toContain("后续修改尚未保存");
  expect(saveFormalInspectionWorkspace).toHaveBeenCalledTimes(1);
  vi.mocked(saveFormalInspectionWorkspace).mockRejectedValueOnce(new Error("下一次保存暂时失败"));
  fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
  await screen.findByText("下一次保存暂时失败");
  expect(saveFormalInspectionWorkspace).toHaveBeenLastCalledWith(9, expect.objectContaining({ expectedVersion: 2, organized: expect.objectContaining({ summaryEn: "Newer unsaved conclusion" }) }));
  expect((conclusion as HTMLTextAreaElement).value).toBe("Newer unsaved conclusion");
});

it("clears the previous success notice when a subsequent save fails", async () => {
  const saved = structuredClone(detail);
  saved.report.version = 2;
  saved.workspace.versionNo = 1;
  vi.mocked(saveFormalInspectionWorkspace).mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error("保存失败，请核对"));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "保存版本" }));
  await screen.findByText("已保存新的报告草稿版本；维修工原始回单没有被覆盖。");
  fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
  await screen.findByText("保存失败，请核对");
  expect(screen.queryByText("已保存新的报告草稿版本；维修工原始回单没有被覆盖。")).toBeNull();
});

it("returns to the original search and page rather than the unfiltered list", async () => {
  navigation.query = "listSearch=David+%26+4321AB&listPage=3";
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  const back = await screen.findByRole("link", { name: "返回检查结果列表" });
  expect(back.getAttribute("href")).toBe("/orders/inspections?search=David+%26+4321AB&page=3");
});

it("keeps malformed return parameters on the inspection list with a valid page", async () => {
  navigation.query = "listSearch=https%3A%2F%2Fexample.com&listPage=-5";
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  const back = await screen.findByRole("link", { name: "返回检查结果列表" });
  expect(back.getAttribute("href")).toBe("/orders/inspections?search=https%3A%2F%2Fexample.com");
});

it("keeps one application main landmark and all report actions accessible", async () => {
  render(<main><FormalInspectionReportDetailView inspectionReportId={9} /></main>);
  await screen.findByRole("heading", { name: "IR-20260905-0009" });
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "返回检查结果列表" }).getAttribute("href")).toBe("/orders/inspections");
  expect(screen.getByRole("button", { name: "更正跟进状态" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
  expect(within(screen.getByTestId("inspection-report-vehicle")).getByText(/4321AB/)).toBeTruthy();
  expect(within(screen.getByTestId("inspection-report-customer")).getByText("David Blake")).toBeTruthy();
});

it("opens the existing editor from a missing English conclusion", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "补充英文结论" }));
  const field = screen.getByRole("textbox", { name: "英文检查结论" }) as HTMLTextAreaElement;
  expect(field.value).toBe("");
  fireEvent.change(field, { target: { value: "Inspect the noise." } });
  fireEvent.click(screen.getByRole("button", { name: "完成编辑" }));
  expect(screen.getByText("Inspect the noise.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "补充英文结论" })).toBeNull();
  expect(screen.getByRole("button", { name: "保存版本" })).toBeTruthy();
});

it("uses JOB for labor in both the workspace and printable report", async () => {
  const quoted = structuredClone(detail);
  quoted.workspace.quotation = { status: "entered", noteZh: null, noteEn: null, lines: [{ kind: "labor", nameZh: "诊断", nameEn: "Diagnosis", descriptionZh: null, descriptionEn: null, quantity: "1", unitPriceMinor: 1500000, subtotalMinor: 1500000 }] };
  vi.mocked(fetchFormalInspectionReport).mockResolvedValue(quoted);
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  const quote = await screen.findByTestId("inspection-quote-table");
  expect(within(quote).getAllByText(/JOB/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("tab", { name: "正式报告" }));
  expect(within(screen.getByRole("tabpanel")).getByRole("cell", { name: "JOB" })).toBeTruthy();
});

it("removes the read failure after retry succeeds", async () => {
  vi.mocked(fetchFormalInspectionReport).mockRejectedValueOnce(new Error("连接中断，请重试"));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "重试" }));
  await screen.findByRole("heading", { name: "IR-20260905-0009" });
  await waitFor(() => expect(screen.queryByText("连接中断，请重试")).toBeNull());
});

it("preserves an unsaved report draft when a follow-up correction refreshes history", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  fireEvent.change(screen.getByRole("textbox", { name: "英文检查结论" }), { target: { value: "My unsaved inspection." } });
  fireEvent.click(screen.getByRole("button", { name: "更正跟进状态" }));
  fireEvent.change(screen.getByRole("textbox", { name: "更正原因" }), { target: { value: "修正录入状态" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "保存更正" })); });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((screen.getByRole("textbox", { name: "英文检查结论" }) as HTMLTextAreaElement).value).toBe("My unsaved inspection.");
});

it("shows correction failures inside the dialog and retries with the original reason and stage", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "更正跟进状态" }));
  const dialog = screen.getByRole("dialog", { name: "更正跟进状态" });
  fireEvent.click(within(dialog).getByRole("radio", { name: "待发送" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "更正原因" }), { target: { value: "保留我的更正原因" } });
  vi.mocked(recordFormalInspectionNotification).mockRejectedValueOnce(new Error("网络断开"));
  fireEvent.click(within(dialog).getByRole("button", { name: "保存更正" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("网络断开");
  expect((within(dialog).getByRole("textbox", { name: "更正原因" }) as HTMLTextAreaElement).value).toBe("保留我的更正原因");
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "保存更正" })); });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(recordFormalInspectionNotification).toHaveBeenLastCalledWith(expect.objectContaining({ status: "not_delivered", noteOrReply: "状态更正：保留我的更正原因" }));
});

it("lets Escape close correction without writing and restores the page", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "更正跟进状态" }));
  const dialog = screen.getByRole("dialog", { name: "更正跟进状态" });
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.body.style.overflow).not.toBe("hidden");
  expect(recordFormalInspectionNotification).not.toHaveBeenCalled();
});

it("can leave a pending correction, reopen the same attempt, and retain its input after failure", async () => {
  let rejectSave!: (error: Error) => void;
  vi.mocked(recordFormalInspectionNotification).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "更正跟进状态" }));
  fireEvent.click(screen.getByRole("radio", { name: "待发送" }));
  fireEvent.change(screen.getByRole("textbox", { name: "更正原因" }), { target: { value: "更正误记的已发送状态" } });
  fireEvent.click(screen.getByRole("button", { name: "保存更正" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭更正跟进状态" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("保存尚未返回");
  fireEvent.click(screen.getByRole("tab", { name: "客户跟进" }));
  expect(screen.getByRole("heading", { name: "客户跟进历史" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "查看保存进度" }));
  expect((screen.getByRole("textbox", { name: "更正原因" }) as HTMLTextAreaElement).value).toBe("更正误记的已发送状态");
  expect((screen.getByRole("radio", { name: "待发送" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("button", { name: "正在保存…" }) as HTMLButtonElement).disabled).toBe(true);
  expect(recordFormalInspectionNotification).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "关闭更正跟进状态" }));
  await act(async () => rejectSave(new Error("无法确认保存结果")));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("无法确认保存结果");
  fireEvent.click(screen.getByRole("button", { name: "查看更正内容" }));
  expect((screen.getByRole("textbox", { name: "更正原因" }) as HTMLTextAreaElement).value).toBe("更正误记的已发送状态");
  expect((screen.getByRole("radio", { name: "待发送" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("button", { name: "保存更正" }) as HTMLButtonElement).disabled).toBe(false);
  expect(recordFormalInspectionNotification).toHaveBeenCalledTimes(1);
});

it("announces background correction success without reopening the closed dialog", async () => {
  let resolveSave!: (value: Awaited<ReturnType<typeof recordFormalInspectionNotification>>) => void;
  vi.mocked(recordFormalInspectionNotification).mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "更正跟进状态" }));
  fireEvent.change(screen.getByRole("textbox", { name: "更正原因" }), { target: { value: "后台更正测试" } });
  fireEvent.click(screen.getByRole("button", { name: "保存更正" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭更正跟进状态" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => resolveSave({ id: 1, inspectionReportId: 9, vehicleId: 2, sourceBusinessOrderId: null, channel: "whatsapp", targetContact: "+18765550102", initiatedAt: "2026-09-05T08:00:00Z", initiatedBy: 1, status: "initiated", noteOrReply: "状态更正：后台更正测试" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("当前跟进状态已更正");
  fireEvent.click(screen.getByRole("button", { name: "更正跟进状态" }));
  expect((screen.getByRole("textbox", { name: "更正原因" }) as HTMLTextAreaElement).value).toBe("");
});

it("does not carry the unsaved draft into a different report", async () => {
  const view = render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  fireEvent.change(screen.getByRole("textbox", { name: "英文检查结论" }), { target: { value: "Report nine only" } });
  const other = structuredClone(detail);
  other.report.id = 10;
  other.report.reportNo = "IR-20260905-0010";
  other.workspace.organized.summaryEn = "Report ten";
  vi.mocked(fetchFormalInspectionReport).mockResolvedValue(other);
  view.rerender(<FormalInspectionReportDetailView inspectionReportId={10} />);
  await screen.findByRole("heading", { name: "IR-20260905-0010" });
  expect(screen.queryByDisplayValue("Report nine only")).toBeNull();
});

it("keeps the draft's original version guard after a concurrent report update", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  fireEvent.change(screen.getByRole("textbox", { name: "英文检查结论" }), { target: { value: "My local draft" } });
  const newer = structuredClone(detail);
  newer.report.version = 2;
  vi.mocked(fetchFormalInspectionReport).mockResolvedValue(newer);
  vi.mocked(saveFormalInspectionWorkspace).mockImplementation(async (_id, input) => {
    if (input.expectedVersion !== 2) throw new Error("其他人已更新报告，请核对版本");
    return newer;
  });
  fireEvent.click(screen.getByRole("button", { name: "更正跟进状态" }));
  fireEvent.change(screen.getByRole("textbox", { name: "更正原因" }), { target: { value: "更新跟进" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "保存更正" })); });
  fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
  expect((await screen.findByRole("alert")).textContent).toContain("其他人已更新报告");
  expect((screen.getByRole("textbox", { name: "英文检查结论" }) as HTMLTextAreaElement).value).toBe("My local draft");
});

it("preserves a later reply draft when an earlier submission completes", async () => {
  let complete!: (value: Awaited<ReturnType<typeof recordFormalInspectionNotification>>) => void;
  vi.mocked(recordFormalInspectionNotification).mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "客户跟进" }));
  const reply = screen.getByPlaceholderText("例如：客户有意向，下周再确认。") as HTMLTextAreaElement;
  fireEvent.change(reply, { target: { value: "客户第一次回复" } });
  fireEvent.submit(reply.form!);
  fireEvent.change(reply, { target: { value: "等待时补充的新回复" } });
  await act(async () => complete({ id: 1, inspectionReportId: 9, vehicleId: 2, sourceBusinessOrderId: null, channel: "whatsapp", targetContact: "+18765550102", initiatedAt: "2026-09-05T08:00:00Z", initiatedBy: 1, status: "confirmed", noteOrReply: "客户第一次回复" }));
  expect(reply.value).toBe("等待时补充的新回复");
  expect(screen.getByText(/后续输入仍保留，尚未提交/)).toBeTruthy();
  expect(recordFormalInspectionNotification).toHaveBeenCalledTimes(1);
  expect(vi.mocked(recordFormalInspectionNotification).mock.calls[0][0].noteOrReply).toBe("客户第一次回复");
});

it("clears a prior reply success notice before a new failed submission and retains the draft", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "客户跟进" }));
  const reply = screen.getByPlaceholderText("例如：客户有意向，下周再确认。") as HTMLTextAreaElement;
  fireEvent.change(reply, { target: { value: "第一条回复" } });
  fireEvent.submit(reply.form!);
  await screen.findByText("已记录客户回复，本次检查报告跟进闭环。");
  vi.mocked(recordFormalInspectionNotification).mockRejectedValueOnce(new Error("模拟回复保存失败"));
  fireEvent.change(reply, { target: { value: "第二条回复" } });
  fireEvent.submit(reply.form!);
  await screen.findByText("模拟回复保存失败");
  expect(screen.queryByText("已记录客户回复，本次检查报告跟进闭环。")).toBeNull();
  expect(reply.value).toBe("第二条回复");
  expect((screen.getByRole("button", { name: "记录回复并闭环" }) as HTMLButtonElement).disabled).toBe(false);
});

it("ignores duplicate reply submissions while the original request is pending", async () => {
  vi.mocked(recordFormalInspectionNotification).mockReturnValueOnce(new Promise(() => {}));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "客户跟进" }));
  const reply = screen.getByPlaceholderText("例如：客户有意向，下周再确认。") as HTMLTextAreaElement;
  fireEvent.change(reply, { target: { value: "只提交一次" } });
  act(() => { fireEvent.submit(reply.form!); fireEvent.submit(reply.form!); });
  expect(recordFormalInspectionNotification).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "正在记录回复…" })).toBeTruthy();
});

it("does not erase a newer reply failure when an older history refresh completes", async () => {
  let refresh!: (value: FormalInspectionReportDetail) => void;
  vi.mocked(fetchFormalInspectionReport).mockResolvedValueOnce(structuredClone(detail)).mockReturnValueOnce(new Promise(resolve => { refresh = resolve; }));
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "客户跟进" }));
  const reply = screen.getByPlaceholderText("例如：客户有意向，下周再确认。") as HTMLTextAreaElement;
  fireEvent.change(reply, { target: { value: "第一条回复" } });
  fireEvent.submit(reply.form!);
  await screen.findByText("已记录客户回复，本次检查报告跟进闭环。");
  await waitFor(() => expect(fetchFormalInspectionReport).toHaveBeenCalledTimes(2));
  vi.mocked(recordFormalInspectionNotification).mockRejectedValueOnce(new Error("第二条回复未保存"));
  fireEvent.change(reply, { target: { value: "保留第二条" } });
  fireEvent.submit(reply.form!);
  await screen.findByText("第二条回复未保存");
  await act(async () => refresh(structuredClone(detail)));
  expect(screen.getByRole("alert").textContent).toContain("第二条回复未保存");
  expect(reply.value).toBe("保留第二条");
});

it("clears a successfully recorded reply without reporting a false submission failure", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("tab", { name: "客户跟进" }));
  const reply = screen.getByPlaceholderText("例如：客户有意向，下周再确认。") as HTMLTextAreaElement;
  fireEvent.change(reply, { target: { value: "客户已回复" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "记录回复并闭环" })); });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(reply.value).toBe("");
});

it("compares a failed draft with the latest report and only saves after an explicit choice", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  fireEvent.change(screen.getByRole("textbox", { name: "英文检查结论" }), { target: { value: "My recovery draft" } });
  vi.mocked(saveFormalInspectionWorkspace).mockRejectedValueOnce(new Error("版本已经更新"));
  fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
  await screen.findByRole("alert");
  const newer = structuredClone(detail);
  newer.report.version = 2;
  newer.workspace.versionNo = 1;
  newer.workspace.organized.summaryEn = "Latest colleague draft";
  vi.mocked(fetchFormalInspectionReport).mockResolvedValue(newer);
  fireEvent.click(screen.getByRole("button", { name: "核对最新版本" }));
  const dialog = await screen.findByRole("dialog", { name: "核对报告版本" });
  expect(await within(dialog).findByText("My recovery draft")).toBeTruthy();
  expect(within(dialog).getByText("Latest colleague draft")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "核对后保留我的草稿" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((screen.getByRole("textbox", { name: "英文检查结论" }) as HTMLTextAreaElement).value).toBe("My recovery draft");
  expect(saveFormalInspectionWorkspace).toHaveBeenCalledTimes(1);
  vi.mocked(saveFormalInspectionWorkspace).mockResolvedValue(newer);
  fireEvent.click(screen.getByRole("button", { name: "保存版本" }));
  await screen.findByText("已保存新的报告草稿版本；维修工原始回单没有被覆盖。");
  expect(saveFormalInspectionWorkspace).toHaveBeenLastCalledWith(9, expect.objectContaining({ expectedVersion: 2, organized: expect.objectContaining({ summaryEn: "My recovery draft" }) }));
});

it("can adopt the latest version without saving or silently replacing it during comparison", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑报告" }));
  fireEvent.change(screen.getByRole("textbox", { name: "英文检查结论" }), { target: { value: "Local pending edits" } });
  const newer = structuredClone(detail);
  newer.report.version = 2;
  newer.workspace.organized.summaryEn = "Latest approved conclusion";
  vi.mocked(fetchFormalInspectionReport).mockResolvedValue(newer);
  fireEvent.click(screen.getByRole("button", { name: "核对最新版本" }));
  const dialog = await screen.findByRole("dialog", { name: "核对报告版本" });
  await within(dialog).findByText("Latest approved conclusion");
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭核对报告版本" }));
  expect((screen.getByRole("textbox", { name: "英文检查结论" }) as HTMLTextAreaElement).value).toBe("Local pending edits");
  fireEvent.click(screen.getByRole("button", { name: "核对最新版本" }));
  fireEvent.click(await screen.findByRole("button", { name: "使用最新版本作为草稿" }));
  expect((screen.getByRole("textbox", { name: "英文检查结论" }) as HTMLTextAreaElement).value).toBe("Latest approved conclusion");
  expect(saveFormalInspectionWorkspace).not.toHaveBeenCalled();
});

it("offers a retry inside comparison when fetching the latest version fails", async () => {
  render(<FormalInspectionReportDetailView inspectionReportId={9} />);
  await screen.findByRole("heading", { name: "IR-20260905-0009" });
  vi.mocked(fetchFormalInspectionReport).mockRejectedValueOnce(new Error("网络暂不可用"));
  fireEvent.click(screen.getByRole("button", { name: "核对最新版本" }));
  expect((await screen.findByRole("alert")).textContent).toContain("网络暂不可用");
  fireEvent.click(screen.getByRole("button", { name: "重新读取最新版本" }));
  expect(await screen.findByRole("button", { name: "使用最新版本作为草稿" })).toBeTruthy();
  expect(screen.queryByText("网络暂不可用")).toBeNull();
});
