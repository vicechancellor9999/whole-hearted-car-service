import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { verifyPassword } from "@formal/modules/auth/password";
import {
  MasterDataManagementDeniedError,
  MasterDataService,
  TeamReplacementRequiredError,
} from "@formal/modules/master-data/master-data-service";

const migrationPaths = [
  resolve(process.cwd(), "drizzle/0000_foundation.sql"),
  resolve(process.cwd(), "drizzle/0001_account_permissions.sql"),
  resolve(process.cwd(), "drizzle/0002_master_data.sql"),
  resolve(process.cwd(), "drizzle/0003_master_data_facts_append_only.sql"),
  resolve(process.cwd(), "drizzle/0024_team_commission_rate_versions.sql"),
  resolve(process.cwd(), "drizzle/0034_repair_team_sort_order.sql"),
  resolve(process.cwd(), "drizzle/0048_employee_salary_revision.sql"),
];

let database: PGlite;
let service: MasterDataService;
let adminId: number;

function createExecutor(executor: PGlite | Transaction): AuthSqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      parameters: readonly unknown[] = [],
    ) {
      const result = await executor.query<Row>(text, [...parameters]);
      return result.rows;
    },
  };
}

function createTestDatabase(pglite: PGlite): AuthSqlDatabase {
  return {
    ...createExecutor(pglite),
    transaction(callback) {
      return pglite.transaction((transaction) =>
        callback(createExecutor(transaction)),
      );
    },
  };
}

async function seedAccount(
  displayName: string,
  username: string,
  role: "super_admin" | "front_desk" | "owner" | "mechanic",
) {
  const result = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role,
       must_change_password)
     values ($1, $2, 'test-hash', $3, false)
     returning id`,
    [displayName, username, role],
  );
  return Number(result.rows[0].id);
}

function context(requestId: string, actorAccountId = adminId) {
  return {
    actorAccountId,
    requestId,
    now: new Date("2026-08-24T10:00:00Z"),
    ipAddress: "127.0.0.1",
    userAgent: "Vitest",
  };
}

describe("MasterDataService", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
    adminId = await seedAccount("超级管理员", "admin", "super_admin");
    service = new MasterDataService(createTestDatabase(database));
  });

  afterEach(async () => {
    await database.close();
  });

  it("creates a mechanic, login account, team assignment and base salary atomically", async () => {
    const position = await service.createDictionaryItem({
      category: "staff_position",
      code: "mechanic",
      labelZh: "维修工",
      labelEn: "Mechanic",
      context: context("req-position"),
    });
    const team = await service.createRepairTeam({
      name: "维修一组",
      context: context("req-team"),
    });

    const member = await service.createMechanic({
      fullName: " 林海 ",
      phone: "+1 (876) 555-0101",
      positionItemId: position.id,
      teamId: team.id,
      hiredOn: "2026-08-01",
      effectiveMonth: "2026-08",
      baseSalaryCnyMinor: 500_000,
      username: " Ｍechanic.One ",
      password: "Mechanic formal 2026!",
      context: context("req-mechanic"),
    });

    expect(member).toMatchObject({
      staffNo: "STAFF-202608-0001",
      fullName: "林海",
      normalizedPhone: "+18765550101",
      currentTeamId: team.id,
      accountUsername: "mechanic.one",
    });
    const account = await database.query<{
      role: string;
      password_hash: string;
      must_change_password: boolean;
    }>(
      `select role, password_hash, must_change_password
       from staff_accounts
       where id = $1`,
      [member.accountId],
    );
    expect(account.rows[0].role).toBe("mechanic");
    expect(account.rows[0].must_change_password).toBe(true);
    await expect(
      verifyPassword(account.rows[0].password_hash, "Mechanic formal 2026!"),
    ).resolves.toBe(true);

    const facts = await database.query<{
      effective_month: string;
      team_id: number;
      base_salary_cny_minor: number;
    }>(
      `select assignment.effective_month::text, assignment.team_id,
              salary.base_salary_cny_minor
       from staff_team_assignment_versions as assignment
       join employee_salary_versions as salary
         on salary.staff_member_id = assignment.staff_member_id
        and salary.effective_month = assignment.effective_month
       where assignment.staff_member_id = $1`,
      [member.id],
    );
    expect(facts.rows[0]).toEqual({
      effective_month: "2026-08-01",
      team_id: team.id,
      base_salary_cny_minor: 500_000,
    });
    await expect(
      service.listStaffMembers({ viewerAccountId: adminId }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: member.id,
        staffNo: "STAFF-202608-0001",
        fullName: "林海",
        accountUsername: "mechanic.one",
        currentTeamName: "维修一组",
        positionLabel: "维修工",
        latestBaseSalaryCnyMinor: 500_000,
        salaryEffectiveMonth: "2026-08",
      }),
    ]);
    const frontDeskId = await seedAccount("前台", "front", "front_desk");
    await expect(
      service.listStaffMembers({ viewerAccountId: frontDeskId }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: member.id,
        latestBaseSalaryCnyMinor: null,
        salaryEffectiveMonth: null,
      }),
    ]);
    await expect(
      service.listPayrollParameters({ viewerAccountId: frontDeskId }),
    ).rejects.toBeInstanceOf(MasterDataManagementDeniedError);
    const audits = await database.query<{
      event_type: string;
      after_state: Record<string, unknown>;
    }>(
      `select event_type, after_state
       from audit_events
       where request_id = 'req-mechanic'
       order by id`,
    );
    expect(audits.rows.map((row) => row.event_type)).toEqual([
      "account.created",
      "staff.created",
    ]);
    expect(JSON.stringify(audits.rows)).not.toContain("Mechanic formal 2026!");
  });

  it("revises an existing historical salary month and audits the before and after amounts", async () => {
    const position = await service.createDictionaryItem({
      category: "staff_position",
      code: "mechanic",
      labelZh: "维修工",
      context: context("req-position"),
    });
    const team = await service.createRepairTeam({
      name: "维修一组",
      context: context("req-team"),
    });
    const member = await service.createMechanic({
      fullName: "张真真",
      phone: "+18765550101",
      positionItemId: position.id,
      teamId: team.id,
      hiredOn: "2026-08-01",
      effectiveMonth: "2026-08",
      baseSalaryCnyMinor: 1_600_000,
      username: "zhang.zhenzhen",
      password: "Mechanic formal 2026!",
      context: context("req-mechanic"),
    });

    await service.setEmployeeSalary({
      staffMemberId: member.id,
      effectiveMonth: "2026-08",
      baseSalaryCnyMinor: 800_000,
      context: context("req-salary-revision"),
    });

    const salaries = await database.query<{
      base_salary_cny_minor: number;
    }>(
      `select base_salary_cny_minor
       from employee_salary_versions
       where staff_member_id = $1 and effective_month = date '2026-08-01'`,
      [member.id],
    );
    expect(salaries.rows).toEqual([{ base_salary_cny_minor: 800_000 }]);

    const audits = await database.query<{
      event_type: string;
      before_state: Record<string, unknown>;
      after_state: Record<string, unknown>;
    }>(
      `select event_type, before_state, after_state
       from audit_events
       where request_id = 'req-salary-revision'`,
    );
    expect(audits.rows).toEqual([{
      event_type: "staff.salary_version_revised",
      before_state: { effectiveMonth: "2026-08", baseSalaryCnyMinor: 1_600_000 },
      after_state: { effectiveMonth: "2026-08", baseSalaryCnyMinor: 800_000 },
    }]);
  });

  it("requires an active replacement for a team that still has current members", async () => {
    const position = await service.createDictionaryItem({
      category: "staff_position",
      code: "mechanic",
      labelZh: "维修工",
      context: context("req-position"),
    });
    const source = await service.createRepairTeam({
      name: "维修一组",
      context: context("req-team-1"),
    });
    await service.createMechanic({
      fullName: "林海",
      phone: "+18765550101",
      positionItemId: position.id,
      teamId: source.id,
      hiredOn: "2026-08-01",
      effectiveMonth: "2026-08",
      baseSalaryCnyMinor: 500_000,
      username: "mechanic.one",
      password: "Mechanic formal 2026!",
      context: context("req-mechanic"),
    });

    await expect(
      service.retireRepairTeam({
        teamId: source.id,
        reason: "班组整合",
        context: context("req-retire-no-replacement"),
      }),
    ).rejects.toBeInstanceOf(TeamReplacementRequiredError);
  });

  it("moves current members but keeps the original monthly team fact", async () => {
    const position = await service.createDictionaryItem({
      category: "staff_position",
      code: "mechanic",
      labelZh: "维修工",
      context: context("req-position"),
    });
    const source = await service.createRepairTeam({
      name: "维修一组",
      context: context("req-team-1"),
    });
    const replacement = await service.createRepairTeam({
      name: "维修二组",
      context: context("req-team-2"),
    });
    const member = await service.createMechanic({
      fullName: "林海",
      phone: "+18765550101",
      positionItemId: position.id,
      teamId: source.id,
      hiredOn: "2026-08-01",
      effectiveMonth: "2026-08",
      baseSalaryCnyMinor: 500_000,
      username: "mechanic.one",
      password: "Mechanic formal 2026!",
      context: context("req-mechanic"),
    });

    const result = await service.retireRepairTeam({
      teamId: source.id,
      replacementTeamId: replacement.id,
      reason: "班组整合",
      context: context("req-retire"),
    });
    expect(result).toMatchObject({ movedMemberCount: 1, isActive: false });

    const teams = await database.query<{
      current_team_id: number;
      historical_team_id: number;
    }>(
      `select member.current_team_id,
              assignment.team_id as historical_team_id
       from staff_members as member
       join staff_team_assignment_versions as assignment
         on assignment.staff_member_id = member.id
       where member.id = $1`,
      [member.id],
    );
    expect(teams.rows[0]).toEqual({
      current_team_id: replacement.id,
      historical_team_id: source.id,
    });
    const assignments = await database.query<{
      effective_month: string;
      team_id: number;
    }>(
      `select effective_month::text, team_id
       from staff_team_assignment_versions
       where staff_member_id = $1
       order by effective_month`,
      [member.id],
    );
    expect(assignments.rows).toEqual([
      { effective_month: "2026-08-01", team_id: source.id },
      { effective_month: "2026-09-01", team_id: replacement.id },
    ]);
    const retirement = await database.query<{
      replacement_team_id: number;
      reason: string;
    }>(
      `select replacement_team_id, reason
       from repair_team_retirements
       where source_team_id = $1`,
      [source.id],
    );
    expect(retirement.rows[0]).toEqual({
      replacement_team_id: replacement.id,
      reason: "班组整合",
    });
  });

  it("rejects front-desk writes from the service even if the page is bypassed", async () => {
    const frontDeskId = await seedAccount("前台", "front", "front_desk");
    await expect(
      service.createRepairTeam({
        name: "维修一组",
        context: context("req-front-team", frontDeskId),
      }),
    ).rejects.toBeInstanceOf(MasterDataManagementDeniedError);
  });

  it("lets PC roles read active dispatch dictionaries and teams but keeps writes with the super administrator", async () => {
    const frontDeskId = await seedAccount("前台", "front", "front_desk");
    const ownerId = await seedAccount("老板", "owner", "owner");
    const payment = await service.createDictionaryItem({
      category: "payment_method",
      code: "cash",
      labelZh: "现金",
      labelEn: "Cash",
      context: context("req-payment"),
    });
    const team = await service.createRepairTeam({
      name: "维修一组",
      context: context("req-team"),
    });

    await expect(
      service.listDictionaryItems({
        viewerAccountId: frontDeskId,
        category: "payment_method",
        activeOnly: true,
      }),
    ).resolves.toEqual([payment]);
    await expect(
      service.listRepairTeams({ viewerAccountId: ownerId, activeOnly: true }),
    ).resolves.toEqual([team]);
  });

  it("reorders the complete active team set atomically and appends a later team", async () => {
    const first = await service.createRepairTeam({ name: "车间一组", context: context("req-team-1") });
    const second = await service.createRepairTeam({ name: "车间二组", context: context("req-team-2") });
    const third = await service.createRepairTeam({ name: "钣金喷漆", context: context("req-team-3") });

    const reordered = await service.reorderRepairTeams({
      orderedTeamIds: [third.id, first.id, second.id],
      context: context("req-team-reorder"),
    });
    expect(reordered.map((team) => team.id)).toEqual([third.id, first.id, second.id]);
    expect((await service.listRepairTeams({ viewerAccountId: adminId, activeOnly: true }))
      .map((team) => team.id)).toEqual([third.id, first.id, second.id]);

    const fourth = await service.createRepairTeam({ name: "工程机械", context: context("req-team-4") });
    expect((await service.listRepairTeams({ viewerAccountId: adminId, activeOnly: true }))
      .map((team) => team.id)).toEqual([third.id, first.id, second.id, fourth.id]);
    const audits = await database.query<{ before_state: { teamIds: number[] }; after_state: { teamIds: number[] } }>(
      "select before_state, after_state from audit_events where request_id = 'req-team-reorder'",
    );
    expect(audits.rows).toEqual([{
      before_state: { teamIds: [first.id, second.id, third.id] },
      after_state: { teamIds: [third.id, first.id, second.id] },
    }]);
  });

  it("rejects partial, duplicate and non-admin team reorder requests", async () => {
    const first = await service.createRepairTeam({ name: "车间一组", context: context("req-team-1") });
    const second = await service.createRepairTeam({ name: "车间二组", context: context("req-team-2") });
    await expect(service.reorderRepairTeams({
      orderedTeamIds: [first.id], context: context("req-partial"),
    })).rejects.toMatchObject({ code: "repair_team_order_conflict", status: 409 });
    await expect(service.reorderRepairTeams({
      orderedTeamIds: [first.id, first.id], context: context("req-duplicate"),
    })).rejects.toMatchObject({ code: "repair_team_order_conflict", status: 409 });
    const frontDeskId = await seedAccount("前台", "front-reorder", "front_desk");
    await expect(service.reorderRepairTeams({
      orderedTeamIds: [second.id, first.id], context: context("req-front", frontDeskId),
    })).rejects.toBeInstanceOf(MasterDataManagementDeniedError);
  });

  it("saves commission and exchange-rate changes as whole-month versions", async () => {
    await service.setPayrollParameters({
      effectiveMonth: "2026-08",
      commissionRate: "0.100000",
      cnyToJmdRate: "21.500000",
      context: context("req-payroll-aug"),
    });
    await service.setPayrollParameters({
      effectiveMonth: "2026-09",
      commissionRate: "0.120000",
      cnyToJmdRate: "22.000000",
      context: context("req-payroll-sep"),
    });

    await expect(
      service.listPayrollParameters({ viewerAccountId: adminId }),
    ).resolves.toEqual([
      {
        effectiveMonth: "2026-09",
        commissionRate: "0.120000",
        cnyToJmdRate: "22.000000",
      },
      {
        effectiveMonth: "2026-08",
        commissionRate: "0.100000",
        cnyToJmdRate: "21.500000",
      },
    ]);

    await expect(
      service.setPayrollParameters({
        effectiveMonth: "2026-08",
        commissionRate: "0.200000",
        cnyToJmdRate: "23.000000",
        context: context("req-payroll-duplicate"),
      }),
    ).rejects.toMatchObject({ code: "master_data_conflict" });
  });

  it("saves a team special commission rate and a later return to the whole-shop default", async () => {
    const team = await service.createRepairTeam({
      name: "维修一组",
      context: context("req-team"),
    });

    await service.setTeamCommissionRate({
      teamId: team.id,
      effectiveMonth: "2026-08",
      commissionRate: "0.150000",
      context: context("req-team-rate-special"),
    });
    await service.setTeamCommissionRate({
      teamId: team.id,
      effectiveMonth: "2026-10",
      commissionRate: null,
      context: context("req-team-rate-default"),
    });

    await expect(
      service.listTeamCommissionRates({ viewerAccountId: adminId }),
    ).resolves.toEqual([{
      teamId: team.id,
      teamName: "维修一组",
      effectiveMonth: "2026-10",
      commissionRate: null,
    }, {
      teamId: team.id,
      teamName: "维修一组",
      effectiveMonth: "2026-08",
      commissionRate: "0.150000",
    }]);
  });

  it("updates dictionary and team names with versioned audit facts", async () => {
    const payment = await service.createDictionaryItem({
      category: "payment_method",
      code: "bank_transfer",
      labelZh: "银行转账",
      labelEn: "Bank transfer",
      context: context("req-payment-create"),
    });
    const team = await service.createRepairTeam({
      name: "维修一组",
      context: context("req-team-create"),
    });

    await expect(
      service.updateDictionaryItem({
        itemId: payment.id,
        labelZh: "转账",
        labelEn: "Transfer",
        isActive: false,
        sortOrder: 10,
        context: context("req-payment-update"),
      }),
    ).resolves.toMatchObject({
      labelZh: "转账",
      labelEn: "Transfer",
      isActive: false,
      version: 2,
    });
    await expect(
      service.renameRepairTeam({
        teamId: team.id,
        name: "机修一组",
        context: context("req-team-rename"),
      }),
    ).resolves.toMatchObject({ name: "机修一组", version: 2 });

    const audits = await database.query<{ event_type: string }>(
      `select event_type
       from audit_events
       where request_id in ('req-payment-update', 'req-team-rename')
       order by id`,
    );
    expect(audits.rows.map((row) => row.event_type)).toEqual([
      "dictionary_item.updated",
      "repair_team.renamed",
    ]);
  });
});
