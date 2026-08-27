import type { CustomerVehicleWorkspaceResponse } from "@/lib/customers/types";
import {
  deriveVehiclePresence,
  type VehiclePresenceOrder,
} from "@/lib/customers/vehicle-presence";

export async function loadWorkspaceWithVehiclePresence(input: {
  formal: boolean;
  loadWorkspace(): Promise<CustomerVehicleWorkspaceResponse>;
  loadQuickOrders(): Promise<readonly VehiclePresenceOrder[]>;
}): Promise<CustomerVehicleWorkspaceResponse> {
  const workspace = await input.loadWorkspace();
  if (input.formal) return workspace;
  const orders = await input.loadQuickOrders().catch(() => []);
  return {
    ...workspace,
    vehicles: deriveVehiclePresence(workspace.vehicles, orders),
  };
}

export async function loadFormalSafeLinkedOperations<State>(input: {
  formal: boolean;
  load(): Promise<State>;
}): Promise<State | null> {
  if (input.formal) return null;
  return input.load().catch(() => null);
}
