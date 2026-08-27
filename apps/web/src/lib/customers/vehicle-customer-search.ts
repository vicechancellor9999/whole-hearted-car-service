export interface VehicleCustomerSearchCandidate {
  readonly id: string;
  readonly nameZh: string | null;
  readonly nameEn: string | null;
  readonly organizationName: string | null;
  readonly phone: string | null;
  readonly trn: string | null;
}

function compact(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[\s()+\-]/gu, "");
}

export function filterVehicleCustomerCandidates<T extends VehicleCustomerSearchCandidate>(
  customers: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const needle = compact(query);
  if (!needle) return [];
  return customers.filter((customer) => [
    customer.id,
    customer.nameZh,
    customer.nameEn,
    customer.organizationName,
    customer.phone,
    customer.trn,
  ].some((value) => compact(value).includes(needle))).slice(0, limit);
}
