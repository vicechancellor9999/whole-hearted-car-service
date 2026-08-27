export function vehicleYearLabel(year: number): string | null {
  return Number.isInteger(year) && year >= 1886 ? String(year) : null;
}

export function vehicleYearInputValue(year: number): string {
  return vehicleYearLabel(year) ?? "";
}
