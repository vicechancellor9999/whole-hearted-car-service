import { expect, test } from "@playwright/test";
import {
  cancelFormalHandoffInSameMonth,
  formalOfficeArchiveUsesEnglishPrimary,
  formalDocumentKindLabel,
  formalBusinessOrderStatusLabel,
  formalRefundHasSignedAcknowledgement,
  formalRefundNeedsProof,
  formatFormalMoney,
} from "../../src/lib/api/formal-business-orders";

test("正式 Business Order 金额按 minor unit 显示", () => {
  expect(formatFormalMoney(123_456)).toBe("JMD 1,234.56");
  expect(formatFormalMoney(-500)).toBe("−JMD 5.00");
});

test("退款签收单只能在退款成立后作为可选证据回传", () => {
  expect(formalRefundHasSignedAcknowledgement({ evidence: [] })).toBe(false);
  expect(formalRefundHasSignedAcknowledgement({
    evidence: [{ kind: "customer_signature" }],
  })).toBe(true);
});

test("正式 Business Order 状态使用完整业务文字", () => {
  expect(formalBusinessOrderStatusLabel("waiting_assignment")).toBe("待派单");
  expect(formalBusinessOrderStatusLabel("formally_handed_off")).toBe("已交单");
});

test("只有未附退款凭证的非现金退款需要补传", () => {
  expect(formalRefundNeedsProof({ paymentMethodCode: "bank", evidence: [] })).toBe(true);
  expect(formalRefundNeedsProof({
    paymentMethodCode: "bank",
    evidence: [{ kind: "refund_proof" }],
  })).toBe(false);
  expect(formalRefundNeedsProof({ paymentMethodCode: "cash", evidence: [] })).toBe(false);
});

test("正式打印件使用明确的业务名称", () => {
  expect(formalDocumentKindLabel("customer_copy")).toBe("客户联");
  expect(formalDocumentKindLabel("office_archive")).toBe("办公室签字留底联");
  expect(formalDocumentKindLabel("mechanic_work")).toBe("维修工联");
});

test("新版办公室联采用英文主内容，旧快照继续采用原版", () => {
  expect(formalOfficeArchiveUsesEnglishPrimary({
    version: 1,
    kind: "office_archive",
    presentation: "office_english_primary_v1",
  })).toBe(true);
  expect(formalOfficeArchiveUsesEnglishPrimary({
    version: 1,
    kind: "office_archive",
  })).toBe(false);
});

test("同月取消正式交单使用专用 action、裁剪原因并透传最新轮次工作区", async () => {
  const originalFetch = globalThis.fetch;
  const workspace = {
    current: {
      id: 21,
      businessOrderId: 7,
      roundNo: 1,
      source: "initial",
      afterSalesIssue: null,
      status: "return_pending_review",
      assignedTeamId: 3,
      intakeMileageKm: 123_456,
      intakePhotoFileIds: [],
      latestWorkReturnId: 31,
      approvedWorkReturnId: 31,
      version: 5,
    },
    auditTrail: [],
    history: [],
    result: { formalHandoffId: 88, cancelled: true },
  };
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ input, init });
    return new Response(JSON.stringify(workspace), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await cancelFormalHandoffInSameMonth(7, {
      formalHandoffId: 88,
      reason: "  绩效值需重新核对  ",
    });

    expect(result).toEqual(workspace);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(String(request?.input)).toBe("/api/formal/business-orders/7/rounds");
    expect(request?.init?.method).toBe("POST");
    expect(request?.init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      action: "cancel_formal_handoff",
      formalHandoffId: 88,
      reason: "绩效值需重新核对",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
