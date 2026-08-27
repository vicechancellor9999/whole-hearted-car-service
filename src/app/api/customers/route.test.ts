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

  it("creates a verified personal customer from multipart evidence", async () => {
    const createPersonWithLicense = vi.fn(async () => ({
      record: { id: 3, customerNo: "CUST-202608-0003" },
      driverLicense: { id: 8, status: "verified" },
    }));
    const removeLicense = vi.fn(async () => undefined);
    const handler = createCustomerApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      createPerson: vi.fn(),
      createCompany: vi.fn(),
      createPersonWithLicense,
      storeLicense: vi.fn(async () => ({
        storageKey: "customer-license-files/2026/08/evidence.jpg",
        originalName: "license.jpg",
        mediaType: "image/jpeg" as const,
        sizeBytes: 100,
        sha256Hex: "a".repeat(64),
      })),
      removeLicense,
    });
    const form = new FormData();
    form.set("payload", JSON.stringify({
      customerType: "individual",
      fullName: "Alicia Draft",
      phone: null,
      whatsapp: null,
      email: null,
      address: null,
      trn: null,
      license: {
        profile: {
          name: "ALICIA BENNETT",
          birthDate: "1990-06-15",
          sex: "F",
          address: "12 Ocean Road",
        },
        verified: true,
        transform: { rotation: 0, crop: null },
      },
    }));
    form.set("licenseFront", new File([
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    ], "license.jpg", { type: "image/jpeg" }));
    const response = await handler(new Request("http://local/api/customers", {
      method: "POST",
      body: form,
    }));

    expect(response.status).toBe(201);
    expect(createPersonWithLicense).toHaveBeenCalledWith(expect.objectContaining({
      fullName: "Alicia Draft",
      license: expect.objectContaining({
        verified: true,
        profile: expect.objectContaining({ name: "ALICIA BENNETT" }),
      }),
    }));
    expect(removeLicense).not.toHaveBeenCalled();
  });

  it("removes a prepared license file when the customer transaction fails", async () => {
    const removeLicense = vi.fn(async () => undefined);
    const handler = createCustomerApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      createPerson: vi.fn(),
      createCompany: vi.fn(),
      createPersonWithLicense: vi.fn(async () => {
        throw Object.assign(new Error("号码冲突"), { status: 409 });
      }),
      storeLicense: vi.fn(async () => ({
        storageKey: "customer-license-files/2026/08/cleanup.jpg",
        originalName: "license.jpg",
        mediaType: "image/jpeg" as const,
        sizeBytes: 100,
        sha256Hex: "b".repeat(64),
      })),
      removeLicense,
    });
    const form = new FormData();
    form.set("payload", JSON.stringify({
      customerType: "individual",
      fullName: "Conflict",
      license: {
        profile: { name: "Conflict", birthDate: "1990-01-01", sex: "M", address: "Address" },
        verified: false,
        transform: { rotation: 0, crop: null },
      },
    }));
    form.set("licenseFront", new File([
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    ], "license.jpg", { type: "image/jpeg" }));
    const response = await handler(new Request("http://local/api/customers", {
      method: "POST",
      body: form,
    }));
    expect(response.status).toBe(409);
    expect(removeLicense).toHaveBeenCalledWith("customer-license-files/2026/08/cleanup.jpg");
  });
});
