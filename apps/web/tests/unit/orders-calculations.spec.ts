import { expect, test } from "@playwright/test";
import {
  deriveOrderFinancials,
  deriveOrderLifecycle,
  deriveProcessingStatus,
  toOrderListItem,
} from "../../src/lib/orders/calculations";
import type { OrderRecord } from "../../src/lib/orders/types";

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    orderNo: "WO-2026-0001",
    createdAt: "2026-08-08T08:00:00-05:00",
    updatedAt: "2026-08-08T12:00:00-05:00",
    updatedBy: "王建华",
    customer: {
      id: "customer-1",
      nameZh: "陈美玲",
      nameEn: "Meiling Chen",
      phone: "+1 876-555-0101",
    },
    vehicle: {
      id: "vehicle-1",
      plate: "1234 AB",
      modelZh: "丰田海狮",
      modelEn: "Toyota Hiace",
    },
    laborItems: [{ id: "labor-1", name: "发动机检修", amountJmd: 10_000 }],
    partItems: [{ id: "part-1", name: "机油滤芯", amountJmd: 5_000 }],
    parkingFeeJmd: 500,
    payments: [{ id: "payment-1", amountJmd: 8_000 }],
    refunds: [{ id: "refund-1", amountJmd: 500 }],
    mechanics: [],
    ...overrides,
  };
}

for (const { label, input, expected } of [
  { label: "未派组时为待派单", input: {}, expected: "awaiting_dispatch" },
  { label: "已派组未接单时为待接单", input: { teamId: "t1" }, expected: "awaiting_acceptance" },
  {
    label: "接单后为正在办理",
    input: { teamId: "t1", acceptedAt: "2026-08-08T09:00:00-05:00" },
    expected: "in_progress",
  },
  {
    label: "维修回单后为回单待前台",
    input: {
      teamId: "t1",
      acceptedAt: "2026-08-08T09:00:00-05:00",
      returnedAt: "2026-08-08T10:00:00-05:00",
    },
    expected: "returned_awaiting_frontdesk",
  },
  {
    label: "正式交单后为已交单未取车",
    input: {
      teamId: "t1",
      acceptedAt: "2026-08-08T09:00:00-05:00",
      returnedAt: "2026-08-08T10:00:00-05:00",
      submittedAt: "2026-08-08T11:00:00-05:00",
    },
    expected: "submitted_awaiting_collection",
  },
  {
    label: "取车事实不替代正式交单后的 BO 状态",
    input: {
      teamId: "t1",
      acceptedAt: "2026-08-08T09:00:00-05:00",
      returnedAt: "2026-08-08T10:00:00-05:00",
      submittedAt: "2026-08-08T11:00:00-05:00",
      pickedUpAt: "2026-08-08T12:00:00-05:00",
    },
    expected: "submitted_awaiting_collection",
  },
] as const) {
  test(label, () => {
    expect(deriveProcessingStatus(order(input))).toBe(expected);
  });
}

test("应收由工时、配件与停车费组成，净收款扣除退款并保留欠款余额", () => {
  expect(deriveOrderFinancials(order())).toEqual({
    receivableJmd: 15_500,
    netPaidJmd: 7_500,
    balanceJmd: 8_000,
    settlementStatus: "due",
  });
});

test("结算以 0.005 为闭区间容差，区间外分别为欠款和溢收", () => {
  const atPositiveTolerance = order({
    laborItems: [{ id: "labor", name: "检测", amountJmd: 100 }],
    partItems: [],
    parkingFeeJmd: 0,
    payments: [{ id: "payment", amountJmd: 99.995 }],
    refunds: [],
  });
  const due = order({ ...atPositiveTolerance, payments: [{ id: "payment", amountJmd: 99.994 }] });
  const overpaid = order({ ...atPositiveTolerance, payments: [{ id: "payment", amountJmd: 100.006 }] });

  expect(deriveOrderFinancials(atPositiveTolerance).settlementStatus).toBe("settled");
  expect(deriveOrderFinancials(due).settlementStatus).toBe("due");
  expect(deriveOrderFinancials(overpaid).settlementStatus).toBe("overpaid");
});

test("BO completed 只由正式交单事实决定，取车与结算保持独立", () => {
  const settled = {
    laborItems: [{ id: "labor", name: "检测", amountJmd: 100 }],
    partItems: [],
    parkingFeeJmd: 0,
    payments: [{ id: "payment", amountJmd: 100 }],
    refunds: [],
  };
  expect(deriveOrderLifecycle(order(settled))).toBe("open");
  expect(deriveOrderLifecycle(order({ ...settled, pickedUpAt: "2026-08-08T12:00:00-05:00" })))
    .toBe("open");
  expect(deriveOrderLifecycle(order({
    ...settled,
    payments: [{ id: "payment", amountJmd: 90 }],
    submittedAt: "2026-08-08T11:00:00-05:00",
  }))).toBe("completed");
});

test("列表 DTO 提供客户车辆、项目、办理人和财务展示字段", () => {
  const item = toOrderListItem(order({
    teamId: "t1",
    acceptedAt: "2026-08-08T09:00:00-05:00",
    mechanics: [
      { id: "mechanic-1", name: "Marcus Brown" },
      { id: "mechanic-2", name: "David Williams" },
    ],
  }));

  expect(item).toEqual({
    id: "order-1",
    orderNo: "WO-2026-0001",
    customer: {
      nameZh: "陈美玲",
      nameEn: "Meiling Chen",
      phone: "+1 876-555-0101",
    },
    vehicle: { plate: "1234 AB", modelZh: "丰田海狮", modelEn: "Toyota Hiace" },
    projectNames: ["发动机检修", "机油滤芯"],
    laborItemCount: 1,
    partItemCount: 1,
    processingStatus: "in_progress",
    lifecycle: "open",
    teamId: "t1",
    teamName: "车间一组",
    mechanicNames: ["Marcus Brown", "David Williams"],
    receivableJmd: 15_500,
    netPaidJmd: 7_500,
    balanceJmd: 8_000,
    settlementStatus: "due",
    createdAt: "2026-08-08T08:00:00-05:00",
    updatedAt: "2026-08-08T12:00:00-05:00",
    updatedBy: "王建华",
    contactPhone: "+1 876-555-0101",
  });
});

test("列表 DTO 原样保留业务单关联的检查报告编号、报价版本和署名班组", () => {
  const sourceInspection = {
    reportNo: "KGN-WH-IR-2026080919422",
    version: "V2" as const,
    inspectorTeamId: "t1" as const,
  };
  const item = toOrderListItem(order({ sourceInspection }));

  expect(item.sourceInspection).toEqual({
    reportNo: "KGN-WH-IR-2026080919422",
    version: "V2",
    inspectorTeamId: "t1",
  });
});
