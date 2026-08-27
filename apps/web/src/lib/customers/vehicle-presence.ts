import type { VehicleRecord } from "./types";

export interface VehiclePresenceOrder {
  readonly vehicleId: string;
  readonly acceptedAt: string | null;
  readonly pickedUpAt?: string | null;
  readonly voidedAt: string | null;
}

export function deriveVehiclePresence(
  vehicles: readonly VehicleRecord[],
  orders: readonly VehiclePresenceOrder[],
): VehicleRecord[] {
  const onSiteVehicleIds = new Set(orders.filter((order) => (
    order.acceptedAt !== null && !order.pickedUpAt && order.voidedAt === null
  )).map((order) => order.vehicleId));
  return vehicles.map((vehicle) => ({
    ...vehicle,
    status: onSiteVehicleIds.has(vehicle.id) ? "on_site" : "off_site",
  }));
}
