import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationPaths = [
  resolve(process.cwd(), "drizzle/0000_foundation.sql"),
  resolve(process.cwd(), "drizzle/0001_account_permissions.sql"),
  resolve(process.cwd(), "drizzle/0002_master_data.sql"),
];

let database: PGlite;

async function seedAdmin() {
  const result = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role,
       must_change_password)
     values ('超级管理员', 'admin', 'test-hash', 'super_admin', false)
     returning id`,
  );
  return Number(result.rows[0].id);
}

async function seedPosition(adminId: number) {
  const result = await database.query<{ id: number }>(
    `insert into dictionary_items
      (category, code, label_zh, label_en, created_by)
     values ('staff_position', 'mechanic', '维修工', 'Mechanic', $1)
     returning id`,
    [adminId],
  );
  return Number(result.rows[0].id);
}

async function seedTeam(teamNo: string, name: string, adminId: number) {
  const result = await database.query<{ id: number }>(
    `insert into repair_teams
      (team_no, name, normalized_name, created_by)
     values ($1, $2, lower($2), $3)
     returning id`,
    [teamNo, name, adminId],
  );
  return Number(result.rows[0].id);
}

describe("master data schema", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
  });

  afterEach(async () => {
    await database.close();
  });

  it("creates the formal dictionary, team, employee and monthly version tables", async () => {
    const result = await database.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name in (
           'dictionary_items', 'repair_teams', 'repair_team_retirements',
           'staff_members', 'staff_team_assignment_versions',
           'employee_salary_versions', 'payroll_parameter_versions'
         )
       order by table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "dictionary_items",
      "employee_salary_versions",
      "payroll_parameter_versions",
      "repair_team_retirements",
      "repair_teams",
      "staff_members",
      "staff_team_assignment_versions",
    ]);
  });

  it("keeps dictionary codes, team numbers, names and employee accounts unique", async () => {
    const adminId = await seedAdmin();
    const positionId = await seedPosition(adminId);
    const teamId = await seedTeam("TEAM-202608-0001", "维修一组", adminId);

    await expect(
      database.query(
        `insert into dictionary_items
          (category, code, label_zh, created_by)
         values ('staff_position', 'mechanic', '另一维修工', $1)`,
        [adminId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      seedTeam("TEAM-202608-0002", "维修一组", adminId),
    ).rejects.toMatchObject({ code: "23505" });

    const account = await database.query<{ id: number }>(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role,
         must_change_password)
       values ('维修工一号', 'mechanic.one', 'test-hash', 'mechanic', false)
       returning id`,
    );
    await database.query(
      `insert into staff_members
        (staff_no, full_name, normalized_phone, account_id,
         position_item_id, current_team_id, hired_on, created_by)
       values ('STAFF-202608-0001', '维修工一号', '+18765550101', $1,
               $2, $3, date '2026-08-01', $4)`,
      [account.rows[0].id, positionId, teamId, adminId],
    );
    await expect(
      database.query(
        `insert into staff_members
          (staff_no, full_name, account_id, position_item_id, hired_on, created_by)
         values ('STAFF-202608-0002', '重复账号员工', $1, $2,
                 date '2026-08-02', $3)`,
        [account.rows[0].id, positionId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("preserves team retirement as one fact and rejects self inheritance", async () => {
    const adminId = await seedAdmin();
    const firstTeamId = await seedTeam("TEAM-202608-0001", "维修一组", adminId);
    const secondTeamId = await seedTeam("TEAM-202608-0002", "维修二组", adminId);

    await expect(
      database.query(
        `insert into repair_team_retirements
          (source_team_id, replacement_team_id, reason, retired_by)
         values ($1, $1, '自继承无效', $2)`,
        [firstTeamId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    await database.query(
      `insert into repair_team_retirements
        (source_team_id, replacement_team_id, reason, retired_by)
       values ($1, $2, '班组整合', $3)`,
      [firstTeamId, secondTeamId, adminId],
    );
    await expect(
      database.query(
        `insert into repair_team_retirements
          (source_team_id, replacement_team_id, reason, retired_by)
         values ($1, $2, '再次覆盖', $3)`,
        [firstTeamId, secondTeamId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("enforces whole-month salary, team and payroll parameter versions", async () => {
    const adminId = await seedAdmin();
    const positionId = await seedPosition(adminId);
    const teamId = await seedTeam("TEAM-202608-0001", "维修一组", adminId);
    const member = await database.query<{ id: number }>(
      `insert into staff_members
        (staff_no, full_name, position_item_id, current_team_id,
         hired_on, created_by)
       values ('STAFF-202608-0001', '维修工一号', $1, $2,
               date '2026-08-01', $3)
       returning id`,
      [positionId, teamId, adminId],
    );
    const memberId = Number(member.rows[0].id);

    await database.query(
      `insert into staff_team_assignment_versions
        (staff_member_id, team_id, effective_month, set_by)
       values ($1, $2, date '2026-08-01', $3)`,
      [memberId, teamId, adminId],
    );
    await database.query(
      `insert into employee_salary_versions
        (staff_member_id, effective_month, base_salary_cny_minor, set_by)
       values ($1, date '2026-08-01', 500000, $2)`,
      [memberId, adminId],
    );
    await database.query(
      `insert into payroll_parameter_versions
        (effective_month, commission_rate, cny_to_jmd_rate, set_by)
       values (date '2026-08-01', 0.100000, 21.500000, $1)`,
      [adminId],
    );

    await expect(
      database.query(
        `insert into employee_salary_versions
          (staff_member_id, effective_month, base_salary_cny_minor, set_by)
         values ($1, date '2026-08-15', 600000, $2)`,
        [memberId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.query(
        `insert into payroll_parameter_versions
          (effective_month, commission_rate, cny_to_jmd_rate, set_by)
         values (date '2026-09-01', 0, 21.500000, $1)`,
        [adminId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.query(
        `insert into employee_salary_versions
          (staff_member_id, effective_month, base_salary_cny_minor, set_by)
         values ($1, date '2026-09-01', -1, $2)`,
        [memberId, adminId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
