import type {
  CustomerRecord,
  CustomerVehicleWorkspaceResponse,
  VehicleRecord,
} from "./types";

export function deriveCustomerRiskLevel(
  customer: Pick<CustomerRecord, "status" | "riskFlags">,
): "normal" | "attention" | "high" {
  const active = customer.riskFlags.filter((flag) => flag.removedAt === null);
  if (customer.status === "blacklisted"
    || active.some((flag) => flag.level === "high" || flag.level === "blacklist")) return "high";
  return active.some((flag) => flag.level === "attention") ? "attention" : "normal";
}

export function deriveProfileCompleteness(customer: CustomerRecord): "complete" | "incomplete" {
  if (customer.transliterationStatus !== "confirmed") return "incomplete";
  if (customer.customerType === "organization" && !customer.organizationName) return "incomplete";
  return customer.phone || customer.whatsapp || customer.email ? "complete" : "incomplete";
}

export function customerDisplayNameV3(customer: CustomerRecord): string {
  if (customer.customerType === "organization") return customer.organizationName ?? "机构名待补";
  if (customer.nameZh && customer.nameEn) return `${customer.nameZh} / ${customer.nameEn}`;
  return customer.nameZh ?? customer.nameEn ?? "姓名待补";
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function containsQuery(values: Array<string | null>, query: string): boolean {
  const queryDigits = query.replace(/\D/g, "");
  return values.some((value) => {
    if (value === null) return false;
    if (normalized(value).includes(query)) return true;
    const valueDigits = value.replace(/\D/g, "");
    return queryDigits.length >= 4 && valueDigits.includes(queryDigits);
  });
}

export function searchCustomers(
  workspace: CustomerVehicleWorkspaceResponse,
  query: string,
): CustomerRecord[] {
  const term = normalized(query);
  if (!term) return workspace.customers.slice();

  const relationshipValuesByCustomerId = new Map<string, string[]>();
  for (const relationship of workspace.relationships) {
    const vehicle = workspace.vehicles.find((entry) => entry.id === relationship.vehicleId);
    if (!vehicle) continue;
    const values = relationshipValuesByCustomerId.get(relationship.customerId) ?? [];
    values.push(relationship.id, vehicle.plate);
    relationshipValuesByCustomerId.set(relationship.customerId, values);
  }

  return workspace.customers.filter((customer) => containsQuery([
    customer.nameEn,
    customer.nameZh,
    customer.organizationName,
    customer.phone,
    customer.whatsapp,
    customer.email,
    ...(relationshipValuesByCustomerId.get(customer.id) ?? []),
  ], term));
}

export function searchVehicles(
  workspace: CustomerVehicleWorkspaceResponse,
  query: string,
): VehicleRecord[] {
  const term = normalized(query);
  if (!term) return workspace.vehicles.slice();

  const customersByVehicleId = new Map<string, CustomerRecord[]>();
  const relationshipIdsByVehicleId = new Map<string, string[]>();
  for (const relationship of workspace.relationships) {
    const customer = workspace.customers.find((entry) => entry.id === relationship.customerId);
    if (!customer) continue;
    const customers = customersByVehicleId.get(relationship.vehicleId) ?? [];
    customers.push(customer);
    customersByVehicleId.set(relationship.vehicleId, customers);
    const relationshipIds = relationshipIdsByVehicleId.get(relationship.vehicleId) ?? [];
    relationshipIds.push(relationship.id);
    relationshipIdsByVehicleId.set(relationship.vehicleId, relationshipIds);
  }

  return workspace.vehicles.filter((vehicle) => {
    const relatedCustomers = customersByVehicleId.get(vehicle.id) ?? [];
    return containsQuery([
      vehicle.plate,
      vehicle.vin,
      vehicle.make,
      vehicle.model,
      vehicle.makeZh,
      vehicle.modelZh,
      `${vehicle.make} ${vehicle.model}`,
      ...(relationshipIdsByVehicleId.get(vehicle.id) ?? []),
      ...relatedCustomers.flatMap((customer) => [
        customer.nameEn,
        customer.nameZh,
        customer.organizationName,
        customer.phone,
        customer.whatsapp,
        customer.email,
      ]),
    ], term);
  });
}
