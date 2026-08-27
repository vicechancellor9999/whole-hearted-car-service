import { expect, test } from "@playwright/test";
import { addTeam, BUILTIN_TEAMS, loadTeams, removeTeam, renameTeam, teamById, teamNameOf } from "../../src/lib/teams/team-dictionary";

test("班组字典：初始不预设任何维修班组", () => {
  const teams = loadTeams();
  expect(teams).toEqual([]);
  expect(BUILTIN_TEAMS).toEqual([]);
  expect(teamById("t3")).toBeNull();
  expect(teamNameOf("t1")).toBeNull();
  expect(teamNameOf("t9")).toBeNull();
});

test("班组字典：Node 侧无 localStorage 时新增从 t1 编号且不落盘", () => {
  const added = addTeam("验收维修组");
  expect(added).toMatchObject({ id: "t1", name: "验收维修组", builtin: false });
  expect(loadTeams()).toEqual([]);
  // 未落盘的自定义班组在 Node 侧查不到（浏览器侧行为由 e2e 覆盖）
  expect(() => removeTeam("t1")).toThrow(/不存在/);
  expect(() => renameTeam("t1", "验收维修组A")).toThrow(/不存在/);
});
