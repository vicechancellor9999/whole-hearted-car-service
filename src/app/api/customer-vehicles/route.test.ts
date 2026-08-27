import { describe, expect, it, vi } from "vitest";
import { createCustomerVehicleWorkspaceApiHandler } from "@formal/app/api/customer-vehicles/route";

describe("GET /api/customer-vehicles", () => {
  it("requires a formal session", async () => {
    const handler = createCustomerVehicleWorkspaceApiHandler({
      readSession: async () => null,
      listPeople: vi.fn(),
      listCompanies: vi.fn(),
      listCompanyContacts: vi.fn(),
      listVehicles: vi.fn(),
      listVehicleAttachments: vi.fn(),
      listOnSiteVehicleIds: vi.fn(),
    });

    const response = await handler();
    expect(response.status).toBe(401);
  });

  it("returns the complete formal customer and vehicle workspace", async () => {
    const person = { id: 1, customerNo: "CUST-202608-0001" };
    const company = { id: 2, companyNo: "COMP-202608-0001" };
    const contact = { id: 4, companyId: 2, personalCustomerId: 1, personalCustomerName: "Alicia Bennett" };
    const vehicle = { id: 3, vehicleNo: "VEH-202608-0001" };
    const attachment = { fileId: 8, vehicleId: 3, kind: "photo", originalName: "intake.jpg" };
    const handler = createCustomerVehicleWorkspaceApiHandler({
      readSession: async () => ({ account: { id: 9 } }),
      listPeople: vi.fn(async () => ({ items: [person], page: 1, pageSize: 100, pageCount: 1, total: 1 })),
      listCompanies: vi.fn(async () => ({ items: [company], page: 1, pageSize: 100, pageCount: 1, total: 1 })),
      listCompanyContacts: vi.fn(async () => [contact]),
      listVehicles: vi.fn(async () => ({ items: [vehicle], page: 1, pageSize: 100, pageCount: 1, total: 1 })),
      listVehicleAttachments: vi.fn(async () => [attachment]),
      listOnSiteVehicleIds: vi.fn(async () => [3]),
    });

    const response = await handler();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      people: [person],
      companies: [company],
      companyContacts: [contact],
      vehicles: [vehicle],
      vehicleAttachments: [attachment],
      onSiteVehicleIds: [3],
      totals: { people: 1, companies: 1, vehicles: 1 },
    });
  });
});
