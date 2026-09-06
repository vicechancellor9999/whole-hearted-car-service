import { expect, test } from "@playwright/test";
import {
  businessOrderAuditChanges,
  businessOrderAuditReason,
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
  test("renders structured deletion reason codes as readable business text", () => {
    expect(businessOrderAuditReason("test_data", "zh")).toBe("测试数据");
    expect(businessOrderAuditReason("input_error: 车牌写错", "zh")).toBe("录入错误：车牌写错");
    expect(businessOrderAuditReason("duplicate", "en")).toBe("Duplicate record");
    expect(businessOrderAuditReason("客户临时取消", "zh")).toBe("客户临时取消");
  });

  test("renders system-owned audit copy in English without leaking Chinese labels", () => {
    expect(businessOrderAuditSummary("business_order.payment_recorded", {
      amountMinor: 2470000,
      paymentMethodCode: "cash",
      receiptNo: "RCT-20260826-0001",
      balanceAfterMinor: 0,
    }, masterData, "en")).toBe("Recorded payment JMD 24,700.00 (Cash); generated Receipt RCT-20260826-0001; outstanding balance is now JMD 0.00");

    expect(businessOrderAuditSummary("business_order.round_assigned", {
      teamId: 1,
      roundNo: 2,
    }, masterData, "en")).toBe("Repair round 2 assigned to 车间一组");

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
      teamId: 1,
      roundNo: 2,
    }, masterData)).toBe("第 2 轮维修派给车间一组");
    expect(businessOrderAuditSummary("business_order.round_assigned", {
      roundNo: 3,
    }, masterData)).toBe("第 3 轮维修已派单，未登记维修班组");
    expect(businessOrderAuditSummary("business_order.round_assigned", {
      roundNo: 3,
    }, masterData, "en")).toBe("Repair round 3 was assigned; repair team was not recorded");
    expect(businessOrderAuditSummary("business_order.document_revision_created", {
      documentNo: "CUS-20260828-0001",
      revisionNo: 3,
    }, masterData)).toBe("保存打印单据修订 CUS-20260828-0001 R3");
  });

  test("describes a repair-round performance draft without exposing the internal event name", () => {
    expect(businessOrderAuditSummary("business_order.performance_draft_set", {
      repairRoundNo: 2,
      performanceDraftMinor: 154000,
    }, masterData)).toBe("设置第 2 轮维修绩效草稿");

    expect(businessOrderAuditSummary("business_order.performance_draft_set", {
      repairRoundNo: 2,
      performanceDraftMinor: 154000,
    }, masterData, "en")).toBe("Set performance draft for repair round 2");
  });

  test("states which repair round had its handed-off performance adjusted", () => {
    const before = {
      formalHandoffId: 3,
      repairRoundId: 8,
      repairRoundNo: 2,
      performanceMinor: 5_440_000,
    };
    const after = {
      repairRoundId: 8,
      repairRoundNo: 2,
      performanceMinor: 1_990_000,
    };

    expect(businessOrderAuditSummary(
      "business_order.performance_adjusted",
      after,
      masterData,
    )).toBe("调整第 2 轮维修绩效");
    expect(businessOrderAuditSummary(
      "business_order.performance_adjusted",
      after,
      masterData,
      "en",
    )).toBe("Adjusted performance for repair round 2");
    expect(businessOrderAuditChanges(before, after, masterData)).toEqual([
      {
        key: "performanceMinor",
        label: "绩效值",
        before: "JMD 54,400.00",
        after: "JMD 19,900.00",
        hasBefore: true,
        hasAfter: true,
      },
    ]);
  });

  test("states which invalid repair round was deleted and which round was restored", () => {
    const after = { cancelledRoundNo: 2, previousRoundNo: 1 };
    expect(businessOrderAuditSummary(
      "business_order.invalid_after_sales_round_deleted",
      after,
      masterData,
    )).toBe("删除第 2 轮维修，恢复到第 1 轮");
    expect(businessOrderAuditSummary(
      "business_order.invalid_after_sales_round_deleted",
      after,
      masterData,
      "en",
    )).toBe("Deleted repair round 2 and restored repair round 1");
  });

  test("renders inspection-report events as clear actions", () => {
    expect(businessOrderAuditSummary("inspection_report.created", {
      reportNo: "IR-20260829-0001",
    }, masterData)).toBe("创建检查报告 IR-20260829-0001");
    expect(businessOrderAuditSummary("inspection_report.submitted", {
      reportNo: "IR-20260829-0001",
    }, masterData, "en")).toBe("Submitted inspection report IR-20260829-0001");
    expect(businessOrderAuditSummary("inspection_report.workspace_version_appended", {
      versionNo: 2,
    }, masterData)).toBe("保存检查报告第 2 版");
  });

  test("renders the backend's paper acceptance and return events as explicit actions", () => {
    expect(businessOrderAuditSummary("business_order.round_paper_acceptance_recorded", {
      roundNo: 2,
      teamId: 1,
      actualStaffMemberId: 9,
    }, masterData)).toBe("前台登记第 2 轮维修纸质接单");
    expect(businessOrderAuditSummary("business_order.round_paper_acceptance_recorded", {
      roundNo: 2,
      teamId: 1,
      actualStaffMemberId: 9,
    }, masterData, "en")).toBe("Front desk recorded paper acceptance for repair round 2");

    expect(businessOrderAuditSummary("business_order.paper_work_return_recorded_and_approved", {
      roundNo: 2,
      workReturnId: 18,
      submissionNo: 1,
      submissionSource: "paper",
      actualStaffMemberId: 9,
      attachmentIds: [3],
    }, masterData)).toBe("前台登记并审核通过第 2 轮维修纸质回单");
    expect(businessOrderAuditSummary("business_order.paper_work_return_recorded_and_approved", {
      roundNo: 2,
      workReturnId: 18,
      submissionNo: 1,
      submissionSource: "paper",
      actualStaffMemberId: 9,
      attachmentIds: [3],
    }, masterData, "en")).toBe("Front desk recorded and approved a paper work return for repair round 2");
  });

  test("renders assignment withdrawal and intake-photo events without leaking event keys", () => {
    expect(businessOrderAuditSummary("business_order.round_assignment_withdrawn", {
      roundNo: 2,
      previousTeamId: 1,
      previousStatus: "assigned",
    }, masterData)).toBe("撤回第 2 轮维修班组派单");
    expect(businessOrderAuditSummary("business_order.round_assignment_withdrawn", {
      roundNo: 2,
      previousTeamId: 1,
      previousStatus: "assigned",
    }, masterData, "en")).toBe("Withdrew the repair-team assignment for repair round 2");

    expect(businessOrderAuditSummary("business_order.intake_photo_linked", {
      roundNo: 2,
      fileId: 31,
    }, masterData)).toBe("归档第 2 轮维修接车里程照片");
    expect(businessOrderAuditSummary("business_order.intake_photo_linked", {
      roundNo: 2,
      fileId: 31,
    }, masterData, "en")).toBe("Archived an intake-mileage photo for repair round 2");
  });

  test("renders both problem-description audit events in clear Chinese and English", () => {
    const orderProblem = {
      scope: "business_order",
      versionNo: 2,
      sourceType: "manual",
      sourceReferenceId: null,
      hasZh: true,
      hasEn: false,
    };
    expect(businessOrderAuditSummary(
      "business_order.problem_description_appended",
      orderProblem,
      masterData,
    )).toBe("更新整张 Business Order 问题描述（V2）");
    expect(businessOrderAuditSummary(
      "business_order.problem_description_appended",
      orderProblem,
      masterData,
      "en",
    )).toBe("Updated the overall Business Order problem description (V2)");

    const roundProblem = {
      ...orderProblem,
      scope: "repair_round",
      businessOrderId: 1,
      repairRoundId: 4,
      versionNo: 3,
    };
    expect(businessOrderAuditSummary(
      "repair_round.problem_description_appended",
      roundProblem,
      masterData,
    )).toBe("更新维修轮次问题描述（V3）");
    expect(businessOrderAuditSummary(
      "repair_round.problem_description_appended",
      roundProblem,
      masterData,
      "en",
    )).toBe("Updated a repair-round problem description (V3)");
  });

  test("turns an unknown future event into a readable event name without inventing an action", () => {
    expect(businessOrderAuditSummary("business_order.future_event", {}, masterData))
      .toBe("其他业务记录");
    expect(businessOrderAuditSummary("business_order.future_event", {}, masterData, "en"))
      .toBe("Other business record");
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

  test("presents a performance draft's before and after JMD values with its repair round", () => {
    const before = { performanceDraftMinor: 125000 };
    const after = { repairRoundNo: 2, performanceDraftMinor: 154000 };

    expect(businessOrderAuditChanges(before, after, masterData)).toEqual([
      { key: "performanceDraftMinor", label: "绩效草稿值", before: "JMD 1,250.00", after: "JMD 1,540.00", hasBefore: true, hasAfter: true },
      { key: "repairRoundNo", label: "维修轮次", before: "空", after: "第 2 轮", hasBefore: false, hasAfter: true },
    ]);
    expect(businessOrderAuditChanges(before, after, masterData, "en")).toEqual([
      { key: "performanceDraftMinor", label: "Performance draft value", before: "JMD 1,250.00", after: "JMD 1,540.00", hasBefore: true, hasAfter: true },
      { key: "repairRoundNo", label: "Repair round", before: "Empty", after: "Repair round 2", hasBefore: false, hasAfter: true },
    ]);
  });
});
