import { expect, test } from "@playwright/test";
import { moveRepairTeam } from "../../src/lib/teams/repair-team-ordering";

const teams = [
  { id: "1", name: "车间一组", engineering: false, builtin: false },
  { id: "2", name: "车间二组", engineering: false, builtin: false },
  { id: "3", name: "钣金喷漆", engineering: false, builtin: false },
];

test("moves one repair team without mutating the source list", () => {
  expect(moveRepairTeam(teams, 2, 0).map((team) => team.id)).toEqual(["3", "1", "2"]);
  expect(teams.map((team) => team.id)).toEqual(["1", "2", "3"]);
});

test("ignores an out-of-range or no-op repair-team move", () => {
  expect(moveRepairTeam(teams, -1, 2)).toBe(teams);
  expect(moveRepairTeam(teams, 0, 3)).toBe(teams);
  expect(moveRepairTeam(teams, 1, 1)).toBe(teams);
});
