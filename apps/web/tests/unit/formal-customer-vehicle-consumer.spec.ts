import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CustomerVehicleWorkspaceResponse } from "../../src/lib/customers/types";
import {
  loadFormalSafeLinkedOperations,
  loadWorkspaceWithVehiclePresence,
} from "../../src/lib/customers/formal-customer-vehicle-consumer";

const workspace = {
  sourceRevision: 1,
  summary: {
    totalCustomers: 0,
    activeCustomers: 0,
    totalVehicles: 1,
    activeVehicles: 1,
    activeRelationships: 0,
  },
  customers: [],
  relationships: [],
  companyContacts: [],
  vehicles: [{ id: "VEH-1", status: "on_site" }],
} as unknown as CustomerVehicleWorkspaceResponse;

test("formal workspace keeps backend presence and never reads Mock quick orders", async () => {
  let quickOrderReads = 0;
  const resolved = await loadWorkspaceWithVehiclePresence({
    formal: true,
    loadWorkspace: async () => workspace,
    loadQuickOrders: async () => {
      quickOrderReads += 1;
      return [];
    },
  });

  expect(resolved.vehicles[0]?.status).toBe("on_site");
  expect(quickOrderReads).toBe(0);
});

test("formal customer pages never read Mock linked-operation finance state", async () => {
  let linkedOperationReads = 0;
  const state = await loadFormalSafeLinkedOperations({
    formal: true,
    load: async () => {
      linkedOperationReads += 1;
      return { any: "mock-state" };
    },
  });

  expect(state).toBeNull();
  expect(linkedOperationReads).toBe(0);
});

test("formal customer and vehicle details restart their initial read when the HTTP-only session arrives", () => {
  const shared = readFileSync(resolve(process.cwd(), "src/components/customers/detail-shared.tsx"), "utf8");
  const customer = readFileSync(resolve(process.cwd(), "src/components/customers/customer-detail-page.tsx"), "utf8");
  const vehicle = readFileSync(resolve(process.cwd(), "src/components/customers/vehicle-detail-page.tsx"), "utf8");

  expect(shared).toContain("useCurrentSessionKey");
  expect(shared).toContain('wh:formal-session-changed');
  expect(customer).toContain("useCurrentSessionKey()");
  expect(vehicle).toContain("useCurrentSessionKey()");
});
