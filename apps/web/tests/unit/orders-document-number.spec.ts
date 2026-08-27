import { expect, test } from "@playwright/test";
import {
  allocateDocumentNumber,
  businessDateInJamaica,
  formatBusinessOrderNo,
  formatInspectionReportNo,
  formatInvoiceNo,
  formatQuotationNo,
  jamaicaMonthKey,
  type AtomicDocumentSequenceAllocator,
} from "../../src/lib/orders/document-number";

test("格式化 Kingston 的业务单、检查报告、报价和 Invoice 独立编号", () => {
  const parts = {
    branchCode: "KGN",
    brandCode: "WH",
    businessDate: "20260809" as const,
    sequence: 19_422,
  };

  expect(formatBusinessOrderNo(parts)).toBe("KGN-WH-2026080919422");
  expect(formatInspectionReportNo(parts)).toBe("KGN-WH-IR-2026080919422");
  expect(formatQuotationNo(parts)).toBe("KGN-WH-QT-2026080919422");
  expect(formatInvoiceNo(parts)).toBe("KGN-WH-INV-2026080919422");
});

test("业务日固定按 America/Jamaica 计算 UTC 跨日边界", () => {
  expect(businessDateInJamaica("2026-08-09T04:59:59.999Z")).toBe("20260808");
  expect(businessDateInJamaica("2026-08-09T05:00:00.000Z")).toBe("20260809");
  expect(() => businessDateInJamaica("not-a-date")).toThrow(/时间/);
});

test("业务月份键 YYYYMM：同一个月内日期变化不改变月键（2026-08-18 跨月误判修复）", () => {
  // 之前误用 slice(0, 7)：8 月 19 号得到 "2026081"、8 月 20 号得到 "2026082"，
  // 同一个月被当成两个月 → 当月交单被误判为跨月。现在月键统一取前 6 位。
  expect(jamaicaMonthKey("2026-08-19T16:20:00-05:00")).toBe("202608");
  expect(jamaicaMonthKey("2026-08-20T00:10:00-05:00")).toBe("202608");
  expect(jamaicaMonthKey("2026-09-01T00:00:00-05:00")).toBe("202609");
});

test("拒绝非法代码、无效公历日期和非五位整数序号", () => {
  const valid = {
    branchCode: "KGN",
    brandCode: "WH",
    businessDate: "20260809" as const,
    sequence: 19_422,
  };

  for (const parts of [
    { ...valid, branchCode: "kgn" },
    { ...valid, branchCode: "KG-N" },
    { ...valid, brandCode: "W" },
  ]) {
    expect(() => formatBusinessOrderNo(parts)).toThrow(/代码/);
  }

  for (const businessDate of ["20260229", "20261301", "2026089", "abcdefgh"]) {
    expect(() => formatInspectionReportNo({ ...valid, businessDate: businessDate as never }))
      .toThrow(/日期/);
  }

  for (const sequence of [9_999, 100_000, 19_422.5, Number.NaN]) {
    expect(() => formatBusinessOrderNo({ ...valid, sequence })).toThrow(/五位/);
  }
});

test("编号只消费服务端原子分配结果，不读取已有单据做 max-scan", async () => {
  const requests: unknown[] = [];
  const allocator: AtomicDocumentSequenceAllocator = {
    async allocateNext(request) {
      requests.push(request);
      return { sequence: 19_422, allocationId: "allocation-1" };
    },
  };

  await expect(allocateDocumentNumber({
    kind: "business_order",
    branchCode: "KGN",
    brandCode: "WH",
    occurredAt: "2026-08-09T04:59:59.999Z",
  }, allocator)).resolves.toBe("KGN-WH-2026080819422");

  await expect(allocateDocumentNumber({
    kind: "inspection_report",
    branchCode: "KGN",
    brandCode: "WH",
    occurredAt: "2026-08-09T05:00:00.000Z",
  }, allocator)).resolves.toBe("KGN-WH-IR-2026080919422");

  await expect(allocateDocumentNumber({
    kind: "quotation",
    branchCode: "KGN",
    brandCode: "WH",
    occurredAt: "2026-08-09T05:00:00.000Z",
  }, allocator)).resolves.toBe("KGN-WH-QT-2026080919422");

  await expect(allocateDocumentNumber({
    kind: "invoice",
    branchCode: "KGN",
    brandCode: "WH",
    occurredAt: "2026-08-09T05:00:00.000Z",
  }, allocator)).resolves.toBe("KGN-WH-INV-2026080919422");

  expect(requests).toEqual([
    { kind: "business_order", branchCode: "KGN", brandCode: "WH", businessDate: "20260808" },
    { kind: "inspection_report", branchCode: "KGN", brandCode: "WH", businessDate: "20260809" },
    { kind: "quotation", branchCode: "KGN", brandCode: "WH", businessDate: "20260809" },
    { kind: "invoice", branchCode: "KGN", brandCode: "WH", businessDate: "20260809" },
  ]);
});

test("原子分配器返回越界序号时拒绝生成编号", async () => {
  const allocator: AtomicDocumentSequenceAllocator = {
    async allocateNext() {
      return { sequence: 100_000, allocationId: "allocation-invalid" };
    },
  };

  await expect(allocateDocumentNumber({
    kind: "business_order",
    branchCode: "KGN",
    brandCode: "WH",
    occurredAt: "2026-08-09T12:00:00Z",
  }, allocator)).rejects.toThrow(/五位/);
});
