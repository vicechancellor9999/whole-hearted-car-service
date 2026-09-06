import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormalBusinessOrderDocumentsWorkspace } from "../../src/components/orders/formal-business-order-documents-workspace";
import { printPdfBytes } from "../../src/lib/orders/ir-pdf-print";
import { createFormalDocumentRevision, fetchFormalDocumentDetail, type FormalBusinessOrderDocument, type FormalBusinessOrderDocumentDetail } from "../../src/lib/api/formal-business-orders";

vi.mock("../../src/lib/api/formal-business-orders", async (original) => ({ ...await original<object>(), fetchFormalDocumentDetail: vi.fn(), createFormalDocumentRevision: vi.fn() }));
// PDF rasterization is browser-only; this test exercises selection/request ownership.
vi.mock("../../src/components/orders/pdf-canvas-preview", () => ({ PdfCanvasPreview: () => null }));
vi.mock("../../src/lib/orders/ir-pdf-print", () => ({ printPdfBytes: vi.fn() }));
const first: FormalBusinessOrderDocument = {
  id: 1, documentNo: "MEC-ONE", businessOrderId: 1, kind: "mechanic_work", chargeVersionId: 1, chargeVersionNo: 1, repairRoundId: 1, repairRoundNo: 1, generatedAt: "2026-09-05T12:00:00Z", generatedBy: 1,
  snapshot: { version: 1, kind: "mechanic_work", businessOrder: { id: 1, orderNo: "BO-ONE" }, vehicle: { plate: "4321 AB", description: "Nissan", vin: null }, repairRound: { id: 1, roundNo: 1, teamName: null }, workItems: [], notes: [] },
};
const second = { ...first, id: 2, documentNo: "MEC-TWO", generatedAt: "2026-09-04T12:00:00Z" };
const paired: FormalBusinessOrderDocument = {
  ...first, id: 3, documentNo: "CUS-PAIR", kind: "customer_copy",
  snapshot: { version: 1, kind: "customer_copy", businessOrder: { id: 1, orderNo: "BO-ONE", plate: "4321 AB", vehicleDescription: "Nissan", vin: null, payerName: "David Blake", payerPhone: null, payerTrn: null, payerContactName: null }, charges: { versionNo: 1, totals: { grossMinor: 100000, lineDiscountMinor: 0, laborDiscountMinor: 0, partDiscountMinor: 0, otherDiscountMinor: 0, categoryDiscountMinor: 0, wholeOrderDiscountMinor: 0, totalDueMinor: 100000, includedGctMinor: 13043 }, items: [], notes: [] }, transactions: [], totals: { currentDueMinor: 100000, totalPaidMinor: 0, totalRefundedMinor: 0, balanceMinor: 100000 }, approval: { statementZh: "确认费用", statementEn: "Confirm charges" } },
};
const detail = (document: FormalBusinessOrderDocument): FormalBusinessOrderDocumentDetail => ({ document, latestRevisionNo: 2, revisions: [1, 2].map((revisionNo) => ({ id: document.id * 10 + revisionNo, documentId: document.id, revisionNo, fieldOverrides: {}, rendererVersion: revisionNo === 1 ? "old" : "new", fileId: revisionNo, contentSha256: "fixture", englishFileId: null, englishContentSha256: null, createdAt: "2026-09-05T12:00:00Z", createdBy: 1 })) });
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("offers the exact selected PDF beside a print failure and actually retries printing", async () => {
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValue(detail(first));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
  vi.mocked(printPdfBytes).mockRejectedValue(new Error("当前浏览器未启动系统打印"));
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first]} canWrite={false} busy={false} onGenerate={async () => null} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "系统打印" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "系统打印" }));
  const error = await screen.findByRole("alert");
  expect(error.textContent).toContain("当前浏览器未启动系统打印");
  expect(error.querySelector("a")?.getAttribute("href")).toBe("/api/formal/business-orders/1/documents/1/revisions/12/file?language=zh&download=1");
  fireEvent.click(screen.getByRole("button", { name: "重试打印" }));
  await waitFor(() => expect(printPdfBytes).toHaveBeenCalledTimes(2));
  expect(vi.mocked(printPdfBytes).mock.calls[1][0].bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(createFormalDocumentRevision).not.toHaveBeenCalled();
});

it("lets the reader open history, select a saved file, then return to an unobstructed preview", async () => {
  vi.mocked(fetchFormalDocumentDetail).mockImplementation(async (_, id) => detail(id === 2 ? second : first));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first, second]} canWrite={false} busy={false} onGenerate={async () => null} />);
  expect(screen.queryByRole("button", { name: /MEC-TWO/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "单据历史" }));
  fireEvent.click(screen.getByRole("button", { name: /MEC-TWO/ }));
  await waitFor(() => expect(screen.getByRole("link", { name: "下载 PDF" }).getAttribute("href")).toContain("/documents/2/"));
  expect(screen.queryByRole("region", { name: "单据历史列表" })).toBeNull();
  expect((screen.getByRole("combobox", { name: "选择单据" }) as HTMLSelectElement).value).toBe("2");
});

it.each(["bo-a4-v16-paired", "bo-a4-v18-pending-quote", "bo-a4-v19-long-content-pagination"])("selects the requested language for the newly generated %s pair and uses that file for download", async (rendererVersion) => {
  const pairedDetail = detail(paired);
  pairedDetail.revisions.forEach((revision) => { revision.rendererVersion = rendererVersion; revision.englishFileId = 99; });
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValue(pairedDetail);
  const fileFetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer });
  vi.stubGlobal("fetch", fileFetch);
  const generate = vi.fn(async () => paired);
  const { rerender } = render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[]} canWrite busy={false} onGenerate={generate} />);
  fireEvent.click(screen.getByRole("button", { name: "生成单据" }));
  fireEvent.change(screen.getByRole("combobox", { name: "生成语言" }), { target: { value: "en" } });
  fireEvent.click(screen.getByRole("button", { name: "生成费用确认单（办公室联＋客户联）" }));
  await waitFor(() => expect(generate).toHaveBeenCalledExactlyOnceWith("customer_copy"));
  rerender(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[paired]} canWrite busy={false} onGenerate={generate} />);
  await waitFor(() => expect(screen.getByRole("link", { name: "下载 PDF" }).getAttribute("href")).toContain("language=en"));
  expect(screen.getByText(/按所选语言成套打印/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "中文" }));
  await waitFor(() => expect(screen.getByRole("link", { name: "下载 PDF" }).getAttribute("href")).toContain("language=zh"));
});

it("keeps historical office-only documents readable behind a history disclosure", async () => {
  const office: FormalBusinessOrderDocument = { ...paired, id: 4, kind: "office_archive", documentNo: "OFF-OLD", snapshot: { ...paired.snapshot, kind: "office_archive" } as FormalBusinessOrderDocument["snapshot"] };
  vi.mocked(fetchFormalDocumentDetail).mockImplementation(async (_, id) => detail(id === 4 ? office : paired));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[paired, office]} canWrite={false} busy={false} onGenerate={async () => null} />);
  expect(screen.queryByRole("button", { name: /OFF-OLD/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "单据历史" }));
  fireEvent.click(screen.getByRole("button", { name: "查看旧版独立办公室联" }));
  fireEvent.click(screen.getByRole("button", { name: /OFF-OLD/ }));
  await waitFor(() => expect(screen.getByRole("link", { name: "下载 PDF" }).getAttribute("href")).toContain("/documents/4/"));
});

it("does not relabel a pre-paired customer file as a two-copy set", async () => {
  const historical = detail(paired);
  historical.revisions.forEach((revision) => { revision.rendererVersion = "bo-a4-v15"; });
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValue(historical);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[paired]} canWrite={false} busy={false} onGenerate={async () => null} />);
  expect(await screen.findByText(/历史独立联/)).toBeTruthy();
  expect(screen.queryByText(/按所选语言成套打印/)).toBeNull();
  expect(screen.getByRole("link", { name: "下载 PDF" }).getAttribute("href")).toContain("/documents/3/");
});

it("keeps generation actions behind an explicit disclosure, and closes it after selecting the generated document", async () => {
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValue(detail(first));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
  const generate = vi.fn(async () => first);
  const { rerender } = render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[]} canWrite busy={false} onGenerate={generate} />);
  expect(screen.queryByRole("button", { name: "生成费用确认单（办公室联＋客户联）" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "生成单据" }));
  expect(screen.queryByRole("button", { name: "生成办公室签字留底联" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "生成费用确认单（办公室联＋客户联）" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "生成费用确认单（办公室联＋客户联）" })).toBeNull());
  expect(generate).toHaveBeenCalledWith("customer_copy");
  rerender(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first]} canWrite busy={false} onGenerate={generate} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "系统打印" }) as HTMLButtonElement).disabled).toBe(false));
});

it("reports an empty revision list instead of loading forever", async () => {
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValue({ ...detail(first), revisions: [] });
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first]} canWrite={false} busy={false} onGenerate={async () => null} />);
  expect((await screen.findByRole("alert")).textContent).toContain("没有可读取的打印版本");
  expect(screen.queryByText("正在加载所选单据…")).toBeNull();
  expect(screen.queryByRole("button", { name: "重新生成文件" })).toBeNull();
  expect(screen.getByText(/请前台或管理员/)).toBeTruthy();
});

it("recovers a saved document with no PDF, without generating a new document", async () => {
  const empty = { ...detail(first), latestRevisionNo: 0, revisions: [] };
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValueOnce(empty).mockResolvedValueOnce(empty).mockResolvedValue(detail(first));
  vi.mocked(createFormalDocumentRevision).mockResolvedValue(detail(first).revisions[0]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
  const generate = vi.fn();
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first]} canWrite busy={false} onGenerate={generate} />);
  fireEvent.click(await screen.findByRole("button", { name: "重新生成文件" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "系统打印" }) as HTMLButtonElement).disabled).toBe(false));
  expect(createFormalDocumentRevision).toHaveBeenCalledExactlyOnceWith(1, 1, { expectedLatestRevisionNo: 0, fieldOverrides: {} });
  expect(generate).not.toHaveBeenCalled();
});

it("recognizes a repair that committed despite a lost response", async () => {
  const empty = { ...detail(first), latestRevisionNo: 0, revisions: [] };
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValueOnce(empty).mockResolvedValueOnce(empty).mockResolvedValue(detail(first));
  vi.mocked(createFormalDocumentRevision).mockRejectedValue(new Error("网络中断"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first]} canWrite busy={false} onGenerate={async () => null} />);
  fireEvent.click(await screen.findByRole("button", { name: "重新生成文件" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "系统打印" }) as HTMLButtonElement).disabled).toBe(false));
  expect(createFormalDocumentRevision).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps failed recovery actionable and ignores double clicks while it is pending", async () => {
  const empty = { ...detail(first), latestRevisionNo: 0, revisions: [] };
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValue(empty);
  let rejectRepair!: (error: Error) => void;
  vi.mocked(createFormalDocumentRevision).mockReturnValue(new Promise((_, reject) => { rejectRepair = reject; }));
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first]} canWrite busy={false} onGenerate={async () => null} />);
  const recover = await screen.findByRole("button", { name: "重新生成文件" });
  fireEvent.click(recover); fireEvent.click(recover);
  await waitFor(() => expect(createFormalDocumentRevision).toHaveBeenCalledTimes(1));
  rejectRepair(new Error("存储服务不可用"));
  expect(await screen.findByRole("button", { name: "重新生成文件" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("存储服务不可用");
  expect((screen.getByRole("button", { name: "系统打印" }) as HTMLButtonElement).disabled).toBe(true);
});

it("does not replace the selected document with a late recovery result", async () => {
  const empty = { ...detail(first), latestRevisionNo: 0, revisions: [] };
  vi.mocked(fetchFormalDocumentDetail).mockImplementation(async (_, id) => id === 1 ? empty : detail(second));
  let resolveRepair!: (value: ReturnType<typeof detail>["revisions"][number]) => void;
  vi.mocked(createFormalDocumentRevision).mockReturnValue(new Promise((resolve) => { resolveRepair = resolve; }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first, second]} canWrite busy={false} onGenerate={async () => null} />);
  fireEvent.click(await screen.findByRole("button", { name: "重新生成文件" }));
  await waitFor(() => expect(createFormalDocumentRevision).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "单据历史" }));
  fireEvent.click(screen.getByRole("button", { name: /MEC-TWO/ }));
  await waitFor(() => expect(screen.getByRole("link", { name: "下载 PDF" }).getAttribute("href")).toContain("/documents/2/"));
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValue(detail(first));
  resolveRepair(detail(first).revisions[0]);
  await waitFor(() => expect(fetchFormalDocumentDetail).toHaveBeenCalledTimes(4));
  expect(screen.getByRole("link", { name: "下载 PDF" }).getAttribute("href")).toContain("/documents/2/");
  expect(screen.queryByText("文件已恢复，可以预览和打印。")).toBeNull();
});

it("reloads a failed PDF at the same URL, then offers a repair revision retaining overrides", async () => {
  const current = detail(first);
  current.revisions[1].fieldOverrides = { "notes": "保留人工修订" };
  const repaired = { ...current, latestRevisionNo: 3, revisions: [...current.revisions, { ...current.revisions[1], id: 13, revisionNo: 3 }] };
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValue(current);
  const fileFetch = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal("fetch", fileFetch);
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first]} canWrite busy={false} onGenerate={async () => null} />);
  await screen.findByRole("button", { name: "生成修复版" });
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(fileFetch).toHaveBeenCalledTimes(2));
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValueOnce(current).mockResolvedValue(repaired);
  vi.mocked(createFormalDocumentRevision).mockResolvedValue(repaired.revisions[2]);
  fileFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer });
  fireEvent.click(await screen.findByRole("button", { name: "生成修复版" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "系统打印" }) as HTMLButtonElement).disabled).toBe(false));
  expect(createFormalDocumentRevision).toHaveBeenCalledExactlyOnceWith(1, 1, { expectedLatestRevisionNo: 2, fieldOverrides: { notes: "保留人工修订" } });
  fireEvent.click(screen.getByRole("button", { name: "单据历史" }));
  expect(screen.getAllByRole("option", { name: /^R/ })).toHaveLength(3);
});

it("disables printing the previous file as soon as the user selects a different document, and provides retry", async () => {
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValueOnce(detail(first)).mockRejectedValueOnce(new Error("读取失败")).mockResolvedValueOnce(detail(second));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first, second]} canWrite={false} busy={false} onGenerate={async () => null} />);
  const print = screen.getByRole("button", { name: "系统打印" }) as HTMLButtonElement;
  await waitFor(() => expect(print.disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "单据历史" }));
  expect(screen.getAllByRole("option", { name: /^R/ })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: /MEC-TWO/ }));
  expect(print.disabled).toBe(true);
  await screen.findByRole("alert");
  expect(print.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(print.disabled).toBe(false));
  expect(screen.getByRole("link", { name: "下载 PDF" }).getAttribute("href")).toContain("/documents/2/revisions/22/");
});

it("invalidates printable bytes immediately when selecting a different print revision", async () => {
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValue(detail(first));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }).mockRejectedValueOnce(new Error("PDF 读取失败")));
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first]} currentChargeVersionNo={4} canWrite={false} busy={false} onGenerate={async () => null} />);
  const print = screen.getByRole("button", { name: "系统打印" }) as HTMLButtonElement;
  await waitFor(() => expect(print.disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "单据历史" }));
  fireEvent.change(screen.getByRole("combobox", { name: "打印版本" }), { target: { value: "11" } });
  expect(print.disabled).toBe(true);
  await screen.findByRole("alert");
  expect(print.disabled).toBe(true);
  expect(screen.getByText(/当前收费 V4/)).toBeTruthy();
});

it("reloads the active document when its selected row is clicked again", async () => {
  vi.mocked(fetchFormalDocumentDetail).mockResolvedValue(detail(first));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
  render(<FormalBusinessOrderDocumentsWorkspace businessOrderId={1} documents={[first]} canWrite busy={false} onGenerate={async () => null} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "系统打印" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "单据历史" }));
  fireEvent.click(screen.getByRole("button", { name: /MEC-ONE/ }));
  await waitFor(() => expect((screen.getByRole("button", { name: "系统打印" }) as HTMLButtonElement).disabled).toBe(false));
  expect(fetchFormalDocumentDetail).toHaveBeenCalledTimes(2);
});
