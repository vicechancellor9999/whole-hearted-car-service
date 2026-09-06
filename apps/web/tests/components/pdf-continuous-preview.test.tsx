import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PdfCanvasPreview } from "../../src/components/orders/pdf-canvas-preview";

const fixture = vi.hoisted(() => ({ pages: 2 }));
beforeEach(() => { fixture.pages = 2; });
vi.mock("../../src/lib/orders/pdfjs-loader", () => ({ loadPdfJs: async () => ({
  getDocument: () => ({ promise: Promise.resolve({ numPages: fixture.pages, getPage: async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  }) }), destroy: async () => {} }),
}) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("retains copy identity across six pages and jumps to the customer copy and its last page", async () => {
  fixture.pages = 6;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const scroll = vi.fn();
  render(<PdfCanvasPreview bytes={new Uint8Array([6])} fillHeight fitWidth compactToolbar continuousPages copyLabels={["办公室联", "客户联"]} />);
  screen.getByLabelText("单据页面，可滚动查看").scrollTo = scroll;
  await waitFor(() => expect(screen.getAllByTestId("pdf-canvas")).toHaveLength(6));
  await waitFor(() => expect(screen.queryByText("加载页面…")).toBeNull());
  expect(screen.getByRole("heading", { name: "办公室联 · 第 3 / 6 页" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "客户联 · 第 4 / 6 页" })).toBeTruthy();
  const customer = screen.getByRole("button", { name: "客户联 · 第 4–6 页" });
  fireEvent.click(customer);
  expect(screen.getByTestId("pdf-preview-pager").textContent).toBe("4 / 6");
  expect(customer.getAttribute("aria-current")).toBe("page");
  fireEvent.change(screen.getByRole("combobox", { name: "选择页面" }), { target: { value: "6" } });
  expect(screen.getByTestId("pdf-preview-pager").textContent).toBe("6 / 6");
  expect(customer.getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button", { name: "下一页" }).hasAttribute("disabled")).toBe(true);
  expect(scroll).toHaveBeenCalled();
});

it("shows both copies in one continuous reader before any page-navigation click", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const scroll = vi.fn();
  render(<PdfCanvasPreview bytes={new Uint8Array([1])} fillHeight fitWidth compactToolbar continuousPages pageLabels={["办公室联", "客户联"]} />);
  screen.getByLabelText("单据页面，可滚动查看").scrollTo = scroll;
  await waitFor(() => expect(screen.getAllByTestId("pdf-canvas")).toHaveLength(2));
  expect(screen.getAllByTestId("pdf-canvas").map((node) => node.getAttribute("data-page"))).toEqual(["1", "2"]);
  expect(screen.getByText("共 2 页 · 连续预览")).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("加载页面…")).toBeNull());
  scroll.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "客户联 · 第 2 页" }));
  expect(scroll).toHaveBeenCalledOnce();
  expect(screen.getAllByTestId("pdf-canvas")).toHaveLength(2);
  expect(screen.getByTestId("pdf-preview-pager").textContent).toContain("2 / 2");
  scroll.mockClear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: this.dataset.pdfPage === "2" ? 900 : 0 } as DOMRect;
  });
  fireEvent.change(screen.getByRole("combobox", { name: "预览比例" }), { target: { value: "150" } });
  await waitFor(() => expect(screen.getAllByTestId("pdf-canvas").every((node) => (node as HTMLCanvasElement).style.width === "892.5px")).toBe(true));
  expect(screen.getAllByTestId("pdf-canvas")).toHaveLength(2);
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 900, behavior: "instant" }));
});

it("keeps the existing single-page reader for documents that did not opt in", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  render(<PdfCanvasPreview bytes={new Uint8Array([1])} fillHeight fitWidth compactToolbar />);
  await waitFor(() => expect(screen.getAllByTestId("pdf-canvas")).toHaveLength(1));
  expect(screen.getByTestId("pdf-canvas").getAttribute("data-page")).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(screen.getByTestId("pdf-canvas").getAttribute("data-page")).toBe("2"));
  expect(screen.getAllByTestId("pdf-canvas")).toHaveLength(1);
});

it("does not invent copy boundaries when a paired file has an odd page count", async () => {
  fixture.pages = 3;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  render(<PdfCanvasPreview bytes={new Uint8Array([3])} fillHeight fitWidth compactToolbar continuousPages copyLabels={["办公室联", "客户联"]} />);
  screen.getByLabelText("单据页面，可滚动查看").scrollTo = vi.fn();
  await waitFor(() => expect(screen.getAllByTestId("pdf-canvas")).toHaveLength(3));
  expect(screen.getByRole("alert").textContent).toContain("页数与成套联别不符");
  expect(screen.queryByRole("button", { name: /客户联/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "第 3 页" }));
  expect(screen.getByTestId("pdf-preview-pager").textContent).toBe("3 / 3");
});
