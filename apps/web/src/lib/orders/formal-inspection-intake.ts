type InspectionStaff = {
  id: number;
  currentTeamId: number;
  status: "active" | "inactive";
};

export function normalizeInspectionPlateQuery(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}

export function activeStaffForInspectionTeam<T extends InspectionStaff>(
  staff: T[],
  teamId: number | null,
): T[] {
  if (!teamId) return [];
  return staff.filter((member) => member.status === "active" && member.currentTeamId === teamId);
}

export function retainInspectorForTeam<T extends InspectionStaff>(
  inspectorId: string,
  staff: T[],
  teamId: number | null,
): string {
  if (!inspectorId) return "";
  return activeStaffForInspectionTeam(staff, teamId)
    .some((member) => String(member.id) === inspectorId)
    ? inspectorId
    : "";
}
