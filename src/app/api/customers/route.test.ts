import { describe, expect, it, vi } from "vitest";
import { createCustomerApiHandler } from "@formal/app/api/customers/route";

describe("POST /api/customers", () => {
  it("creates a personal customer from the formal frontend payload", async () => {
    const createPerson = vi.fn(async () => ({ id: 1, customerNo: "CUST-202608-0001" }));
    const handler = createCustomerApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      createPerson,
      createCompany: vi.fn(),
    });
    const response = await handler(new Request("http://local/api/customers", {
      method: "POST",
      body: JSON.stringify({
        customerType: "individual",
        fullName: "张三",
        phone: "+18765550101",
        trn: null,
      }),
    }));

    expect(response.status).toBe(201);
    expect(createPerson).toHaveBeenCalledWith(expect.objectContaining({
      fullName: "张三",
      phone: "+18765550101",
      context: expect.objectContaining({ actorAccountId: 9 }),
    }));
  });

  it("creates a company account instead of pretending it is a person", async () => {
    const createCompany = vi.fn(async () => ({ id: 2, companyNo: "COMP-202608-0001" }));
    const handler = createCustomerApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      createPerson: vi.fn(),
      createCompany,
    });
    const response = await handler(new Request("http://local/api/customers", {
      method: "POST",
      body: JSON.stringify({
        customerType: "organization",
        organizationName: "Whole Hearted Fleet",
        phone: "+18765550102",
      }),
    }));

    expect(response.status).toBe(201);
    expect(createCompany).toHaveBeenCalledWith(expect.objectContaining({
      legalName: "Whole Hearted Fleet",
      context: expect.objectContaining({ actorAccountId: 9 }),
    }));
  });
});
