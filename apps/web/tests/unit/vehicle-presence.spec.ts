import { expect, test } from "@playwright/test";
import { deriveVehiclePresence } from "../../src/lib/customers/vehicle-presence";

const vehicle = { id: "VEH-1", status: "off_site" } as Parameters<typeof deriveVehiclePresence>[0][number];

test("vehicle presence starts when a mechanic accepts and ends after pickup", () => {
  expect(deriveVehiclePresence([vehicle], [{ vehicleId: "VEH-1", acceptedAt: null, pickedUpAt: null, voidedAt: null }])[0].status).toBe("off_site");
  expect(deriveVehiclePresence([vehicle], [{ vehicleId: "VEH-1", acceptedAt: "2026-08-25T09:00:00-05:00", pickedUpAt: null, voidedAt: null }])[0].status).toBe("on_site");
  expect(deriveVehiclePresence([vehicle], [{ vehicleId: "VEH-1", acceptedAt: "2026-08-25T09:00:00-05:00", pickedUpAt: "2026-08-25T15:00:00-05:00", voidedAt: null }])[0].status).toBe("off_site");
});

test("one accepted active Business Order keeps the vehicle on site", () => {
  expect(deriveVehiclePresence([vehicle], [
    { vehicleId: "VEH-1", acceptedAt: "2026-08-25T09:00:00-05:00", pickedUpAt: null, voidedAt: null },
    { vehicleId: "VEH-1", acceptedAt: "2026-08-25T10:00:00-05:00", pickedUpAt: "2026-08-25T14:00:00-05:00", voidedAt: null },
  ])[0].status).toBe("on_site");
});
