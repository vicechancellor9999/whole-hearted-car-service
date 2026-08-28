import type { TeamDefinition } from "@/lib/teams/team-dictionary";

export function moveRepairTeam(
  teams: TeamDefinition[],
  fromIndex: number,
  toIndex: number,
): TeamDefinition[] {
  if (
    fromIndex < 0 || toIndex < 0
    || fromIndex >= teams.length || toIndex >= teams.length
    || fromIndex === toIndex
  ) return teams;
  const moved = [...teams];
  const [team] = moved.splice(fromIndex, 1);
  moved.splice(toIndex, 0, team);
  return moved;
}
