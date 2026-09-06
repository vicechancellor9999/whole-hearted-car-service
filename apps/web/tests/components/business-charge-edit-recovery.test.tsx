import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FormalBusinessOrderDetailView } from "../../src/components/orders/formal-business-order-detail";
import { fetchFormalBusinessOrder, fetchFormalRepairRounds, runFormalRepairRoundAction, replaceFormalChargeVersion, type FormalBusinessOrderDetail, type FormalRepairRoundWorkspace } from "../../src/lib/api/formal-business-orders";
import { aiTranslateRepair, aiParseFormalChargeEntry } from "../../src/lib/ai/auto-repair";
import { createFormalInspectionReport, fetchFormalInspectionReports, type FormalInspectionReport } from "../../src/lib/api/formal-inspections";
import { fetchFormalMasterData } from "../../src/lib/api/formal-master-data";
import { readRoundDeletionAttempt, saveRoundDeletionAttempt, type RoundDeletionAttempt } from "../../src/lib/orders/round-deletion-storage";

const navigation = vi.hoisted(() => ({ language: "zh", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/orders/business/7", useSearchParams: () => new URLSearchParams("tab=operations"), useRouter: () => ({ push: navigation.push, replace: vi.fn() }) }));
vi.mock("../../src/lib/i18n/language", async (original) => ({ ...await original<object>(), useI18n: () => ({ language: navigation.language }) }));
vi.mock("../../src/lib/api/formal-business-orders", async (original) => ({ ...await original<object>(), fetchFormalBusinessOrder: vi.fn(), runFormalRepairRoundAction: vi.fn(), replaceFormalChargeVersion: vi.fn(), fetchFormalRepairRounds: vi.fn().mockResolvedValue({ current: { id: 21, businessOrderId: 7, roundNo: 1, source: "initial", afterSalesIssue: null, status: "formally_handed_off", assignedTeamId: null, intakeMileageKm: null, intakePhotoFileIds: [], latestWorkReturnId: null, latestWorkReturn: null, approvedWorkReturnId: null, performanceDraftMinor: 0, version: 1 }, afterSalesRoundDeletion: null, history: [], auditTrail: [] }) }));
vi.mock("../../src/lib/api/formal-master-data", () => ({ fetchFormalMasterData: vi.fn().mockResolvedValue({ dictionaries: [], teams: [], staff: [], payrollParameters: [], teamCommissionRates: [] }) }));
vi.mock("../../src/lib/api/formal-inspections", () => ({ createFormalInspectionReport: vi.fn(), fetchFormalInspectionReports: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageCount: 1, pageSize: 20 }) }));
vi.mock("../../src/components/shared/record-delete-dialog", () => ({ RecordDeleteButton: () => null }));
// PDF and attachment services are outside the charge editor; leave its actual form and API payload intact.
vi.mock("../../src/components/orders/formal-business-order-documents-workspace", () => ({ FormalBusinessOrderDocumentsWorkspace: () => null }));
vi.mock("../../src/components/orders/formal-business-order-attachments-workspace", () => ({ FormalBusinessOrderAttachmentsWorkspace: () => null }));
vi.mock("../../src/lib/ai/auto-repair", () => ({ aiTranslateRepair: vi.fn(), aiParseFormalChargeEntry: vi.fn() }));

const detail: FormalBusinessOrderDetail = {
  order: { id: 7, orderNo: "BO-TEST-7", vehicleId: 12, payer: { type: "person", displayName: "测试客户", phone: null, trn: null, contactName: null }, vehicle: { plate: "1234AB", description: "Toyota Vitz", vin: null }, status: "formally_handed_off", currentChargeVersionNo: 1, createdAt: "2026-09-01T12:00:00Z", voided: false, voidReason: null, version: 4, categories: ["repair"] },
  charges: { id: 30, businessOrderId: 7, versionNo: 1, reason: "原收费", businessOrderVersion: 4, totals: { grossMinor: 100000, lineDiscountMinor: 1000, laborDiscountMinor: 2000, partDiscountMinor: 3000, otherDiscountMinor: 4000, categoryDiscountMinor: 9000, wholeOrderDiscountMinor: 5000, totalDueMinor: 85000, includedGctMinor: 11087 }, items: [
    { id: 41, kind: "labor", nameZh: "检查工时", nameEn: "Inspection", descriptionZh: "检查车辆", descriptionEn: "Inspect vehicle", unitItemId: 1, quantity: "1.000", unitPriceMinor: 50000, itemDiscountMinor: 1000, subtotalMinor: 49000, sortOrder: 0 },
    { id: 42, kind: "part", nameZh: "配件", nameEn: "Part", descriptionZh: null, descriptionEn: null, unitItemId: 1, quantity: "1.000", unitPriceMinor: 30000, itemDiscountMinor: 0, subtotalMinor: 30000, sortOrder: 1 },
    { id: 43, kind: "other", nameZh: "其他", nameEn: "Other", descriptionZh: null, descriptionEn: null, unitItemId: 1, quantity: "1.000", unitPriceMinor: 20000, itemDiscountMinor: 0, subtotalMinor: 20000, sortOrder: 2 },
  ], notes: [] },
  problemDescriptions: { original: { contentZh: null, contentEn: null, sourceType: "creation", sourceReferenceId: null, confirmedBy: 1, confirmedByName: "Test", confirmedAt: "2026-09-01T12:00:00Z" }, current: null, currentRound: null, businessOrderHistory: [], currentRoundHistory: [] },
  ledger: { businessOrderId: 7, currentDueMinor: 85000, totalPaidMinor: 0, totalRefundedMinor: 0, balanceMinor: 85000, transactions: [] }, refunds: [], documents: [], paymentMethods: [], chargeUnits: [{ id: 1, code: "job", labelZh: "次", labelEn: "Job" }], currentAccountId: 1, unreadMentionCount: 0, capabilities: { canWrite: true, canRecordPayment: false, canRefund: false, canCollaborate: false },
};

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => {
  sessionStorage.clear();
  navigation.language = "zh";
  navigation.push.mockReset();
  vi.mocked(createFormalInspectionReport).mockReset();
  vi.mocked(runFormalRepairRoundAction).mockReset();
  vi.mocked(fetchFormalRepairRounds).mockReset().mockResolvedValue({ current: { id: 21, businessOrderId: 7, roundNo: 1, source: "initial", afterSalesIssue: null, status: "formally_handed_off", assignedTeamId: null, intakeMileageKm: null, intakePhotoFileIds: [], latestWorkReturnId: null, latestWorkReturn: null, approvedWorkReturnId: null, performanceDraftMinor: 0, version: 1 }, afterSalesRoundDeletion: null, history: [], auditTrail: [] });
  vi.mocked(fetchFormalInspectionReports).mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageCount: 1, pageSize: 20 });
  vi.mocked(fetchFormalBusinessOrder).mockReset().mockResolvedValue(structuredClone(detail));
  vi.mocked(replaceFormalChargeVersion).mockReset().mockRejectedValue(new Error("连接中断，请重试"));
  vi.mocked(aiTranslateRepair).mockReset();
  vi.mocked(aiParseFormalChargeEntry).mockReset();
});

function blockedRoundFixture(): FormalRepairRoundWorkspace {
  return { current: { id: 21, businessOrderId: 7, roundNo: 2, source: "after_sales", afterSalesIssue: "复查", status: "formally_handed_off", assignedTeamId: null, intakeMileageKm: null, intakePhotoFileIds: [], latestWorkReturnId: null, latestWorkReturn: null, approvedWorkReturnId: null, performanceDraftMinor: -50000, version: 1 }, history: [], auditTrail: [], afterSalesRoundDeletion: { eligible: false, recordNo: "BO-TEST-7/R2", repairRoundId: 21, roundNo: 2, repairRoundVersion: 1, performanceDraftMinor: -50000, previewFingerprint: "old", counts: { events: 1, workReturns: 1, workReturnAttachments: 0, mileageRecords: 0, intakePhotos: 0, formalHandoffs: 1, formalHandoffCancellations: 0, problemVersions: 0, inspectionReports: 0, documentSnapshots: 1 }, blockers: [{ code: "ACTIVE_FORMAL_HANDOFF_EXISTS", label: "本轮仍有有效正式交单" }, { code: "DOCUMENT_SNAPSHOTS_EXIST", label: "正式单据已生成", recordNos: ["MEC-TEST"] }] } };
}

function rememberedRoundDeletion(): RoundDeletionAttempt {
  return { accountId: 1, businessOrderId: 7, roundId: 21, roundNo: 2, createdAt: Date.now(), status: "unconfirmed", input: { action: "delete_invalid_after_sales", repairRoundVersion: 1, previewFingerprint: "a".repeat(64), reasonCode: "test_data", reasonNote: "original account reason", confirmationRecordNo: "BO-TEST-7/R2", requestId: "original-round-delete-2" } };
}

it("reads fresh repair history before leaving deletion recovery and keeps recovery on read failure", async () => {
  saveRoundDeletionAttempt(rememberedRoundDeletion());
  let fail!: (error: Error) => void;
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(blockedRoundFixture()).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看轮次删除进度" }));
  fireEvent.click(screen.getByRole("button", { name: "核对维修历史" }));
  expect(screen.getByRole("dialog", { name: "删除第 2 轮维修" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Business Order 全部维修历史" })).toBeNull();
  await act(async () => fail(new Error("历史读取失败，可以重试")));
  expect(screen.getByText("历史读取失败，可以重试")).toBeTruthy();
  expect(screen.getByRole("button", { name: "核对维修历史" }).hasAttribute("disabled")).toBe(false);
  expect(runFormalRepairRoundAction).not.toHaveBeenCalled();
});

it("shows a retry route when round-deletion recovery cannot be read instead of silently hiding it", async () => {
  sessionStorage.setItem("wh:round-deletion:v1:1:7", "{");
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  const retry = await screen.findByRole("button", { name: "重新读取轮次删除暂存" });
  sessionStorage.setItem("wh:round-deletion:v1:1:7", "null");
  fireEvent.click(retry);
  expect(screen.queryByRole("button", { name: "重新读取轮次删除暂存" })).toBeNull();
  expect(runFormalRepairRoundAction).not.toHaveBeenCalled();
});

it("does not let an old account's late deletion response change the new account's page", async () => {
  const attempt = rememberedRoundDeletion(); saveRoundDeletionAttempt(attempt);
  const source = blockedRoundFixture();
  vi.mocked(fetchFormalRepairRounds).mockResolvedValue(source);
  let finish!: (value: FormalRepairRoundWorkspace & { result: unknown }) => void;
  vi.mocked(runFormalRepairRoundAction).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看轮次删除进度" }));
  fireEvent.click(screen.getByRole("button", { name: "沿用原请求重试" }));
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValue({ ...detail, currentAccountId: 2 });
  navigation.language = "en"; view.rerender(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await waitFor(() => expect(screen.queryByText("original account reason")).toBeNull());
  await act(async () => finish({ ...source, current: { ...source.current, id: 20, roundNo: 1, source: "initial" }, afterSalesRoundDeletion: null, result: { cancelled: true, deletedRoundNo: 2, restoredRoundNo: 1 } }));
  expect(screen.queryByRole("button", { name: "View round deletion progress" })).toBeNull();
  expect(screen.queryByText("The original repair-round deletion is confirmed.")).toBeNull();
  expect(readRoundDeletionAttempt(1, 7).attempt?.status).toBe("completed");
  expect(readRoundDeletionAttempt(2, 7).attempt).toBeNull();
});

it.each(["wrong-number", "round-still-present"])("retains an unconfirmed deletion on a %s response and permits only the original retry", async (kind) => {
  const attempt = rememberedRoundDeletion(); saveRoundDeletionAttempt(attempt);
  const source = blockedRoundFixture();
  vi.mocked(fetchFormalRepairRounds).mockResolvedValue(source);
  vi.mocked(runFormalRepairRoundAction).mockResolvedValue({ ...source, result: { cancelled: true, deletedRoundNo: kind === "wrong-number" ? 3 : 2, restoredRoundNo: kind === "wrong-number" ? 2 : 1 } });
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看轮次删除进度" }));
  fireEvent.click(screen.getByRole("button", { name: "沿用原请求重试" }));
  await screen.findByText(/删除回执与原轮次不一致/);
  expect(screen.queryByText("本轮删除已确认完成")).toBeNull();
  expect(readRoundDeletionAttempt(1, 7).attempt?.input).toEqual(attempt.input);
});

it("keeps a completed deletion visible when reminder cleanup fails, then clears it without another delete", async () => {
  saveRoundDeletionAttempt({ ...rememberedRoundDeletion(), status: "completed" });
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看轮次删除进度" }));
  expect(screen.queryByRole("button", { name: "沿用原请求重试" })).toBeNull();
  const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  fireEvent.click(screen.getByRole("button", { name: "完成并关闭" }));
  expect(screen.getByRole("alert").textContent).toContain("清理失败");
  expect(screen.getByRole("dialog")).toBeTruthy();
  fail.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "完成并关闭" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(readRoundDeletionAttempt(1, 7).attempt).toBeNull();
  expect(runFormalRepairRoundAction).not.toHaveBeenCalled();
});

it("unlocks a stalled round deletion, preserves the original retry payload, and allows closing", async () => {
  const source = blockedRoundFixture();
  source.current.status = "waiting_assignment";
  source.afterSalesRoundDeletion!.eligible = true;
  source.afterSalesRoundDeletion!.blockers = [];
  source.afterSalesRoundDeletion!.previewFingerprint = "a".repeat(64);
  source.afterSalesRoundDeletion!.counts.formalHandoffs = 0;
  source.afterSalesRoundDeletion!.counts.documentSnapshots = 0;
  vi.mocked(fetchFormalRepairRounds).mockResolvedValue(source);
  const actual = await vi.importActual<typeof import("../../src/lib/api/formal-business-orders")>("../../src/lib/api/formal-business-orders");
  vi.mocked(runFormalRepairRoundAction).mockImplementation(actual.runFormalRepairRoundAction);
  const network = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "删除本轮" }));
  fireEvent.click(screen.getByRole("radio", { name: /测试数据/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /输入轮次编号确认/ }), { target: { value: "BO-TEST-7/R2" } });
  fireEvent.change(screen.getByRole("textbox", { name: "原因说明（可选）" }), { target: { value: "重复测试" } });
  vi.stubGlobal("fetch", network);
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole("button", { name: "确认删除本轮" }));
    expect(screen.getByRole("button", { name: "沿用原请求重试" }).hasAttribute("disabled")).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("alert").textContent).toContain("结果尚未确认");
    expect(screen.getByRole("button", { name: "沿用原请求重试" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("dialog", { name: "删除第 2 轮维修" }).textContent).toContain("重复测试");
    expect(network).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "沿用原请求重试" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(network.mock.calls[1]).toEqual([network.mock.calls[0][0], { ...network.mock.calls[0][1], signal: expect.any(AbortSignal) }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    fireEvent.click(within(screen.getByRole("dialog", { name: "删除第 2 轮维修" })).getByRole("button", { name: /^关闭$/ }));
    expect(screen.queryByRole("dialog", { name: "删除第 2 轮维修" })).toBeNull();
    expect(network).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("restores the exact submitted round deletion after remount, even if the current round has changed", async () => {
  const source = blockedRoundFixture();
  source.current.status = "waiting_assignment";
  source.afterSalesRoundDeletion!.eligible = true;
  source.afterSalesRoundDeletion!.blockers = [];
  source.afterSalesRoundDeletion!.previewFingerprint = "a".repeat(64);
  vi.mocked(fetchFormalRepairRounds).mockResolvedValue(source);
  vi.mocked(runFormalRepairRoundAction).mockRejectedValue(new Error("结果尚未确认"));
  const page = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "删除本轮" }));
  fireEvent.click(screen.getByRole("radio", { name: /测试数据/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /输入轮次编号确认/ }), { target: { value: "BO-TEST-7/R2" } });
  fireEvent.change(screen.getByRole("textbox", { name: "原因说明（可选）" }), { target: { value: "错误轮次" } });
  fireEvent.click(screen.getByRole("button", { name: "确认删除本轮" }));
  await waitFor(() => expect(runFormalRepairRoundAction).toHaveBeenCalledTimes(1));
  const original = vi.mocked(runFormalRepairRoundAction).mock.calls[0][1];
  page.unmount();
  const previous = structuredClone(source); previous.current.roundNo = 1; previous.current.source = "initial"; previous.afterSalesRoundDeletion = null;
  vi.mocked(fetchFormalRepairRounds).mockResolvedValue(previous);
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看轮次删除进度" }));
  const dialog = screen.getByRole("dialog", { name: "删除第 2 轮维修" });
  expect(dialog.textContent).toContain("BO-TEST-7/R2");
  expect(dialog.textContent).toContain("错误轮次");
  expect(runFormalRepairRoundAction).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "沿用原请求重试" }));
  await waitFor(() => expect(runFormalRepairRoundAction).toHaveBeenCalledTimes(2));
  expect(vi.mocked(runFormalRepairRoundAction).mock.calls[1][1]).toEqual(original);
});

it("restores the performance draft after a page remount without automatically submitting it", async () => {
  const source = blockedRoundFixture(); source.current.status = "waiting_assignment";
  vi.mocked(fetchFormalRepairRounds).mockResolvedValue(source);
  const page = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  page.unmount();
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看绩效调整" }));
  expect((screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }) as HTMLInputElement).value).toBe("1250");
  expect(runFormalRepairRoundAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
  cleanup();
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await screen.findByRole("button", { name: "修改绩效值" });
  expect(screen.queryByRole("button", { name: "查看绩效调整" })).toBeNull();
});

it.each(["saved", "discarded"])("separates %s performance from failed local cleanup and retries without another write", async (outcome) => {
  const source = blockedRoundFixture(); source.current.status = "waiting_assignment";
  const saved = structuredClone(source); saved.current.version = 2; saved.current.performanceDraftMinor = 125000;
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source).mockResolvedValue(saved);
  vi.mocked(runFormalRepairRoundAction).mockResolvedValueOnce({ ...saved, result: saved.current });
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  const removal = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
  const writing = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  fireEvent.click(screen.getByRole("button", { name: outcome === "saved" ? "保存绩效值" : "放弃草稿" }));
  const retry = await screen.findByRole("button", { name: "重试清理本机草稿" });
  expect(screen.getByRole("alert").textContent).toContain("旧草稿");
  if (outcome === "saved") expect(screen.getByText("本轮绩效值已保存")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(retry);
  expect(screen.getByRole("button", { name: "重试清理本机草稿" })).toBeTruthy();
  expect(runFormalRepairRoundAction).toHaveBeenCalledTimes(outcome === "saved" ? 1 : 0);
  removal.mockRestore(); writing.mockRestore();
  fireEvent.click(retry);
  expect(screen.queryByRole("button", { name: "重试清理本机草稿" })).toBeNull();
  expect(sessionStorage.getItem("wh:performance-draft:v1:1:7")).toBeNull();
  expect(runFormalRepairRoundAction).toHaveBeenCalledTimes(outcome === "saved" ? 1 : 0);
});

it.each(["success", "failure"])("isolates a late %s from the previous account while the new account saves", async (outcome) => {
  const source = blockedRoundFixture(); source.current.status = "waiting_assignment";
  vi.mocked(fetchFormalRepairRounds).mockResolvedValue(source);
  let finishOld!: (value: FormalRepairRoundWorkspace & { result: unknown }) => void;
  let failOld!: (error: Error) => void;
  let failNew!: (error: Error) => void;
  vi.mocked(runFormalRepairRoundAction)
    .mockImplementationOnce(() => new Promise((resolve, reject) => { finishOld = resolve; failOld = reject; }))
    .mockImplementationOnce(() => new Promise((_, reject) => { failNew = reject; }));
  const view = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  fireEvent.click(screen.getByRole("button", { name: "保存绩效值" }));
  const next = structuredClone(detail); next.currentAccountId = 2; next.order.payer.displayName = "Second account view";
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValueOnce(next);
  navigation.language = "en";
  view.rerender(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await screen.findByText("Second account view");
  fireEvent.click(screen.getByRole("button", { name: "Edit performance" }));
  const field = screen.getByRole("textbox", { name: "Round performance value (JMD)" }) as HTMLInputElement;
  expect(field.readOnly).toBe(false);
  fireEvent.change(field, { target: { value: "2000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save performance" }));
  expect(runFormalRepairRoundAction).toHaveBeenCalledTimes(2);
  const saved = structuredClone(source); saved.current.version = 2; saved.current.performanceDraftMinor = 125000;
  await act(async () => { if (outcome === "success") finishOld({ ...saved, result: saved.current }); else failOld(new Error("old account failure")); });
  expect(field.value).toBe("2000");
  expect(field.readOnly).toBe(true);
  expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("本轮绩效值已保存")).toBeNull();
  expect(screen.queryByText("old account failure")).toBeNull();
  await act(async () => failNew(new Error("new account failure")));
  expect(field.readOnly).toBe(false);
  expect(field.value).toBe("2000");
  expect(JSON.parse(sessionStorage.getItem("wh:performance-draft:v1:1:7")!).value).toBe("1250");
  expect(JSON.parse(sessionStorage.getItem("wh:performance-draft:v1:2:7")!).value).toBe("2000");
});

it("ignores a previous account's pending history check after the account refreshes", async () => {
  const source = blockedRoundFixture(); source.current.status = "waiting_assignment";
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source);
  vi.mocked(runFormalRepairRoundAction).mockRejectedValueOnce(new Error("请核对"));
  const view = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.click(screen.getByRole("button", { name: "保存绩效值" }));
  await screen.findByText("请核对");
  let finish!: (value: FormalRepairRoundWorkspace) => void;
  vi.mocked(fetchFormalRepairRounds).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "核对最新绩效记录" }));
  const next = structuredClone(detail); next.currentAccountId = 2; next.order.payer.displayName = "Second account view";
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValueOnce(next);
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source);
  navigation.language = "en";
  view.rerender(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await screen.findByText("Second account view");
  fireEvent.click(screen.getByRole("button", { name: "Edit performance" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Round performance value (JMD)" }), { target: { value: "2000" } });
  await act(async () => finish(source));
  expect(screen.queryByRole("dialog", { name: "Business Order repair history" })).toBeNull();
  expect((screen.getByRole("textbox", { name: "Round performance value (JMD)" }) as HTMLInputElement).value).toBe("2000");
  expect(runFormalRepairRoundAction).toHaveBeenCalledTimes(1);
});

it("keeps a restored draft attached to its original round when a new round has the same version", async () => {
  const source = blockedRoundFixture(); source.current.status = "waiting_assignment";
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source);
  const view = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  view.unmount();
  const next = structuredClone(source); next.current.id = 22; next.current.roundNo = 3;
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(next);
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看绩效调整" }));
  fireEvent.click(screen.getByRole("button", { name: "保存绩效值" }));
  expect(runFormalRepairRoundAction).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("已变化");
  expect((screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }) as HTMLInputElement).value).toBe("1250");
});

it("does not let a previous order's late save erase its recovery or update the next order", async () => {
  const source = blockedRoundFixture(); source.current.status = "waiting_assignment";
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source);
  let finish!: (value: FormalRepairRoundWorkspace & { result: unknown }) => void;
  vi.mocked(runFormalRepairRoundAction).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  fireEvent.click(screen.getByRole("button", { name: "保存绩效值" }));
  const next = structuredClone(detail); next.order.id = 8; next.order.orderNo = "BO-TEST-8";
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValueOnce(next);
  view.rerender(<FormalBusinessOrderDetailView businessOrderId={8} />);
  await screen.findByText("BO-TEST-8");
  const saved = structuredClone(source); saved.current.performanceDraftMinor = 125000; saved.current.version = 2;
  await act(async () => finish({ ...saved, result: saved.current }));
  expect(screen.queryByText("本轮绩效值已保存")).toBeNull();
  expect(screen.queryByRole("button", { name: "查看绩效调整" })).toBeNull();
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(saved);
  view.rerender(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看绩效调整" }));
  expect(screen.getByRole("alert").textContent).toContain("核对");
  expect((screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }) as HTMLInputElement).value).toBe("1250");
  expect(runFormalRepairRoundAction).toHaveBeenCalledTimes(1);
});

it("warns when browser storage cannot retain the performance draft without disabling ordinary editing", async () => {
  const source = blockedRoundFixture(); source.current.status = "waiting_assignment";
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  expect(screen.getByText(/浏览器暂存不可用/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "保存绩效值" }) as HTMLButtonElement).disabled).toBe(false);
});

it("restores an interrupted submission as unconfirmed and does not share it with another account", async () => {
  const source = blockedRoundFixture(); source.current.status = "waiting_assignment";
  vi.mocked(fetchFormalRepairRounds).mockResolvedValue(source);
  vi.mocked(runFormalRepairRoundAction).mockImplementationOnce(() => new Promise(() => {}));
  const page = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  fireEvent.click(screen.getByRole("button", { name: "保存绩效值" }));
  page.unmount();
  const other = structuredClone(detail); other.currentAccountId = 2;
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValueOnce(other);
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await screen.findByRole("button", { name: "修改绩效值" });
  expect(screen.queryByRole("button", { name: "查看绩效调整" })).toBeNull();
  cleanup();
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "查看绩效调整" }));
  expect(screen.getByRole("alert").textContent).toContain("核对");
  expect((screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }) as HTMLInputElement).value).toBe("1250");
  expect(runFormalRepairRoundAction).toHaveBeenCalledTimes(1);
});

it("releases a timed-out performance save, retains its closed draft, and ignores a late response", async () => {
  const api = await vi.importActual<typeof import("../../src/lib/api/formal-business-orders")>("../../src/lib/api/formal-business-orders");
  const source = blockedRoundFixture();
  source.current.status = "waiting_assignment";
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source);
  vi.mocked(runFormalRepairRoundAction).mockImplementationOnce(api.runFormalRepairRoundAction);
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  let finish!: (response: Response) => void;
  const network = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", network);
  vi.useFakeTimers();
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  fireEvent.click(screen.getByRole("button", { name: "保存绩效值" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭修改绩效值" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByRole("alert").textContent).toContain("超时");
  expect(network).toHaveBeenCalledTimes(1);
  const init = (network.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(init.signal?.aborted).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "查看绩效调整" }));
  expect((screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }) as HTMLInputElement).value).toBe("1250");
  expect((screen.getByRole("button", { name: "核对最新绩效记录" }) as HTMLButtonElement).disabled).toBe(false);
  const saved = structuredClone(source);
  saved.current.version = 2;
  saved.current.performanceDraftMinor = 125000;
  await act(async () => { finish(new Response(JSON.stringify({ ...saved, result: saved.current }))); });
  expect(screen.queryByText("本轮绩效值已保存")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("超时");
  expect(network).toHaveBeenCalledTimes(1);
});

it("times out a performance history read and leaves its retry and close routes usable", async () => {
  const api = await vi.importActual<typeof import("../../src/lib/api/formal-business-orders")>("../../src/lib/api/formal-business-orders");
  const source = blockedRoundFixture(); source.current.status = "waiting_assignment";
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source);
  vi.mocked(runFormalRepairRoundAction).mockRejectedValueOnce(new Error("结果未确认"));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.click(screen.getByRole("button", { name: "保存绩效值" }));
  await screen.findByText("结果未确认");
  vi.mocked(fetchFormalRepairRounds).mockImplementationOnce(api.fetchFormalRepairRounds);
  const network = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", network); vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "核对最新绩效记录" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByRole("alert").textContent).toContain("超时");
  expect((screen.getByRole("button", { name: "核对最新绩效记录" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "关闭修改绩效值" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(network).toHaveBeenCalledTimes(1);
});

it("retains an unsaved performance value when its editor is closed and reopened", async () => {
  const source = blockedRoundFixture();
  source.current.status = "waiting_assignment";
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source);
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  fireEvent.click(screen.getByRole("button", { name: "关闭修改绩效值" }));
  fireEvent.click(screen.getByRole("button", { name: "修改绩效值" }));
  expect((screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }) as HTMLInputElement).value).toBe("1250");
  expect(runFormalRepairRoundAction).not.toHaveBeenCalled();
});

it("preserves a handed-off performance reason after failure and reopens it without hiding the error", async () => {
  const source = blockedRoundFixture();
  source.history = [{ ...source.current, createdAt: "2026-09-05T12:00:00Z", createdBy: 1, updatedAt: "2026-09-05T12:00:00Z", events: [], formalHandoffs: [{ id: 45, handoffNo: 1, performanceMinor: -50000, jamaicaMonth: "2026-09", handedOffAt: "2026-09-05T12:00:00Z", cancelledAt: null, performanceAdjustmentAllowed: true, performanceAdjustmentUnavailableReason: null }] }];
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source).mockResolvedValueOnce(source);
  vi.mocked(runFormalRepairRoundAction).mockRejectedValueOnce(new Error("结果未确认"));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "调整绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  fireEvent.change(screen.getByRole("textbox", { name: "调整原因" }), { target: { value: "纠正原录入" } });
  fireEvent.click(screen.getByRole("button", { name: "确认调整绩效" }));
  await screen.findByText("结果未确认");
  fireEvent.click(screen.getByRole("button", { name: "关闭调整第 2 轮已交单绩效" }));
  fireEvent.click(screen.getByRole("button", { name: "调整绩效值" }));
  expect(screen.getByRole("alert").textContent).toContain("结果未确认");
  expect((screen.getByRole("textbox", { name: "调整原因" }) as HTMLTextAreaElement).value).toBe("纠正原录入");
  fireEvent.click(screen.getByRole("button", { name: "核对最新绩效记录" }));
  const history = await screen.findByRole("dialog", { name: "Business Order 全部维修历史" });
  expect(within(history).getByText("−JMD 500.00")).toBeTruthy();
  expect(runFormalRepairRoundAction).toHaveBeenCalledTimes(1);
  expect(runFormalRepairRoundAction).toHaveBeenCalledWith(7, { action: "adjust_formal_handoff_performance", formalHandoffId: 45, repairRoundVersion: 1, performanceValue: "1250", reason: "纠正原录入" });
});

it("finishes a background performance save without requiring the editor to stay open", async () => {
  const source = blockedRoundFixture();
  source.current.status = "waiting_assignment";
  const saved = structuredClone(source);
  saved.current.performanceDraftMinor = 125000;
  saved.current.version = 2;
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source).mockResolvedValueOnce(saved);
  let finish!: (value: FormalRepairRoundWorkspace & { result: unknown }) => void;
  vi.mocked(runFormalRepairRoundAction).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  fireEvent.click(screen.getByRole("button", { name: "保存绩效值" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭修改绩效值" }));
  await act(async () => finish({ ...saved, result: saved.current }));
  expect(await screen.findByText("本轮绩效值已保存")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "查看绩效调整" })).toBeNull();
  expect(screen.getByTestId("repair-round-performance").textContent).toBe("JMD 1,250.00");
});

it.each(["wrong order", "wrong amount", "unchanged version", "missing result"])("keeps the performance draft when a successful response has %s", async (fault) => {
  const source = blockedRoundFixture();
  source.current.status = "waiting_assignment";
  const saved = structuredClone(source);
  saved.current.performanceDraftMinor = 125000;
  saved.current.version = 2;
  if (fault === "wrong order") saved.current.businessOrderId = 999;
  if (fault === "wrong amount") saved.current.performanceDraftMinor = 1;
  if (fault === "unchanged version") saved.current.version = 1;
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source);
  vi.mocked(runFormalRepairRoundAction).mockResolvedValueOnce({ ...saved, result: fault === "missing result" ? {} : saved.current });
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  fireEvent.click(screen.getByRole("button", { name: "保存绩效值" }));
  expect((await screen.findByRole("alert")).textContent).toContain("核对");
  expect((screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }) as HTMLInputElement).value).toBe("1250");
  expect(screen.getByTestId("repair-round-performance").textContent).toBe("−JMD 500.00");
  expect(screen.queryByText("本轮绩效值已保存")).toBeNull();
});

it("does not open a late performance history check after the user closes the editor", async () => {
  const source = blockedRoundFixture();
  source.current.status = "waiting_assignment";
  let finish!: (value: FormalRepairRoundWorkspace) => void;
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(runFormalRepairRoundAction).mockRejectedValueOnce(new Error("结果未确认"));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.click(screen.getByRole("button", { name: "保存绩效值" }));
  await screen.findByText("结果未确认");
  fireEvent.click(screen.getByRole("button", { name: "核对最新绩效记录" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭修改绩效值" }));
  await act(async () => finish(source));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "查看绩效调整" })).toBeTruthy();
});

it("keeps a failed background performance adjustment recoverable and prevents duplicate writes", async () => {
  const source = blockedRoundFixture();
  source.current.status = "waiting_assignment";
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source);
  let fail!: (error: Error) => void;
  vi.mocked(runFormalRepairRoundAction).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "修改绩效值" }));
  fireEvent.change(screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }), { target: { value: "1250" } });
  const form = screen.getByRole("button", { name: "保存绩效值" }).closest("form")!;
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  expect(runFormalRepairRoundAction).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "关闭修改绩效值" }));
  expect(screen.getByRole("button", { name: "查看绩效调整" })).toBeTruthy();
  await act(async () => fail(new Error("网络中断，结果需要核对")));
  expect(screen.getByRole("alert").textContent).toContain("网络中断");
  fireEvent.click(screen.getByRole("button", { name: "查看绩效调整" }));
  expect((screen.getByRole("textbox", { name: "本轮绩效值（JMD）" }) as HTMLInputElement).value).toBe("1250");
  expect(runFormalRepairRoundAction).toHaveBeenCalledWith(7, { action: "set_performance_draft", repairRoundId: 21, repairRoundVersion: 1, performanceValue: "1250" });
});

it("offers real read-only routes from round blockers and does not call handed-off performance an uncounted draft", async () => {
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(blockedRoundFixture());
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "删除本轮" }));
  const dialog = screen.getByRole("dialog", { name: "删除第 2 轮维修" });
  expect(within(dialog).queryByText(/尚未计入正式绩效/)).toBeNull();
  expect(within(dialog).getByRole("link", { name: "查看正式单据与更正版本" }).getAttribute("href")).toBe("/orders/business/7?tab=documents");
  fireEvent.click(within(dialog).getByRole("button", { name: "查看交单与绩效记录" }));
  expect(screen.queryByRole("dialog", { name: "删除第 2 轮维修" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Business Order 全部维修历史" })).toBeTruthy();
});

it("rechecks round dependencies, shows a recoverable read error, and uses the latest result", async () => {
  const source = blockedRoundFixture();
  const latest = structuredClone(source);
  latest.afterSalesRoundDeletion!.blockers = [];
  latest.afterSalesRoundDeletion!.eligible = true;
  latest.afterSalesRoundDeletion!.previewFingerprint = "latest";
  latest.current.status = "waiting_assignment";
  latest.afterSalesRoundDeletion!.counts.formalHandoffs = 0;
  latest.afterSalesRoundDeletion!.counts.documentSnapshots = 0;
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source).mockRejectedValueOnce(new Error("复核连接失败")).mockResolvedValueOnce(latest);
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "删除本轮" }));
  fireEvent.click(screen.getByRole("button", { name: "重新检查关联记录" }));
  expect((await screen.findByRole("alert")).textContent).toContain("复核连接失败");
  fireEvent.click(screen.getByRole("button", { name: "重新检查关联记录" }));
  expect(await screen.findByText("可以删除")).toBeTruthy();
  expect(screen.queryByText("复核连接失败")).toBeNull();
  expect(screen.getByRole("button", { name: "确认删除本轮" }).hasAttribute("disabled")).toBe(true);
});

it("can close a pending round recheck and ignores its late result after reopening", async () => {
  const source = blockedRoundFixture();
  const late = structuredClone(source);
  late.afterSalesRoundDeletion!.blockers = [];
  late.afterSalesRoundDeletion!.eligible = true;
  let finish!: (value: FormalRepairRoundWorkspace) => void;
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "删除本轮" }));
  fireEvent.click(screen.getByRole("button", { name: "重新检查关联记录" }));
  expect(screen.getByRole("button", { name: "正在检查…" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(within(screen.getByRole("dialog", { name: "删除第 2 轮维修" })).getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "删除本轮" }));
  await act(async () => finish(late));
  expect(screen.getByText("当前不可删除")).toBeTruthy();
  expect(screen.queryByText("可以删除")).toBeNull();
  expect(screen.getByRole("button", { name: "重新检查关联记录" }).hasAttribute("disabled")).toBe(false);
});

it("does not silently switch the deletion target when another round becomes current", async () => {
  const source = blockedRoundFixture();
  const changed = structuredClone(source);
  changed.current.id = 22;
  vi.mocked(fetchFormalRepairRounds).mockResolvedValueOnce(source).mockResolvedValueOnce(changed);
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "删除本轮" }));
  fireEvent.click(screen.getByRole("button", { name: "重新检查关联记录" }));
  expect((await screen.findByRole("alert")).textContent).toContain("当前维修轮次已变化");
  expect(screen.getByRole("dialog", { name: "删除第 2 轮维修" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "确认删除本轮" })).toBeNull();
});

it("refreshes the source order's related reports after a closed creation finishes without navigating away", async () => {
  const report: FormalInspectionReport = { id: 91, reportNo: "IR-TEST-91", vehicleId: 12, sourceBusinessOrderId: 7, sourceRepairRoundId: 21, correctionOfReportId: null, correctionReason: null, inspectionTeamId: 3, summaryZh: "后台完成的检查", summaryEn: null, specialCaseNotesZh: null, actualInspectorStaffMemberId: null, paperPhotoFileId: null, status: "draft", createdAt: "2026-09-05T12:00:00Z", submittedAt: null, version: 1, findings: [] };
  let finish!: (value: FormalInspectionReport) => void;
  vi.mocked(createFormalInspectionReport).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await screen.findByRole("button", { name: "新建检查结果" });
  vi.mocked(fetchFormalMasterData).mockResolvedValueOnce({ dictionaries: [], teams: [{ id: 3, teamNo: "TEAM-3", name: "车间一组", isActive: true, version: 1 }], staff: [], payrollParameters: [], teamCommissionRates: [] } as Awaited<ReturnType<typeof fetchFormalMasterData>>);
  fireEvent.click(screen.getByRole("button", { name: "新建检查结果" }));
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: report.summaryZh } });
  fireEvent.click(screen.getByRole("button", { name: "创建并打开报告" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭窗口，稍后核对" }));
  expect(screen.queryByRole("dialog", { name: "新建检查结果" })).toBeNull();
  vi.mocked(fetchFormalInspectionReports).mockResolvedValue({ items: [{ report, vehicle: { id: 12, plate: "1234AB", description: "Toyota Vitz", descriptionZh: "丰田", descriptionEn: "Toyota Vitz" }, customer: { name: "测试客户", phone: null, whatsapp: null, email: null }, inspectorName: null, teamName: "车间一组", sourceBusinessOrder: { id: 7, orderNo: "BO-TEST-7" }, followupStage: 0 }], total: 1, page: 1, pageCount: 1, pageSize: 20 });
  await act(async () => finish(report));
  expect((await screen.findByRole("link", { name: /IR-TEST-91/ })).getAttribute("href")).toBe("/orders/inspections/91");
  expect(screen.getByText("后台完成的检查")).toBeTruthy();
  expect(navigation.push).not.toHaveBeenCalled();
  expect(createFormalInspectionReport).toHaveBeenCalledTimes(1);
  expect(createFormalInspectionReport).toHaveBeenCalledWith(expect.objectContaining({ vehicleId: 12, sourceBusinessOrderId: 7, inspectionTeamId: 3 }));
});

it.each(["success", "failure"])("keeps the new account's source-order inspection draft after the old account's %s", async (outcome) => {
  let finish!: (report: FormalInspectionReport) => void;
  let fail!: (error: Error) => void;
  vi.mocked(createFormalInspectionReport).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const view = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await screen.findByRole("button", { name: "新建检查结果" });
  vi.mocked(fetchFormalMasterData).mockResolvedValue({ dictionaries: [], teams: [{ id: 3, teamNo: "TEAM-3", name: "车间一组", isActive: true, version: 1 }], staff: [], payrollParameters: [], teamCommissionRates: [] } as Awaited<ReturnType<typeof fetchFormalMasterData>>);
  fireEvent.click(screen.getByRole("button", { name: "新建检查结果" }));
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "账号一的检查" } });
  fireEvent.click(screen.getByRole("button", { name: "创建并打开报告" }));
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValue({ ...detail, currentAccountId: 2 });
  navigation.language = "en"; view.rerender(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await waitFor(() => expect(fetchFormalBusinessOrder).toHaveBeenCalledTimes(2));
  await act(async () => {});
  const summary = screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement;
  expect(summary.value).toBe("");
  expect(summary.matches(":disabled")).toBe(false);
  fireEvent.change(summary, { target: { value: "账号二的检查草稿" } });
  await act(async () => { if (outcome === "success") finish({ id: 91, reportNo: "IR-91" } as FormalInspectionReport); else fail(new Error("旧账号创建异常")); });
  expect((screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement).value).toBe("账号二的检查草稿");
  expect(screen.queryByText("旧账号创建异常")).toBeNull();
  expect(navigation.push).not.toHaveBeenCalled();
  expect(fetchFormalBusinessOrder).toHaveBeenCalledTimes(2);
});

it("restores a failed background inspection with its source vehicle and order", async () => {
  let fail!: (error: Error) => void;
  vi.mocked(createFormalInspectionReport).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await screen.findByRole("button", { name: "新建检查结果" });
  vi.mocked(fetchFormalMasterData).mockResolvedValue({ dictionaries: [], teams: [{ id: 3, teamNo: "TEAM-3", name: "车间一组", isActive: true, version: 1 }], staff: [], payrollParameters: [], teamCommissionRates: [] } as Awaited<ReturnType<typeof fetchFormalMasterData>>);
  fireEvent.click(screen.getByRole("button", { name: "新建检查结果" }));
  fireEvent.click(await screen.findByRole("radio", { name: /车间一组/ }));
  fireEvent.change(screen.getByPlaceholderText("填写本次实际检查结果"), { target: { value: "本业务单恢复检查" } });
  fireEvent.click(screen.getByRole("button", { name: "创建并打开报告" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭窗口，稍后核对" }));
  await act(async () => fail(new Error("请求中断，需要核对")));
  const recovery = await screen.findByRole("region", { name: "检查创建恢复" });
  expect(within(recovery).getByText("请求中断，需要核对")).toBeTruthy();
  fireEvent.click(within(recovery).getByRole("button", { name: "恢复填写并核对" }));
  expect((screen.getByPlaceholderText("填写本次实际检查结果") as HTMLTextAreaElement).value).toBe("本业务单恢复检查");
  await screen.findByRole("radio", { name: /车间一组/, checked: true });
  expect(createFormalInspectionReport).toHaveBeenCalledTimes(1);
  vi.mocked(createFormalInspectionReport).mockRejectedValueOnce(new Error("校验失败"));
  fireEvent.click(screen.getByRole("button", { name: "创建并打开报告" }));
  await waitFor(() => expect(createFormalInspectionReport).toHaveBeenCalledTimes(2));
  expect(createFormalInspectionReport).toHaveBeenLastCalledWith(expect.objectContaining({ vehicleId: 12, sourceBusinessOrderId: 7, inspectionTeamId: 3, summaryZh: "本业务单恢复检查" }));
});

it("preserves category and whole-order discounts when a user edits an item name", async () => {
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  fireEvent.change(screen.getAllByRole("textbox", { name: "项目名称" })[0], { target: { value: "诊断工时" } });
  fireEvent.click(screen.getByRole("button", { name: "保存收费项目" }));
  await waitFor(() => expect(vi.mocked(replaceFormalChargeVersion).mock.calls).toHaveLength(1));
  const sent = vi.mocked(replaceFormalChargeVersion).mock.calls[0][1];
  expect(sent).toMatchObject({ expectedBusinessOrderVersion: 4, laborDiscount: "20", partDiscount: "30", otherDiscount: "40", wholeOrderDiscount: "50" });
  expect(sent.items[0]).toMatchObject({ nameZh: "诊断工时", unitPrice: "500", itemDiscount: "10" });
});

it("clears a load failure when retry successfully opens the order", async () => {
  vi.mocked(fetchFormalBusinessOrder).mockRejectedValueOnce(new Error("读取连接失败"));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "重试" }));
  await screen.findByRole("button", { name: "编辑收费项目" });
  expect(screen.queryByText("读取连接失败")).toBeNull();
});

it("retains failed edits for retry and does not silently advance their concurrency baseline on refresh", async () => {
  const view = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  fireEvent.change(screen.getAllByRole("textbox", { name: "项目名称" })[0], { target: { value: "未保存诊断" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "保存收费项目" })); });
  expect((screen.getAllByRole("textbox", { name: "项目名称" })[0] as HTMLInputElement).value).toBe("未保存诊断");
  const latest = structuredClone(detail); latest.order.version = 5; latest.charges.totals.wholeOrderDiscountMinor = 9000;
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValueOnce(latest);
  navigation.language = "en";
  view.rerender(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await waitFor(() => expect(fetchFormalBusinessOrder).toHaveBeenCalledTimes(2));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Save charges" }));
  await waitFor(() => expect(replaceFormalChargeVersion).toHaveBeenCalledTimes(2));
  expect(vi.mocked(replaceFormalChargeVersion).mock.calls[1][1]).toMatchObject({ expectedBusinessOrderVersion: 4, wholeOrderDiscount: "50" });
});

it("allows explicit comparison after a conflict without submitting until the user saves", async () => {
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  fireEvent.change(screen.getAllByRole("textbox", { name: "项目名称" })[0], { target: { value: "我的诊断草稿" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "保存收费项目" })); });
  const latest = structuredClone(detail);
  latest.order.version = 5;
  latest.charges.items[0].nameZh = "别人更新的诊断";
  latest.charges.totals.wholeOrderDiscountMinor = 9000;
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValueOnce(latest);
  fireEvent.click(screen.getByRole("button", { name: "核对最新收费" }));
  const dialog = await screen.findByRole("dialog", { name: "核对收费版本" });
  await within(dialog).findByText("别人更新的诊断");
  expect(within(dialog).getByText("我的诊断草稿")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "核对后保留我的收费与优惠" }));
  expect(replaceFormalChargeVersion).toHaveBeenCalledTimes(1);
  expect((screen.getAllByRole("textbox", { name: "项目名称" })[0] as HTMLInputElement).value).toBe("我的诊断草稿");
  fireEvent.click(screen.getByRole("button", { name: "保存收费项目" }));
  await waitFor(() => expect(replaceFormalChargeVersion).toHaveBeenCalledTimes(2));
  expect(vi.mocked(replaceFormalChargeVersion).mock.calls[1][1]).toMatchObject({ expectedBusinessOrderVersion: 5, wholeOrderDiscount: "50" });
});

it("can retry reading, close without losing draft, then adopt all latest charges and discounts as an unsaved draft", async () => {
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  fireEvent.change(screen.getAllByRole("textbox", { name: "项目名称" })[0], { target: { value: "本地未保存" } });
  vi.mocked(fetchFormalBusinessOrder).mockRejectedValueOnce(new Error("核对连接失败"));
  fireEvent.click(screen.getByRole("button", { name: "核对最新收费" }));
  await screen.findByText("核对连接失败");
  fireEvent.click(screen.getByRole("button", { name: "关闭核对收费版本" }));
  expect((screen.getAllByRole("textbox", { name: "项目名称" })[0] as HTMLInputElement).value).toBe("本地未保存");
  vi.mocked(fetchFormalBusinessOrder).mockRejectedValueOnce(new Error("核对连接失败"));
  fireEvent.click(screen.getByRole("button", { name: "核对最新收费" }));
  await screen.findByText("核对连接失败");
  const latest = structuredClone(detail); latest.order.version = 6;
  latest.charges.items[0].nameZh = "采用的新项目";
  latest.charges.totals.wholeOrderDiscountMinor = 9000;
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValueOnce(latest);
  fireEvent.click(screen.getByRole("button", { name: "重新读取最新收费" }));
  await screen.findByText("采用的新项目");
  fireEvent.click(screen.getByRole("button", { name: "使用最新收费与优惠作为草稿" }));
  expect(replaceFormalChargeVersion).not.toHaveBeenCalled();
  expect((screen.getAllByRole("textbox", { name: "项目名称" })[0] as HTMLInputElement).value).toBe("采用的新项目");
  fireEvent.click(screen.getByRole("button", { name: "保存收费项目" }));
  await waitFor(() => expect(replaceFormalChargeVersion).toHaveBeenCalledTimes(1));
  expect(vi.mocked(replaceFormalChargeVersion).mock.calls[0][1]).toMatchObject({ expectedBusinessOrderVersion: 6, wholeOrderDiscount: "90" });
});

it("does not offer rebasing when the latest order is voided and preserves the editable draft on close", async () => {
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  fireEvent.change(screen.getAllByRole("textbox", { name: "项目名称" })[0], { target: { value: "暂存内容" } });
  const latest = structuredClone(detail); latest.order.voided = true;
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValueOnce(latest);
  fireEvent.click(screen.getByRole("button", { name: "核对最新收费" }));
  await screen.findByText(/该业务单目前只读或已作废/);
  expect(screen.queryByRole("button", { name: "核对后保留我的收费与优惠" })).toBeNull();
  expect(screen.queryByRole("button", { name: "使用最新收费与优惠作为草稿" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭核对收费版本" }));
  expect((screen.getAllByRole("textbox", { name: "项目名称" })[0] as HTMLInputElement).value).toBe("暂存内容");
  expect(replaceFormalChargeVersion).not.toHaveBeenCalled();
});

it("offers bottom save and cancel, locks the draft during saving, and retains inputs for retry", async () => {
  let fail!: (error: Error) => void;
  vi.mocked(replaceFormalChargeVersion).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  const name = screen.getAllByRole("textbox", { name: "项目名称" })[0] as HTMLInputElement;
  fireEvent.change(name, { target: { value: "底部保存草稿" } });
  const actions = screen.getByRole("group", { name: "收费编辑操作" });
  fireEvent.click(within(actions).getByRole("button", { name: "保存收费与备注" }));
  await waitFor(() => expect(replaceFormalChargeVersion).toHaveBeenCalledTimes(1));
  expect(name.matches(":disabled")).toBe(true);
  expect(within(actions).getByRole("button", { name: "放弃本次编辑" }).matches(":disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "取消编辑" }).matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "保存收费项目" }));
  expect(replaceFormalChargeVersion).toHaveBeenCalledTimes(1);
  await act(async () => { fail(new Error("保存连接中断")); });
  expect(name.matches(":disabled")).toBe(false);
  expect(name.value).toBe("底部保存草稿");
  fireEvent.click(within(actions).getByRole("button", { name: "保存收费与备注" }));
  await waitFor(() => expect(replaceFormalChargeVersion).toHaveBeenCalledTimes(2));
  // A started request is not a settled UI. Wait for the retry failure to unlock
  // the draft before exercising the user-visible cancel path.
  await waitFor(() => expect(within(actions).getByRole("button", { name: "放弃本次编辑" }).matches(":disabled")).toBe(false));
  fireEvent.click(within(actions).getByRole("button", { name: "放弃本次编辑" }));
  expect(screen.queryByRole("group", { name: "收费编辑操作" })).toBeNull();
  expect(screen.getByRole("button", { name: "编辑收费项目" })).toBeTruthy();
});

it("opens comparison from the bottom of the form without submitting", async () => {
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  const actions = screen.getByRole("group", { name: "收费编辑操作" });
  fireEvent.click(within(actions).getByRole("button", { name: "核对版本" }));
  await screen.findByRole("dialog", { name: "核对收费版本" });
  expect(replaceFormalChargeVersion).not.toHaveBeenCalled();
});

it("does not overwrite human changes made while item translation is running", async () => {
  let translated!: (text: string) => void;
  vi.mocked(aiTranslateRepair).mockImplementationOnce(() => new Promise(resolve => { translated = resolve; })).mockResolvedValueOnce("AI description");
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  fireEvent.click(screen.getByRole("button", { name: "翻译收费项目 检查工时" }));
  const name = screen.getAllByRole("textbox", { name: "项目英文名称" })[0] as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Human approved wording" } });
  await act(async () => { translated("AI name"); });
  expect(name.value).toBe("Human approved wording");
  expect((screen.getAllByRole("textbox", { name: "英文描述" })[0] as HTMLInputElement).value).toBe("AI description");
});

it("can cancel a pending translation to save, and ignores its late result in a reopened draft", async () => {
  let translated!: (text: string) => void;
  vi.mocked(aiTranslateRepair).mockImplementationOnce(() => new Promise(resolve => { translated = resolve; })).mockResolvedValueOnce("AI description");
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  fireEvent.click(screen.getByRole("button", { name: "翻译收费项目 检查工时" }));
  expect(screen.getByRole("button", { name: "保存收费项目" }).matches(":disabled")).toBe(true);
  fireEvent.click(within(screen.getByRole("group", { name: "收费编辑操作" })).getByRole("button", { name: "停止翻译" }));
  expect(screen.getByRole("button", { name: "保存收费项目" }).matches(":disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑收费项目" }));
  await act(async () => { translated("Stale AI translation"); });
  expect((screen.getAllByRole("textbox", { name: "项目英文名称" })[0] as HTMLInputElement).value).toBe("Inspection");
  expect(replaceFormalChargeVersion).not.toHaveBeenCalled();
});

it("keeps manual note edits when translation finishes and makes translation failures recoverable", async () => {
  const withNote = structuredClone(detail);
  withNote.charges.notes = [{ id: 91, kind: "customer_concern", contentZh: "先诊断", contentEn: "Diagnose first", sortOrder: 0 }];
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValueOnce(withNote);
  let translated!: (text: string) => void;
  vi.mocked(aiTranslateRepair).mockImplementationOnce(() => new Promise(resolve => { translated = resolve; }));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  fireEvent.click(screen.getByRole("button", { name: /翻译备注/ }));
  const note = screen.getByRole("textbox", { name: "备注英文内容" }) as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: "Manual note" } });
  await act(async () => { translated("AI note"); });
  expect(note.value).toBe("Manual note");
  vi.mocked(aiTranslateRepair).mockRejectedValueOnce(new Error("服务断开"));
  fireEvent.click(screen.getByRole("button", { name: /翻译备注/ }));
  await screen.findByText(/翻译失败.*服务断开/);
  expect(note.value).toBe("Manual note");
  expect(screen.getByRole("button", { name: "保存收费项目" }).matches(":disabled")).toBe(false);
});

const organizedCharges = { items: [{ category: "labor" as const, descZh: "AI新项目", descEn: "AI item", quantity: 1, unitPriceJmd: 200, pendingQuote: false }], notes: [] };

async function openNaturalInput() {
  fireEvent.click(await screen.findByRole("button", { name: "自然语言录入" }));
  fireEvent.change(screen.getByRole("textbox", { name: "自然语言输入" }), { target: { value: "诊断一次 200" } });
  fireEvent.click(screen.getByRole("button", { name: "AI 整理到收费草稿" }));
}

it("ignores cancelled natural-language results and does not reopen the editor", async () => {
  let finish!: (result: typeof organizedCharges) => void;
  vi.mocked(aiParseFormalChargeEntry).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await openNaturalInput();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await act(async () => { finish(organizedCharges); });
  expect(screen.queryAllByRole("textbox", { name: "项目名称" })).toHaveLength(0);
  expect(screen.getByRole("button", { name: "编辑收费项目" })).toBeTruthy();
});

it("does not replace a newly opened manual draft with an older natural-language request", async () => {
  let finish!: (result: typeof organizedCharges) => void;
  vi.mocked(aiParseFormalChargeEntry).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await openNaturalInput();
  fireEvent.click(screen.getByRole("button", { name: "编辑收费项目" }));
  const name = screen.getAllByRole("textbox", { name: "项目名称" })[0] as HTMLInputElement;
  fireEvent.change(name, { target: { value: "人工新草稿" } });
  await act(async () => { finish(organizedCharges); });
  expect(name.value).toBe("人工新草稿");
  expect(screen.getAllByRole("textbox", { name: "项目名称" })).toHaveLength(3);
});

it("shows a natural-language service failure even before editing and can retry with the same text", async () => {
  vi.mocked(aiParseFormalChargeEntry).mockRejectedValueOnce(new Error("整理连接中断")).mockResolvedValueOnce(organizedCharges);
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await openNaturalInput();
  await screen.findByText(/整理连接中断/);
  expect((screen.getByRole("textbox", { name: "自然语言输入" }) as HTMLTextAreaElement).value).toBe("诊断一次 200");
  fireEvent.click(screen.getByRole("button", { name: "AI 整理到收费草稿" }));
  await waitFor(() => expect(screen.getAllByRole("textbox", { name: "项目名称" })).toHaveLength(4));
  expect(replaceFormalChargeVersion).not.toHaveBeenCalled();
});

it("preserves edits in the same draft and offers bottom stop before saving while preparation is pending", async () => {
  let finish!: (result: typeof organizedCharges) => void;
  vi.mocked(aiParseFormalChargeEntry).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  await openNaturalInput();
  const name = screen.getAllByRole("textbox", { name: "项目名称" })[0] as HTMLInputElement;
  fireEvent.change(name, { target: { value: "继续手动修改" } });
  expect(screen.getByRole("button", { name: "保存收费项目" }).matches(":disabled")).toBe(true);
  fireEvent.click(within(screen.getByRole("group", { name: "收费编辑操作" })).getByRole("button", { name: "停止 AI 整理" }));
  expect(screen.getByRole("button", { name: "保存收费项目" }).matches(":disabled")).toBe(false);
  await act(async () => { finish(organizedCharges); });
  expect(name.value).toBe("继续手动修改");
  expect(screen.getAllByRole("textbox", { name: "项目名称" })).toHaveLength(3);
  expect((screen.getByRole("textbox", { name: "自然语言输入" }) as HTMLTextAreaElement).value).toBe("诊断一次 200");
});

it("keeps source text and explains empty results instead of entering an empty preparation", async () => {
  vi.mocked(aiParseFormalChargeEntry).mockResolvedValueOnce({ items: [], notes: [] });
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await openNaturalInput();
  await screen.findByText(/未识别到收费项目或备注/);
  expect(screen.getByRole("button", { name: "编辑收费项目" })).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "自然语言输入" }) as HTMLTextAreaElement).value).toBe("诊断一次 200");
});

it("stages AI pending prices separately from free items and saves the pending fact", async () => {
  vi.mocked(aiParseFormalChargeEntry).mockResolvedValueOnce({ items: [
    { category: "parts", descZh: "待报价清洗剂", descEn: "Cleaning agent", quantity: 2, unitPriceJmd: 0, pendingQuote: true },
    { category: "labor", descZh: "免费复查", descEn: "Free recheck", quantity: 1, unitPriceJmd: 0, pendingQuote: false },
  ], notes: [] });
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await openNaturalInput();
  const pending = await screen.findByRole("checkbox", { name: "待报价 待报价清洗剂" });
  expect((pending as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: "待报价 免费复查" }) as HTMLInputElement).checked).toBe(false);
  const pendingRow = pending.closest(".formal-charge-editor-row") as HTMLElement;
  expect((within(pendingRow).getByRole("textbox", { name: "含税单价" }) as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "保存收费与备注" }));
  await waitFor(() => expect(replaceFormalChargeVersion).toHaveBeenCalledOnce());
  const items = vi.mocked(replaceFormalChargeVersion).mock.calls[0][1].items;
  expect(items.find(item => item.nameZh === "待报价清洗剂")).toMatchObject({ pendingQuote: true, unitPrice: "", itemDiscount: "0", quantity: "2" });
  expect(items.find(item => item.nameZh === "免费复查")).toMatchObject({ pendingQuote: false, unitPrice: "0" });
});

it("lets staff mark a charge pending and undo that choice without losing their typed price and discount", async () => {
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  const pending = screen.getByRole("checkbox", { name: "待报价 检查工时" });
  fireEvent.click(pending);
  const price = screen.getAllByRole("textbox", { name: "含税单价" })[0] as HTMLInputElement;
  expect(price.disabled).toBe(true);
  expect(price.value).toBe("");
  fireEvent.click(pending);
  expect(price.disabled).toBe(false);
  expect(price.value).toBe("500");
  expect((screen.getAllByRole("textbox", { name: "本项折扣" })[0] as HTMLInputElement).value).toBe("10");
  fireEvent.click(pending);
  fireEvent.click(screen.getByRole("button", { name: "保存收费与备注" }));
  await waitFor(() => expect(replaceFormalChargeVersion).toHaveBeenCalledOnce());
  expect(vi.mocked(replaceFormalChargeVersion).mock.calls[0][1].items[0]).toMatchObject({ pendingQuote: true, unitPrice: "", itemDiscount: "0" });
});

it("keeps saved pending prices visible and retains them through version comparison", async () => {
  const pendingDetail = structuredClone(detail);
  Object.assign(pendingDetail.charges.items[1], { pendingQuote: true, unitPriceMinor: 0, subtotalMinor: 0 });
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValue(pendingDetail);
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  const item = await screen.findByTestId("charge-item-42");
  expect(within(item).getByText("待报价")).toBeTruthy();
  expect(within(item).queryByText("JMD 0.00")).toBeNull();
  expect(await screen.findAllByText(/1 项待报价，当前合计仅含已报价部分/)).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "编辑收费项目" }));
  expect((screen.getByRole("checkbox", { name: "待报价 配件" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "核对最新收费" }));
  const dialog = await screen.findByRole("dialog", { name: "核对收费版本" });
  await within(dialog).findByText("系统最新收费");
  expect(within(dialog).getAllByText("待报价")).toHaveLength(2);
  fireEvent.click(within(dialog).getByRole("button", { name: "使用最新收费与优惠作为草稿" }));
  expect((screen.getByRole("checkbox", { name: "待报价 配件" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "待报价 配件" }));
  const prices = screen.getAllByRole("textbox", { name: "含税单价" });
  fireEvent.change(prices[1], { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "保存收费与备注" }));
  await waitFor(() => expect(replaceFormalChargeVersion).toHaveBeenCalledOnce());
  expect(vi.mocked(replaceFormalChargeVersion).mock.calls[0][1].items[1]).toMatchObject({ pendingQuote: false, unitPrice: "0" });
});

it("does not call an order fully settled while a price is still pending", async () => {
  const pendingDetail = structuredClone(detail);
  Object.assign(pendingDetail.charges.items[1], { pendingQuote: true, unitPriceMinor: 0, subtotalMinor: 0 });
  Object.assign(pendingDetail.ledger, { balanceMinor: 0, totalPaidMinor: pendingDetail.ledger.currentDueMinor });
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValue(pendingDetail);
  const { container } = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await screen.findByRole("button", { name: "编辑收费项目" });
  expect(container.textContent).not.toContain("财务已结清");
  expect(container.textContent).not.toContain("未结余额 / 已结清");
  expect(screen.getByText("已报价部分未结余额")).toBeTruthy();
});

it("isolates the old charge draft immediately when the displayed business order changes", async () => {
  const next = structuredClone(detail);
  next.order.id = 8; next.order.orderNo = "BO-TEST-8"; next.charges.businessOrderId = 8;
  next.charges.items[0].nameZh = "另一单工时";
  let loadNext!: (value: FormalBusinessOrderDetail) => void;
  const view = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  fireEvent.change(screen.getAllByRole("textbox", { name: "项目名称" })[0], { target: { value: "前单未保存项目" } });
  vi.mocked(fetchFormalBusinessOrder).mockImplementationOnce(() => new Promise(resolve => { loadNext = resolve; }));
  view.rerender(<FormalBusinessOrderDetailView businessOrderId={8} />);
  expect(screen.queryByDisplayValue("前单未保存项目")).toBeNull();
  expect(screen.queryByRole("button", { name: "保存收费项目" })).toBeNull();
  await act(async () => { loadNext(next); });
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  expect((screen.getAllByRole("textbox", { name: "项目名称" })[0] as HTMLInputElement).value).toBe("另一单工时");
  fireEvent.click(screen.getByRole("button", { name: "保存收费项目" }));
  await waitFor(() => expect(vi.mocked(replaceFormalChargeVersion).mock.calls).toHaveLength(1));
  expect(vi.mocked(replaceFormalChargeVersion).mock.calls[0][0]).toBe(8);
  expect(vi.mocked(replaceFormalChargeVersion).mock.calls[0][1].items[0].nameZh).toBe("另一单工时");
});

it("does not apply an old order's late AI result to the next order", async () => {
  let finish!: (value: typeof organizedCharges) => void;
  vi.mocked(aiParseFormalChargeEntry).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  await openNaturalInput();
  const next = structuredClone(detail);
  next.order.id = 8; next.order.orderNo = "BO-TEST-8"; next.charges.businessOrderId = 8;
  next.charges.items[0].nameZh = "另一单工时";
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValueOnce(next);
  view.rerender(<FormalBusinessOrderDetailView businessOrderId={8} />);
  await screen.findByText("BO-TEST-8");
  await act(async () => { finish(organizedCharges); });
  expect(screen.queryByDisplayValue("AI新项目")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "自然语言输入" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "编辑收费项目" }));
  expect((screen.getAllByRole("textbox", { name: "项目名称" })[0] as HTMLInputElement).value).toBe("另一单工时");
});

it("shows whole quantities without decimal zeros and preserves fractional evidence for manual correction", async () => {
  const legacy = structuredClone(detail);
  legacy.charges.items[0].quantity = "2.000";
  legacy.charges.items[1].quantity = "1.250";
  vi.mocked(fetchFormalBusinessOrder).mockResolvedValueOnce(legacy);
  render(<FormalBusinessOrderDetailView businessOrderId={7} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑收费项目" }));
  const quantities = screen.getAllByRole("textbox", { name: "数量" }) as HTMLInputElement[];
  expect(quantities[0].value).toBe("2");
  expect(quantities[1].value).toBe("1.250");
  expect(screen.getByText(/数量须为正整数.*核对数量与单价/)).toBeTruthy();
  screen.getByRole("button", { name: "保存收费项目" }).focus();
  fireEvent.click(screen.getByRole("button", { name: "保存收费项目" }));
  expect(vi.mocked(replaceFormalChargeVersion).mock.calls).toHaveLength(0);
  expect(quantities[1].value).toBe("1.250");
  expect(document.activeElement).toBe(quantities[1]);
  fireEvent.change(quantities[1], { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "保存收费项目" }));
  await waitFor(() => expect(vi.mocked(replaceFormalChargeVersion).mock.calls).toHaveLength(1));
  expect(vi.mocked(replaceFormalChargeVersion).mock.calls[0][1].items[1]).toMatchObject({ quantity: "2", unitPrice: "300" });
});
