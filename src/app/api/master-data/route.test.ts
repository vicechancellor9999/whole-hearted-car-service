import { describe, expect, it, vi } from "vitest";
import { createMasterDataApiHandler } from "@/app/api/master-data/route";
import { MasterDataManagementDeniedError } from "@/modules/master-data/master-data-service";

describe("/api/master-data", () => {
  it.each(["super_admin", "owner"] as const)(
    "returns payroll parameters to an authenticated %s",
    async (role) => {
      const listPayrollParameters = vi.fn(async () => [{
        effectiveMonth: "2026-08",
        commissionRate: "0.100000",
        cnyToJmdRate: "21.500000",
      }]);
      const handler = createMasterDataApiHandler({
        readSession: async () => ({ account: { id: 5, role } }),
        listDictionaryItems: vi.fn(async () => []),
        listRepairTeams: vi.fn(async () => []),
        listStaffMembers: vi.fn(async () => []),
        listPayrollParameters,
        createRepairTeam: vi.fn(),
        createDictionaryItem: vi.fn(),
        updateDictionaryItem: vi.fn(),
        createMechanic: vi.fn(),
        renameRepairTeam: vi.fn(),
        retireRepairTeam: vi.fn(),
        setEmployeeSalary: vi.fn(),
      });

      const response = await handler(new Request("http://localhost/api/master-data"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        dictionaries: [],
        teams: [],
        staff: [],
        payrollParameters: [{
          effectiveMonth: "2026-08",
          commissionRate: "0.100000",
          cnyToJmdRate: "21.500000",
        }],
      });
      expect(listPayrollParameters).toHaveBeenCalledWith({ viewerAccountId: 5 });
    },
  );

  it("returns operational master data without payroll facts to front desk", async () => {
    const listDictionaryItems = vi.fn(async () => [{
      id: 1,
      category: "payment_method" as const,
      code: "cash",
      labelZh: "现金",
      labelEn: "Cash",
      isActive: true,
      sortOrder: 1,
      version: 1,
    }]);
    const listRepairTeams = vi.fn(async () => [{
      id: 2,
      teamNo: "TEAM-202608-001",
      name: "车间一组",
      isActive: true,
      version: 1,
    }]);
    const listStaffMembers = vi.fn(async () => [{
      id: 3,
      staffNo: "STAFF-202608-0001",
      fullName: "林海",
      normalizedPhone: "+18765550101",
      accountId: 8,
      accountUsername: "mechanic.one",
      positionItemId: 4,
      currentTeamId: 2,
      currentTeamName: "车间一组",
      positionLabel: "维修工",
      status: "active" as const,
      hiredOn: "2026-08-01",
      latestBaseSalaryCnyMinor: null,
      salaryEffectiveMonth: null,
      version: 1,
    }]);
    const listPayrollParameters = vi.fn(async () => {
      throw new MasterDataManagementDeniedError();
    });
    const handler = createMasterDataApiHandler({
      readSession: async () => ({ account: { id: 5, role: "front_desk" as const } }),
      listDictionaryItems,
      listRepairTeams,
      listStaffMembers,
      listPayrollParameters,
      createRepairTeam: vi.fn(),
      createDictionaryItem: vi.fn(),
      updateDictionaryItem: vi.fn(),
      createMechanic: vi.fn(),
      renameRepairTeam: vi.fn(),
      retireRepairTeam: vi.fn(),
      setEmployeeSalary: vi.fn(),
    });
    const response = await handler(new Request("http://localhost/api/master-data"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      dictionaries: [{ id: 1, category: "payment_method", code: "cash", labelZh: "现金", labelEn: "Cash", isActive: true, sortOrder: 1, version: 1 }],
      teams: [{ id: 2, teamNo: "TEAM-202608-001", name: "车间一组", isActive: true, version: 1 }],
      staff: [{
        id: 3,
        staffNo: "STAFF-202608-0001",
        fullName: "林海",
        normalizedPhone: "+18765550101",
        accountId: 8,
        accountUsername: "mechanic.one",
        positionItemId: 4,
        currentTeamId: 2,
        currentTeamName: "车间一组",
        positionLabel: "维修工",
        status: "active",
        hiredOn: "2026-08-01",
        latestBaseSalaryCnyMinor: null,
        salaryEffectiveMonth: null,
        version: 1,
      }],
      payrollParameters: [],
    });
    expect(listDictionaryItems).toHaveBeenCalledWith({ viewerAccountId: 5 });
    expect(listRepairTeams).toHaveBeenCalledWith({ viewerAccountId: 5 });
    expect(listStaffMembers).toHaveBeenCalledWith({ viewerAccountId: 5 });
    expect(listPayrollParameters).not.toHaveBeenCalled();
  });

  it("keeps mechanics outside the PC master-data response", async () => {
    const denied = async () => {
      throw new MasterDataManagementDeniedError();
    };
    const listPayrollParameters = vi.fn(async () => [{
      effectiveMonth: "2026-08",
      commissionRate: "0.100000",
      cnyToJmdRate: "21.500000",
    }]);
    const handler = createMasterDataApiHandler({
      readSession: async () => ({ account: { id: 6, role: "mechanic" as const } }),
      listDictionaryItems: vi.fn(denied),
      listRepairTeams: vi.fn(denied),
      listStaffMembers: vi.fn(denied),
      listPayrollParameters,
      createRepairTeam: vi.fn(),
      createDictionaryItem: vi.fn(),
      updateDictionaryItem: vi.fn(),
      createMechanic: vi.fn(),
      renameRepairTeam: vi.fn(),
      retireRepairTeam: vi.fn(),
      setEmployeeSalary: vi.fn(),
    });

    const response = await handler(new Request("http://localhost/api/master-data"));
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "只有激活的超级管理员可以维护班组、员工和工资参数" });
    expect(payload).not.toHaveProperty("dictionaries");
    expect(payload).not.toHaveProperty("teams");
    expect(payload).not.toHaveProperty("staff");
    expect(payload).not.toHaveProperty("payrollParameters");
    expect(listPayrollParameters).not.toHaveBeenCalled();
  });

  it("returns 401 without invoking readers when there is no session", async () => {
    const listDictionaryItems = vi.fn();
    const listRepairTeams = vi.fn();
    const listStaffMembers = vi.fn();
    const listPayrollParameters = vi.fn();
    const handler = createMasterDataApiHandler({
      readSession: async () => null,
      listDictionaryItems,
      listRepairTeams,
      listStaffMembers,
      listPayrollParameters,
      createRepairTeam: vi.fn(),
      createDictionaryItem: vi.fn(),
      updateDictionaryItem: vi.fn(),
      createMechanic: vi.fn(),
      renameRepairTeam: vi.fn(),
      retireRepairTeam: vi.fn(),
      setEmployeeSalary: vi.fn(),
    });

    const response = await handler(new Request("http://localhost/api/master-data"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(listDictionaryItems).not.toHaveBeenCalled();
    expect(listRepairTeams).not.toHaveBeenCalled();
    expect(listStaffMembers).not.toHaveBeenCalled();
    expect(listPayrollParameters).not.toHaveBeenCalled();
  });

  it("creates a real repair team with the signed-in super administrator", async () => {
    const createRepairTeam = vi.fn(async () => ({ id: 8, teamNo: "TEAM-202608-008", name: "钣金喷漆", isActive: true, version: 1 }));
    const handler = createMasterDataApiHandler({
      readSession: async () => ({ account: { id: 5, role: "super_admin" as const } }),
      listDictionaryItems: vi.fn(), listRepairTeams: vi.fn(), listStaffMembers: vi.fn(), listPayrollParameters: vi.fn(),
      createRepairTeam,
      createDictionaryItem: vi.fn(), updateDictionaryItem: vi.fn(), createMechanic: vi.fn(), renameRepairTeam: vi.fn(), retireRepairTeam: vi.fn(), setEmployeeSalary: vi.fn(),
    });
    const response = await handler(new Request("http://localhost/api/master-data", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-team" },
      body: JSON.stringify({ action: "create_team", name: "钣金喷漆" }),
    }));
    expect(response.status).toBe(201);
    expect(createRepairTeam).toHaveBeenCalledWith(expect.objectContaining({
      name: "钣金喷漆",
      context: expect.objectContaining({ actorAccountId: 5, requestId: "req-team" }),
    }));
  });
});
