import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BusinessOrderInspections } from "../../src/components/orders/business-order-inspections";
import { BusinessChargeSection } from "../../src/components/orders/business-charge-section";
import type { FormalChargeSnapshot } from "../../src/lib/api/formal-business-orders";

afterEach(cleanup);

const inspections = { english: false, items: [], total: 0, loading: false, error: false, canCreate: true, page: 1, pageCount: 1, onPage: vi.fn(), onCreate: vi.fn(), onRetry: vi.fn() };

describe("related inspections are an actionable workspace", () => {
  it("offers creation independently of the repair status", () => {
    const create = vi.fn();
    render(<BusinessOrderInspections {...inspections} onCreate={create} />);
    fireEvent.click(screen.getByRole("button", { name: "新建检查结果" }));
    expect(create).toHaveBeenCalledOnce();
    expect(screen.getByText("尚无相关检查结果")).toBeTruthy();
  });
  it("does not describe a failed request as an empty result", () => {
    const retry = vi.fn();
    render(<BusinessOrderInspections {...inspections} error onRetry={retry} />);
    expect(screen.getByRole("alert").textContent).toContain("未能读取");
    expect(screen.queryByText("尚无相关检查结果")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("shows loading rather than a misleading zero count", () => {
    render(<BusinessOrderInspections {...inspections} loading />);
    expect(screen.getByRole("status").textContent).toContain("正在读取");
    expect(screen.queryByText("尚无相关检查结果")).toBeNull();
  });
  it("respects write capability and exposes later pages", () => {
    const page = vi.fn();
    render(<BusinessOrderInspections {...inspections} canCreate={false} total={45} pageCount={3} onPage={page} />);
    expect(screen.queryByRole("button", { name: "新建检查结果" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(page).toHaveBeenCalledWith(2);
  });
});

describe("charge presentation", () => {
  const charges = {
    items: [
      { id: 1, kind: "labor", nameZh: "节气门清洗", nameEn: "Throttle cleaning", descriptionZh: "清洗后继续检查发动机", descriptionEn: "Inspect the engine after cleaning", unitItemId: 1, quantity: "1.000", unitPriceMinor: 1500000, itemDiscountMinor: 10000, subtotalMinor: 1490000, sortOrder: 0 },
      { id: 2, kind: "part", nameZh: "清洗剂", nameEn: "Cleaning agent", descriptionZh: null, descriptionEn: null, unitItemId: 2, quantity: "1.000", unitPriceMinor: 80000, itemDiscountMinor: 0, subtotalMinor: 80000, sortOrder: 1 },
    ],
    totals: { laborDiscountMinor: 20000, partDiscountMinor: 0, otherDiscountMinor: 0 },
  } as FormalChargeSnapshot;
  it("keeps description separate from name and labels every monetary value", () => {
    render(<BusinessChargeSection charges={charges} kind="labor" unitLabels={new Map([[1, "次 / Job"]])} language="zh" />);
    const row = screen.getByTestId("charge-item-1");
    expect(within(row).getByRole("heading").textContent).toBe("节气门清洗");
    expect(within(row).getByText("清洗后继续检查发动机")).toBeTruthy();
    expect(within(row).getByText("含税单价")).toBeTruthy();
    expect(within(row).getByText("本项折扣")).toBeTruthy();
    expect(within(row).getByText("小计")).toBeTruthy();
    expect(screen.queryByText("清洗剂")).toBeNull();
  });
  it("uses existing net category calculation including category discounts", () => {
    render(<BusinessChargeSection charges={charges} kind="labor" unitLabels={new Map()} language="zh" />);
    expect(screen.getByTestId("charge-category-total").textContent).toBe("JMD 14,700.00");
    expect(screen.getByTestId("charge-item-1").textContent).toContain("JMD 14,900.00");
  });
  it("shows whole quantities without database decimal padding in both languages", () => {
    const { rerender } = render(<BusinessChargeSection charges={charges} kind="labor" unitLabels={new Map()} language="zh" />);
    const quantity = within(screen.getByTestId("charge-item-1")).getByText("数量 / 单位").nextElementSibling;
    expect(quantity?.textContent).toBe("1JOB");
    rerender(<BusinessChargeSection charges={charges} kind="part" unitLabels={new Map([[2, "Piece"]])} language="en" />);
    expect(within(screen.getByTestId("charge-item-2")).getByText("Qty / unit").nextElementSibling?.textContent).toBe("1Piece");
  });
  it("does not silently round a fractional historical quantity", () => {
    const fractional = { ...charges, items: [{ ...charges.items[0], quantity: "1.500" }] };
    render(<BusinessChargeSection charges={fractional} kind="labor" unitLabels={new Map()} language="zh" />);
    expect(screen.getByText("数量 / 单位").nextElementSibling?.textContent).toContain("1.500");
  });
  it("renders English labels and does not render empty charge categories", () => {
    const { rerender } = render(<BusinessChargeSection charges={charges} kind="part" unitLabels={new Map()} language="en" />);
    expect(screen.getByRole("heading", { name: "Cleaning agent" })).toBeTruthy();
    expect(screen.getByText("Tax-inclusive price")).toBeTruthy();
    rerender(<BusinessChargeSection charges={charges} kind="other" unitLabels={new Map()} language="en" />);
    expect(screen.queryByTestId("charge-category-total")).toBeNull();
  });
});
