import type { Identity } from "../types";
import { teamById } from "../teams/team-dictionary";

export interface EmployeeRecord extends Identity {
  teamId: string | null;
}

export type EmployeeRole = "frontdesk_admin" | "finance" | "parts" | "mechanic";

export const EMPLOYEE_ROLE_OPTIONS: ReadonlyArray<{
  value: EmployeeRole;
  label: string;
  labelEn: string;
  scope: Identity["scope"];
}> = [
  { value: "frontdesk_admin", label: "前台管理员", labelEn: "Front Desk Admin", scope: "all" },
  { value: "finance", label: "财务", labelEn: "Finance", scope: "all" },
  { value: "parts", label: "配件", labelEn: "Parts", scope: "assigned" },
  { value: "mechanic", label: "维修工", labelEn: "Mechanic", scope: "self" },
];

const STORAGE_KEY = "wh_employees_v1";
const COLORS = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444"];

function isEmployeeRecord(value: unknown): value is EmployeeRecord {
  if (value === null || typeof value !== "object") return false;
  const item = value as Partial<EmployeeRecord>;
  return typeof item.id === "string"
    && typeof item.name === "string"
    && item.name.trim().length > 0
    && typeof item.role === "string"
    && EMPLOYEE_ROLE_OPTIONS.some((role) => role.value === item.role);
}

function parseRecords(raw: string | null): EmployeeRecord[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter(isEmployeeRecord).map((item) => ({ ...item })) : [];
  } catch {
    return [];
  }
}

export function loadEmployees(): EmployeeRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return parseRecords(window.localStorage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return [];
  }
}

function saveEmployees(records: EmployeeRecord[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  window.dispatchEvent(new Event("wh:employees-changed"));
}

function initials(name: string, nameEn: string): string {
  const english = nameEn.trim().split(/\s+/u).filter(Boolean).map((part) => part[0]).join("");
  return (english || name.trim().slice(0, 2)).slice(0, 2).toUpperCase();
}

export function addEmployee(input: {
  name: string;
  nameEn?: string;
  role: EmployeeRole;
  teamId?: string | null;
}): EmployeeRecord {
  const name = input.name.trim();
  const nameEn = input.nameEn?.trim() ?? "";
  if (!name) throw new Error("员工姓名不能为空");
  const current = loadEmployees();
  if (current.some((employee) => employee.name === name)) throw new Error("已有同名员工");
  const role = EMPLOYEE_ROLE_OPTIONS.find((option) => option.value === input.role);
  if (!role) throw new Error("员工角色无效");
  if (role.value === "mechanic" && !input.teamId) throw new Error("维修工必须选择基础字典中的班组");
  if (input.teamId && !teamById(input.teamId)) throw new Error("员工所属班组不在基础字典中");
  const sequence = current.reduce((max, employee) => {
    const match = /^emp-custom-(\d+)$/u.exec(employee.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  const employee: EmployeeRecord = {
    id: `emp-custom-${sequence}`,
    name,
    nameEn,
    role: role.value,
    roleLabel: role.label,
    roleLabelEn: role.labelEn,
    scope: role.scope,
    avatarColor: COLORS[(sequence - 1) % COLORS.length]!,
    initials: initials(name, nameEn),
    teamId: input.teamId ?? null,
  };
  saveEmployees([...current, employee]);
  return employee;
}

export function updateEmployee(
  id: string,
  input: { name: string; nameEn?: string; role: EmployeeRole; teamId?: string | null },
): EmployeeRecord {
  const current = loadEmployees();
  const target = current.find((employee) => employee.id === id);
  if (!target) throw new Error("员工不存在");
  const name = input.name.trim();
  const nameEn = input.nameEn?.trim() ?? "";
  if (!name) throw new Error("员工姓名不能为空");
  if (current.some((employee) => employee.id !== id && employee.name === name)) throw new Error("已有同名员工");
  const role = EMPLOYEE_ROLE_OPTIONS.find((option) => option.value === input.role);
  if (!role) throw new Error("员工角色无效");
  if (role.value === "mechanic" && !input.teamId) throw new Error("维修工必须选择基础字典中的班组");
  if (input.teamId && !teamById(input.teamId)) throw new Error("员工所属班组不在基础字典中");
  const next: EmployeeRecord = {
    ...target,
    name,
    nameEn,
    role: role.value,
    roleLabel: role.label,
    roleLabelEn: role.labelEn,
    scope: role.scope,
    initials: initials(name, nameEn),
    teamId: input.teamId ?? null,
  };
  saveEmployees(current.map((employee) => employee.id === id ? next : employee));
  return next;
}

export function removeEmployee(id: string): void {
  const current = loadEmployees();
  if (!current.some((employee) => employee.id === id)) throw new Error("员工不存在");
  saveEmployees(current.filter((employee) => employee.id !== id));
}

/** Move every current member before a used team is removed. */
export function reassignEmployeesToTeam(fromTeamId: string, toTeamId: string): number {
  if (!fromTeamId || !toTeamId || fromTeamId === toTeamId) throw new Error("继承班组无效");
  if (!teamById(toTeamId)) throw new Error("继承班组不存在");
  const current = loadEmployees();
  const count = current.filter((employee) => employee.teamId === fromTeamId).length;
  if (count === 0) return 0;
  saveEmployees(current.map((employee) => employee.teamId === fromTeamId
    ? { ...employee, teamId: toTeamId }
    : employee));
  return count;
}

export function loadCustomEmployeeIdentities(): Identity[] {
  return loadEmployees().map(({ teamId: _teamId, ...identity }) => ({ ...identity }));
}
