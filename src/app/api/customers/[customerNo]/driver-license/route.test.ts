import { describe, expect, it, vi } from "vitest";
import { createCustomerDriverLicenseSupplementHandler } from "@formal/app/api/customers/[customerNo]/driver-license/route";

function request(): Request {
  const form = new FormData();
  form.set("payload", JSON.stringify({
    profile: { name: "ALICIA", birthDate: "1990-06-15", sex: "F", address: "12 Ocean Road" },
    verified: true,
    transform: { rotation: 0, crop: null },
  }));
  form.set("licenseFront", new File([
    new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  ], "license.jpg", { type: "image/jpeg" }));
  return new Request("http://local/api/customers/CUST-1/driver-license", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/customers/:customerNo/driver-license", () => {
  it("stores and commits a supplement without deleting its evidence", async () => {
    const remove = vi.fn(async () => undefined);
    const save = vi.fn(async () => ({ id: 4, status: "verified" } as never));
    const handler = createCustomerDriverLicenseSupplementHandler({
      readSession: async () => ({ account: { id: 9 } }),
      resolveSubject: async () => ({ type: "individual_customer", personalCustomerId: 3 }),
      store: async () => ({
        storageKey: "customer-license-files/2026/08/new.jpg",
        originalName: "license.jpg",
        mediaType: "image/jpeg",
        sizeBytes: 100,
        sha256Hex: "a".repeat(64),
      }),
      save,
      remove,
    });
    const response = await handler(request(), {
      params: Promise.resolve({ customerNo: "CUST-202608-0003" }),
    });
    expect(response.status).toBe(201);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      verified: true,
      subject: { type: "individual_customer", personalCustomerId: 3 },
    }));
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes the prepared evidence when supplement persistence fails", async () => {
    const remove = vi.fn(async () => undefined);
    const handler = createCustomerDriverLicenseSupplementHandler({
      readSession: async () => ({ account: { id: 9 } }),
      resolveSubject: async () => ({ type: "individual_customer", personalCustomerId: 3 }),
      store: async () => ({
        storageKey: "customer-license-files/2026/08/rollback.jpg",
        originalName: "license.jpg",
        mediaType: "image/jpeg",
        sizeBytes: 100,
        sha256Hex: "b".repeat(64),
      }),
      save: async () => { throw Object.assign(new Error("conflict"), { status: 409 }); },
      remove,
    });
    const response = await handler(request(), {
      params: Promise.resolve({ customerNo: "CUST-202608-0003" }),
    });
    expect(response.status).toBe(409);
    expect(remove).toHaveBeenCalledWith("customer-license-files/2026/08/rollback.jpg");
  });
});
