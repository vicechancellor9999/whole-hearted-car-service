import { describe, expect, it, vi } from "vitest";
import { createBusinessOrderRoundsApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/rounds/route";

describe("/api/business-orders/:id/rounds", () => {
  it.each([undefined, null, 0, -1, 1.5, "21", true])("rejects an invalid or missing performance target %s before invoking the writer", async (repairRoundId) => {
    const writer = vi.fn();
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(), listRepairRounds: vi.fn(),
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(),
      recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(), recordIntakeMileage: vi.fn(),
      submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(), returnWorkReturn: vi.fn(),
      formallyHandOffRound: vi.fn(), cancelFormalHandoffInSameMonth: vi.fn(), setPerformanceDraft: writer,
    });
    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set_performance_draft", repairRoundId, repairRoundVersion: 1, performanceValue: "1250" }),
    }), { businessOrderId: 7 });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("刷新后重新核对") });
    expect(writer).not.toHaveBeenCalled();
  });
  it("returns current round and immutable round history", async () => {
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1 })),
      listRepairRounds: vi.fn(async () => [{ id: 3, roundNo: 1 }]),
      listAuditTrail: vi.fn(async () => [{ id: 88, eventType: "business_order.charge_version_replaced" }]),
      getAfterSalesRoundDeletionPreview: vi.fn(async () => ({ eligible: false, blockers: [] })),
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(), startAfterSalesRound: vi.fn(), recordIntakeMileage: vi.fn(),
      recordAcceptanceOnBehalf: vi.fn(),
      submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(), returnWorkReturn: vi.fn(),
      formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth: vi.fn(),
    });
    const response = await handler(new Request("http://local/api/business-orders/7/rounds"), { businessOrderId: 7 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      current: { id: 3, roundNo: 1 },
      history: [{ id: 3, roundNo: 1 }],
      auditTrail: [{ id: 88, eventType: "business_order.charge_version_replaced" }],
      afterSalesRoundDeletion: { eligible: false, blockers: [] },
    });
  });

  it("assigns only the selected active team with the explicit customer-confirmation fact", async () => {
    const assignRound = vi.fn(async () => ({ assigned: true }));
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1 })),
      listRepairRounds: vi.fn(async () => []), assignRound,
      withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(),
      recordAcceptanceOnBehalf: vi.fn(),
      startAfterSalesRound: vi.fn(), recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(),
      approveWorkReturn: vi.fn(), returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth: vi.fn(),
    });
    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "assign", businessOrderVersion: 4, teamId: 2, customerConfirmed: true }),
    }), { businessOrderId: 7 });
    expect(response.status).toBe(200);
    expect(assignRound).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 7, expectedBusinessOrderVersion: 4, teamId: 2,
      customerConfirmedWithoutPayment: true,
    }));
  });

  it("withdraws the current assignment before formal handoff", async () => {
    const withdrawAssignment = vi.fn(async () => ({ withdrawn: true }));
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1, status: "waiting_assignment" })),
      listRepairRounds: vi.fn(async () => []), assignRound: vi.fn(), withdrawAssignment, cancelAfterSalesRound: vi.fn(),
      recordAcceptanceOnBehalf: vi.fn(),
      startAfterSalesRound: vi.fn(), recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(),
      approveWorkReturn: vi.fn(), returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth: vi.fn(),
    });
    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "withdraw_assignment", repairRoundVersion: 6 }),
    }), { businessOrderId: 7 });
    expect(response.status).toBe(200);
    expect(withdrawAssignment).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 7, expectedRepairRoundVersion: 6,
    }));
  });

  it("records a paper acceptance for the selected mechanic", async () => {
    const recordAcceptanceOnBehalf = vi.fn(async () => undefined);
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1, status: "in_repair" })),
      listRepairRounds: vi.fn(async () => []),
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(), recordAcceptanceOnBehalf,
      startAfterSalesRound: vi.fn(), recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(),
      approveWorkReturn: vi.fn(), returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth: vi.fn(),
    });
    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "record_paper_acceptance", repairRoundVersion: 6, actualStaffMemberId: 12 }),
    }), { businessOrderId: 7 });
    expect(response.status).toBe(200);
    expect(recordAcceptanceOnBehalf).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 7, expectedRepairRoundVersion: 6, actualStaffMemberId: 12,
    }));
  });

  it("submits a work return without forcing optional mechanic or summary fields", async () => {
    const submitWorkReturn = vi.fn(async () => ({ id: 18, submissionNo: 1 }));
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1, status: "return_pending_review" })),
      listRepairRounds: vi.fn(async () => []),
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(), recordAcceptanceOnBehalf: vi.fn(),
      startAfterSalesRound: vi.fn(), recordIntakeMileage: vi.fn(), submitWorkReturn,
      approveWorkReturn: vi.fn(), returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth: vi.fn(),
    });
    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "submit_return", repairRoundVersion: 6 }),
    }), { businessOrderId: 7 });
    expect(response.status).toBe(200);
    expect(submitWorkReturn).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 7,
      expectedRepairRoundVersion: 6,
      workSummary: undefined,
      actualStaffMemberId: undefined,
    }));
  });

  it("records and approves one paper return through the explicit paper action", async () => {
    const recordPaperWorkReturn = vi.fn(async () => ({ id: 21, submissionNo: 1 }));
    const dependencies = {
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1, status: "return_pending_review" })),
      listRepairRounds: vi.fn(async () => []),
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(),
      recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(),
      recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(),
      returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth: vi.fn(), recordPaperWorkReturn,
    };
    const handler = createBusinessOrderRoundsApiHandler(dependencies);
    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "record_paper_return",
        repairRoundVersion: 6,
        actualStaffMemberId: 12,
        attachmentIds: [31],
        workSummary: "纸质回单已核对",
      }),
    }), { businessOrderId: 7 });

    expect(response.status).toBe(200);
    expect(recordPaperWorkReturn).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 7,
      expectedRepairRoundVersion: 6,
      actualStaffMemberId: 12,
      attachmentIds: [31],
      workSummary: "纸质回单已核对",
    }));
  });

  it("approves a return and formally hands off through one API action", async () => {
    const approveAndFormallyHandOff = vi.fn(async () => ({ id: 41 }));
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, status: "formally_handed_off" })),
      listRepairRounds: vi.fn(async () => []), assignRound: vi.fn(), withdrawAssignment: vi.fn(),
      cancelAfterSalesRound: vi.fn(), recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(),
      recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(),
      returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(), cancelFormalHandoffInSameMonth: vi.fn(),
      approveAndFormallyHandOff,
    });
    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve_and_formal_handoff",
        repairRoundVersion: 6,
        workReturnId: 21,
        performanceValue: "19900",
      }),
    }), { businessOrderId: 7 });

    expect(response.status).toBe(200);
    expect(approveAndFormallyHandOff).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 7,
      expectedRepairRoundVersion: 6,
      workReturnId: 21,
      performanceValue: "19900",
    }));
  });

  it("records a paper return and formally hands off through one API action", async () => {
    const recordPaperWorkReturnAndFormallyHandOff = vi.fn(async () => ({ id: 42 }));
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, status: "formally_handed_off" })),
      listRepairRounds: vi.fn(async () => []), assignRound: vi.fn(), withdrawAssignment: vi.fn(),
      cancelAfterSalesRound: vi.fn(), recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(),
      recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(),
      returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(), cancelFormalHandoffInSameMonth: vi.fn(),
      recordPaperWorkReturnAndFormallyHandOff,
    });
    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "record_paper_return_and_formal_handoff",
        repairRoundVersion: 6,
        actualStaffMemberId: 12,
        attachmentIds: [31],
        performanceValue: "19900",
      }),
    }), { businessOrderId: 7 });

    expect(response.status).toBe(200);
    expect(recordPaperWorkReturnAndFormallyHandOff).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 7,
      expectedRepairRoundVersion: 6,
      actualStaffMemberId: 12,
      attachmentIds: [31],
      performanceValue: "19900",
    }));
  });

  it("accepts a front-desk paper return when mechanic and source file are not yet recorded", async () => {
    const recordPaperWorkReturnAndFormallyHandOff = vi.fn(async () => ({ id: 43 }));
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, status: "formally_handed_off" })),
      listRepairRounds: vi.fn(async () => []), assignRound: vi.fn(), withdrawAssignment: vi.fn(),
      cancelAfterSalesRound: vi.fn(), recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(),
      recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(),
      returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(), cancelFormalHandoffInSameMonth: vi.fn(),
      recordPaperWorkReturnAndFormallyHandOff,
    });
    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "record_paper_return_and_formal_handoff",
        repairRoundVersion: 6,
        attachmentIds: [],
        performanceValue: "19900",
      }),
    }), { businessOrderId: 7 });

    expect(response.status).toBe(200);
    expect(recordPaperWorkReturnAndFormallyHandOff).toHaveBeenCalledWith(expect.objectContaining({
      actualStaffMemberId: undefined,
      attachmentIds: [],
    }));
  });

  it("cancels an empty after-sales round created by mistake", async () => {
    const cancelAfterSalesRound = vi.fn(async () => ({ cancelled: true }));
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 2, roundNo: 1, status: "formally_handed_off" })),
      listRepairRounds: vi.fn(async () => [{ id: 2, roundNo: 1 }]),
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound,
      recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(),
      recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(),
      returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth: vi.fn(),
    });
    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel_after_sales", repairRoundVersion: 1 }),
    }), { businessOrderId: 7 });
    expect(response.status).toBe(200);
    expect(cancelAfterSalesRound).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 7,
      expectedRepairRoundVersion: 1,
    }));
  });

  it("forwards the confirmed invalid-round deletion payload and returns a refreshed preview", async () => {
    const deleteInvalidAfterSalesRound = vi.fn(async () => ({
      cancelled: true,
      deletedRoundNo: 2,
      restoredRoundNo: 1,
    }));
    const getAfterSalesRoundDeletionPreview = vi.fn(async () => null);
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 2, roundNo: 1, status: "formally_handed_off" })),
      listRepairRounds: vi.fn(async () => [{ id: 2, roundNo: 1 }]),
      getAfterSalesRoundDeletionPreview,
      deleteInvalidAfterSalesRound,
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(),
      recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(),
      recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(),
      returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth: vi.fn(),
    });
    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "delete-invalid-round-request",
      },
      body: JSON.stringify({
        action: "delete_invalid_after_sales",
        repairRoundVersion: 8,
        previewFingerprint: "a".repeat(64),
        reasonCode: "test_data",
        reasonNote: "整轮测试数据",
        confirmationRecordNo: "KGN-WH-2026082500001/R2",
      }),
    }), { businessOrderId: 7 });

    expect(response.status).toBe(200);
    expect(deleteInvalidAfterSalesRound).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 7,
      expectedRepairRoundVersion: 8,
      previewFingerprint: "a".repeat(64),
      reasonCode: "test_data",
      reasonNote: "整轮测试数据",
      confirmationRecordNo: "KGN-WH-2026082500001/R2",
      context: expect.objectContaining({ requestId: "delete-invalid-round-request" }),
    }));
    expect(await response.json()).toMatchObject({
      result: { cancelled: true, deletedRoundNo: 2, restoredRoundNo: 1 },
      afterSalesRoundDeletion: null,
    });
  });

  it("cancels a formal handoff for the Business Order in the URL", async () => {
    const cancelFormalHandoffInSameMonth = vi.fn(async () => ({ id: 31 }));
    const dependencies = {
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1, status: "return_pending_review" })),
      listRepairRounds: vi.fn(async () => []),
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(),
      recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(),
      recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(),
      returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth,
    };
    const handler = createBusinessOrderRoundsApiHandler(dependencies);

    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "cancel-formal-handoff-request",
        "x-forwarded-for": "203.0.113.7",
        "user-agent": "Vitest",
      },
      body: JSON.stringify({
        action: "cancel_formal_handoff",
        formalHandoffId: 42,
        reason: "客户要求重新确认",
      }),
    }), { businessOrderId: 7 });

    expect(response.status).toBe(200);
    expect(cancelFormalHandoffInSameMonth).toHaveBeenCalledWith({
      businessOrderId: 7,
      formalHandoffId: 42,
      reason: "客户要求重新确认",
      context: {
        actorAccountId: 9,
        requestId: "cancel-formal-handoff-request",
        ipAddress: "203.0.113.7",
        userAgent: "Vitest",
      },
    });
  });

  it("rejects malformed formal handoff cancellation input before invoking the dependency", async () => {
    const cancelFormalHandoffInSameMonth = vi.fn(async () => ({ id: 31 }));
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1 })),
      listRepairRounds: vi.fn(async () => []),
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(),
      recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(),
      recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(),
      returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth,
    });

    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel_formal_handoff", formalHandoffId: 0, reason: "   " }),
    }), { businessOrderId: 7 });

    expect(response.status).toBe(400);
    expect(cancelFormalHandoffInSameMonth).not.toHaveBeenCalled();
  });

  it("forwards a signed JMD performance draft to the current-round service action", async () => {
    const setPerformanceDraft = vi.fn(async () => ({
      id: 3,
      performanceDraftMinor: -1_234,
      version: 7,
    }));
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1, performanceDraftMinor: -1_234 })),
      listRepairRounds: vi.fn(async () => []),
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(),
      recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(),
      recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(),
      returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth: vi.fn(),
      setPerformanceDraft,
    });

    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "set_performance_draft",
        repairRoundId: 21,
        repairRoundVersion: 6,
        performanceValue: "-12.34",
      }),
    }), { businessOrderId: 7 });

    expect(response.status).toBe(200);
    expect(setPerformanceDraft).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 7,
      expectedRepairRoundVersion: 6,
      expectedRepairRoundId: 21,
      performanceValue: "-12.34",
      context: expect.objectContaining({ actorAccountId: 9 }),
    }));
    expect(await response.json()).toMatchObject({
      result: { performanceDraftMinor: -1_234 },
    });
  });

  it("adjusts an active formal handoff performance with the handoff id, round version, and reason", async () => {
    const adjustFormalHandoffPerformanceInSameMonth = vi.fn(async () => ({
      id: 44,
      performanceMinor: 1_800_000,
    }));
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1, status: "formally_handed_off" })),
      listRepairRounds: vi.fn(async () => []),
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(),
      recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(),
      recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(),
      returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth: vi.fn(),
      adjustFormalHandoffPerformanceInSameMonth,
    });

    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "adjust-performance-request" },
      body: JSON.stringify({
        action: "adjust_formal_handoff_performance",
        formalHandoffId: 42,
        repairRoundVersion: 8,
        performanceValue: "18000",
        reason: "本轮绩效录入错误",
      }),
    }), { businessOrderId: 7 });

    expect(response.status).toBe(200);
    expect(adjustFormalHandoffPerformanceInSameMonth).toHaveBeenCalledWith(expect.objectContaining({
      businessOrderId: 7,
      formalHandoffId: 42,
      expectedRepairRoundVersion: 8,
      performanceValue: "18000",
      reason: "本轮绩效录入错误",
      context: expect.objectContaining({ actorAccountId: 9, requestId: "adjust-performance-request" }),
    }));
  });

  it.each([
    ["boolean", true],
    ["string", "42"],
    ["array", [42]],
    ["float", 42.5],
  ])("rejects a %s formal handoff id before invoking the dependency", async (_label, formalHandoffId) => {
    const cancelFormalHandoffInSameMonth = vi.fn(async () => ({ id: 31 }));
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1 })),
      listRepairRounds: vi.fn(async () => []),
      assignRound: vi.fn(), withdrawAssignment: vi.fn(), cancelAfterSalesRound: vi.fn(),
      recordAcceptanceOnBehalf: vi.fn(), startAfterSalesRound: vi.fn(),
      recordIntakeMileage: vi.fn(), submitWorkReturn: vi.fn(), approveWorkReturn: vi.fn(),
      returnWorkReturn: vi.fn(), formallyHandOffRound: vi.fn(),
      cancelFormalHandoffInSameMonth,
    });

    const response = await handler(new Request("http://local/api/business-orders/7/rounds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel_formal_handoff", formalHandoffId, reason: "客户要求重新确认" }),
    }), { businessOrderId: 7 });

    expect(response.status).toBe(400);
    expect(cancelFormalHandoffInSameMonth).not.toHaveBeenCalled();
  });

});
