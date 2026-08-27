import { describe, expect, it, vi } from "vitest";
import { createBusinessOrderRoundsApiHandler } from "@formal/app/api/business-orders/[businessOrderId]/rounds/route";

describe("/api/business-orders/:id/rounds", () => {
  it("returns current round and immutable round history", async () => {
    const handler = createBusinessOrderRoundsApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      getCurrentRound: vi.fn(async () => ({ id: 3, roundNo: 1 })),
      listRepairRounds: vi.fn(async () => [{ id: 3, roundNo: 1 }]),
      listAuditTrail: vi.fn(async () => [{ id: 88, eventType: "business_order.charge_version_replaced" }]),
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
