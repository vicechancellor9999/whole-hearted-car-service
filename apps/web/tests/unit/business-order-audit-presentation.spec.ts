import { expect, test } from "@playwright/test";
import {
  businessOrderAuditChanges,
  businessOrderAuditSummary,
} from "../../src/lib/orders/business-order-audit-presentation";
import type { FormalMasterData } from "../../src/lib/api/formal-master-data";

const masterData: FormalMasterData = {
  dictionaries: [],
  teams: [{ id: 1, teamNo: "TEAM-202608-0001", name: "车间一组", isActive: true, version: 1 }],
  staff: [],
  payrollParameters: [],
  teamCommissionRates: [],
};

test.describe("businessOrderAuditSummary", () => {
  test("renders system-owned audit copy in English without leaking Chinese labels", () => {
    expect(businessOrderAuditSummary("business_order.payment_recorded", {
      amountMinor: 2470000,
      paymentMethodCode: "cash",
      receiptNo: "RCT-20260826-0001",
      balanceAfterMinor: 0,
    }, masterData, "en")).toBe("Recorded payment JMD 24,700.00 (Cash); generated Receipt RCT-20260826-0001; outstanding balance is now JMD 0.00");

    expect(businessOrderAuditSummary("business_order.round_assigned", {
      assignedTeamId: 1,
      roundNo: 2,
    }, masterData, "en")).toBe("Repair round 2 assigned to Team 1 · Translation required");

    expect(businessOrderAuditChanges(null, {
      category: "customer_signature",
      mediaType: "image/png",
      sizeBytes: 630724,
    }, masterData, "en")).toEqual([
      { key: "category", label: "Attachment category", before: "Empty", after: "Customer signature", hasBefore: false, hasAfter: true },
      { key: "mediaType", label: "File type", before: "Empty", after: "PNG", hasBefore: false, hasAfter: true },
      { key: "sizeBytes", label: "File size", before: "Empty", after: "616 KB", hasBefore: false, hasAfter: true },
    ]);
  });

  test("describes a customer-signature upload with its actual file type and size", () => {
    expect(businessOrderAuditSummary("business_order.attachment_uploaded", {
      attachmentId: 2,
      fileId: 6,
      category: "customer_signature",
      mediaType: "image/png",
      sizeBytes: 630724,
    }, masterData)).toBe("上传客户签字附件（PNG，616 KB）");
  });

  test("describes the other collaboration events currently emitted by the backend", () => {
    expect(businessOrderAuditSummary("business_order.attachment_linked_to_message", {
      messageId: 41,
      attachmentIds: [1, 2],
    }, masterData)).toBe("将 2 份附件加入业务单留言");
    expect(businessOrderAuditSummary("business_order.message_created", {
      messageId: 41,
      mentionedAccountIds: [2, 3],
    }, masterData)).toBe("发布业务单留言，并 @ 2 人");
    expect(businessOrderAuditSummary("business_order.message_edited", {
      messageId: 41,
      mentionedAccountIds: [],
    }, masterData)).toBe("编辑业务单留言");
  });

  test("preserves specific payment, refund and assignment facts", () => {
    expect(businessOrderAuditSummary("business_order.payment_recorded", {
      amountMinor: 2470000,
      paymentMethodCode: "cash",
      receiptNo: "RCT-20260826-0001",
      balanceAfterMinor: 0,
    }, masterData)).toBe("登记收款 JMD 24,700.00（现金）；生成 Receipt RCT-20260826-0001；未结余额变为 JMD 0.00");
    expect(businessOrderAuditSummary("business_order.round_assigned", {
      assignedTeamId: 1,
      roundNo: 2,
    }, masterData)).toBe("第 2 轮维修派给车间一组");
    expect(businessOrderAuditSummary("business_order.document_revision_created", {
      documentNo: "CUS-20260828-0001",
      revisionNo: 3,
    }, masterData)).toBe("保存打印单据修订 CUS-20260828-0001 R3");
  });

  test("turns an unknown future event into a readable event name without inventing an action", () => {
    expect(businessOrderAuditSummary("business_order.future_event", {}, masterData))
      .toBe("记录业务事件：future event");
  });
});

test.describe("businessOrderAuditChanges", () => {
  test("keeps useful changes and does not expose internal attachment IDs", () => {
    expect(businessOrderAuditChanges(null, {
      attachmentId: 2,
      fileId: 6,
      category: "customer_signature",
      mediaType: "image/png",
      sizeBytes: 630724,
    }, masterData)).toEqual([
      { key: "category", label: "附件类别", before: "空", after: "客户签字", hasBefore: false, hasAfter: true },
      { key: "mediaType", label: "文件类型", before: "空", after: "PNG", hasBefore: false, hasAfter: true },
      { key: "sizeBytes", label: "文件大小", before: "空", after: "616 KB", hasBefore: false, hasAfter: true },
    ]);
  });
});
