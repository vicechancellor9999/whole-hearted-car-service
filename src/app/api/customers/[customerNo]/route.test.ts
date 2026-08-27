import { describe, expect, it, vi } from "vitest";
import { createCustomerDetailApiHandler } from "@/app/api/customers/[customerNo]/route";

const person = {
  id: 11,
  customerNo: "CUST-202608-0001",
  fullName: "张三",
  normalizedPhone: "+18765550101",
  whatsapp: null,
  email: null,
  address: null,
  trn: null,
  isActive: true,
  version: 2,
};

describe("/api/customers/[customerNo]", () => {
  it("reads one formal customer by customer number", async () => {
    const handler = createCustomerDetailApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      findCustomer: vi.fn(async () => ({ kind: "person" as const, record: person })),
      updatePerson: vi.fn(),
      updateCompany: vi.fn(),
    });

    const response = await handler(
      new Request("http://local/api/customers/CUST-202608-0001"),
      { customerNo: "CUST-202608-0001" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ kind: "person", record: person });
  });

  it("updates the resolved personal customer with optimistic version and audit context", async () => {
    const updatePerson = vi.fn(async () => ({ ...person, fullName: "张三丰", version: 3 }));
    const handler = createCustomerDetailApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      findCustomer: vi.fn(async () => ({ kind: "person" as const, record: person })),
      updatePerson,
      updateCompany: vi.fn(),
    });

    const response = await handler(
      new Request("http://local/api/customers/CUST-202608-0001", {
        method: "PATCH",
        body: JSON.stringify({
          customerType: "individual",
          fullName: "张三丰",
          isActive: true,
          version: 2,
        }),
      }),
      { customerNo: "CUST-202608-0001" },
    );

    expect(response.status).toBe(200);
    expect(updatePerson).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 11,
      fullName: "张三丰",
      phone: "+18765550101",
      version: 2,
      context: expect.objectContaining({ actorAccountId: 9 }),
    }));
  });

  it("does not allow a personal record to be changed into a company record", async () => {
    const handler = createCustomerDetailApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      findCustomer: vi.fn(async () => ({ kind: "person" as const, record: person })),
      updatePerson: vi.fn(),
      updateCompany: vi.fn(),
    });

    const response = await handler(
      new Request("http://local/api/customers/CUST-202608-0001", {
        method: "PATCH",
        body: JSON.stringify({ customerType: "organization", organizationName: "错误公司", isActive: true, version: 2 }),
      }),
      { customerNo: "CUST-202608-0001" },
    );
    expect(response.status).toBe(409);
  });

  it("rejects non-text optional fields instead of silently clearing customer data", async () => {
    const updatePerson = vi.fn();
    const handler = createCustomerDetailApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      findCustomer: vi.fn(async () => ({ kind: "person" as const, record: person })),
      updatePerson,
      updateCompany: vi.fn(),
    });

    const response = await handler(
      new Request("http://local/api/customers/CUST-202608-0001", {
        method: "PATCH",
        body: JSON.stringify({
          customerType: "individual",
          fullName: "张三",
          email: 123,
          isActive: true,
          version: 2,
        }),
      }),
      { customerNo: "CUST-202608-0001" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "可选文本字段必须是字符串或 null" });
    expect(updatePerson).not.toHaveBeenCalled();
  });
});
