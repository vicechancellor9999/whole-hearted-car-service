/**
 * 维修班组字典（2026-08-20 老板）：班组做成字典，后期可加班组、改班组名。
 * 不预设演示班组；超级管理员按实际组织新增、改名或删除。
 * 存储键 wh_teams_v2；服务端/单测无 window 时返回空字典。
 */
export interface TeamDefinition {
  readonly id: string;
  readonly name: string;
  /** 特殊作业班组可要求派单落实到具体维修工。 */
  readonly engineering: boolean;
  readonly builtin: boolean;
}

const STORAGE_KEY = "wh_teams_v2";

export const BUILTIN_TEAMS: ReadonlyArray<TeamDefinition> = [];

function parseStored(raw: string | null): TeamDefinition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TeamDefinition =>
      item !== null && typeof item === "object"
      && typeof (item as { id?: unknown }).id === "string"
      && typeof (item as { name?: unknown }).name === "string"
      && ((item as { name?: unknown }).name as string).trim().length > 0
      && (item as { builtin?: unknown }).builtin !== true
    ).map((item) => ({
      id: item.id,
      name: item.name.trim(),
      engineering: item.engineering === true,
      builtin: item.builtin === true,
    }));
  } catch {
    return [];
  }
}

/** 当前班组字典：只读取超级管理员实际创建的 localStorage 记录。 */
export function loadTeams(): TeamDefinition[] {
  if (typeof window === "undefined") return [...BUILTIN_TEAMS];
  try {
    const custom = parseStored(window.localStorage.getItem(STORAGE_KEY));
    const merged = [...BUILTIN_TEAMS, ...custom.filter((team) => !BUILTIN_TEAMS.some((builtin) => builtin.id === team.id))];
    return merged.map((team) => {
      const override = custom.find((candidate) => candidate.id === team.id);
      return override ? { ...team, name: override.name, engineering: override.engineering || team.engineering } : team;
    });
  } catch {
    return [...BUILTIN_TEAMS];
  }
}

function saveTeams(teams: TeamDefinition[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(teams));
    if (typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("wh:teams-changed"));
  } catch {
    // 忽略存储异常
  }
}

export function teamById(id: string | null | undefined): TeamDefinition | null {
  if (!id) return null;
  return loadTeams().find((team) => team.id === id) ?? null;
}

export function teamNameOf(id: string | null | undefined): string | null {
  return teamById(id)?.name ?? null;
}

/** 新增班组：id 自动编号；名字必填、不可与现有重名。 */
export function addTeam(name: string): TeamDefinition {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("班组名称不能为空");
  const teams = loadTeams();
  if (teams.some((team) => team.name === trimmed)) throw new Error("已有同名班组");
  const nextNumber = teams.reduce((max, team) => {
    const match = /^t(\d+)$/.exec(team.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  const team: TeamDefinition = { id: `t${nextNumber}`, name: trimmed, engineering: false, builtin: false };
  saveTeams([...teams, team]);
  return team;
}

/** 改班组名（内置/自定义都可改）。 */
export function renameTeam(id: string, name: string): TeamDefinition {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("班组名称不能为空");
  const teams = loadTeams();
  const target = teams.find((team) => team.id === id);
  if (!target) throw new Error("班组不存在");
  if (teams.some((team) => team.id !== id && team.name === trimmed)) throw new Error("已有同名班组");
  const next = teams.map((team) => (team.id === id ? { ...team, name: trimmed } : team));
  saveTeams(next);
  return { ...target, name: trimmed };
}

/** 删除班组。 */
export function removeTeam(id: string): void {
  const teams = loadTeams();
  const target = teams.find((team) => team.id === id);
  if (!target) throw new Error("班组不存在");
  if (target.builtin) throw new Error("内置班组不能删除（可以改名）");
  saveTeams(teams.filter((team) => team.id !== id));
}
