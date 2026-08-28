export type FormalDictionaryItem = {
  id: number;
  category: "payment_method" | "charge_unit" | "staff_position";
  code: string;
  labelZh: string;
  labelEn: string | null;
  isActive: boolean;
  sortOrder: number;
  version: number;
};

export type FormalRepairTeam = {
  id: number;
  teamNo: string;
  name: string;
  isActive: boolean;
  version: number;
};

export type FormalStaffMember = {
  id: number;
  staffNo: string;
  fullName: string;
  normalizedPhone: string | null;
  accountId: number;
  accountUsername: string;
  positionItemId: number;
  currentTeamId: number;
  currentTeamName: string | null;
  positionLabel: string;
  status: "active" | "inactive";
  hiredOn: string;
  latestBaseSalaryCnyMinor: number | null;
  salaryEffectiveMonth: string | null;
  version: number;
};

export type FormalPayrollParameters = {
  effectiveMonth: string;
  commissionRate: string;
  cnyToJmdRate: string;
};

export type FormalTeamCommissionRate = {
  teamId: number;
  teamName: string;
  effectiveMonth: string;
  commissionRate: string | null;
};

export type FormalMasterData = {
  dictionaries: FormalDictionaryItem[];
  teams: FormalRepairTeam[];
  staff: FormalStaffMember[];
  payrollParameters: FormalPayrollParameters[];
  teamCommissionRates: FormalTeamCommissionRate[];
};

async function masterDataJson<ResponseBody>(init?: RequestInit): Promise<ResponseBody> {
  const response = await fetch("/api/formal/master-data", { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as ResponseBody & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "基础资料操作失败");
  }
  return payload;
}

export function fetchFormalMasterData(): Promise<FormalMasterData> {
  return masterDataJson();
}

export function createFormalRepairTeam(name: string): Promise<FormalRepairTeam> {
  return masterDataJson({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "create_team", name }),
  });
}

export function reorderFormalRepairTeams(orderedTeamIds: number[]): Promise<FormalRepairTeam[]> {
  return masterDataJson({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "reorder_teams", orderedTeamIds }),
  });
}

export function createFormalDictionaryItem(input: {
  category: FormalDictionaryItem["category"];
  labelZh: string;
  labelEn: string;
}): Promise<FormalDictionaryItem> {
  return masterDataJson({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "create_dictionary_item",
      ...input,
      code: `custom-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    }),
  });
}

export function updateFormalDictionaryItem(input: {
  itemId: number;
  labelZh: string;
  labelEn: string;
  isActive: boolean;
  sortOrder: number;
}): Promise<FormalDictionaryItem> {
  return masterDataJson({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "update_dictionary_item", ...input }),
  });
}

export function renameFormalRepairTeam(teamId: number, name: string): Promise<FormalRepairTeam> {
  return masterDataJson({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "rename_team", teamId, name }),
  });
}

export function retireFormalRepairTeam(input: {
  teamId: number;
  replacementTeamId?: number;
  reason: string;
}): Promise<FormalRepairTeam & { movedMemberCount: number }> {
  return masterDataJson({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "retire_team", ...input }),
  });
}

export function createFormalMechanic(input: {
  fullName: string;
  phone: string;
  positionItemId: number;
  teamId: number;
  hiredOn: string;
  effectiveMonth: string;
  baseSalaryCnyMinor: number;
  username: string;
  password: string;
}): Promise<FormalStaffMember> {
  return masterDataJson({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "create_mechanic", ...input }),
  });
}

export function setFormalEmployeeSalary(input: {
  staffMemberId: number;
  effectiveMonth: string;
  baseSalaryCnyMinor: number;
}): Promise<{ ok: true }> {
  return masterDataJson({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "set_employee_salary", ...input }),
  });
}

export function setFormalPayrollParameters(input: {
  effectiveMonth: string;
  commissionRate: string;
  cnyToJmdRate: string;
}): Promise<FormalPayrollParameters> {
  return masterDataJson({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "set_payroll_parameters", ...input }),
  });
}

export function setFormalTeamCommissionRate(input: {
  teamId: number;
  effectiveMonth: string;
  commissionRate: string | null;
}): Promise<FormalTeamCommissionRate> {
  return masterDataJson({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "set_team_commission_rate", ...input }),
  });
}
