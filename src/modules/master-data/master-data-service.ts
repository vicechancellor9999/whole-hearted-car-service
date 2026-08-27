import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { hashPassword } from "@formal/modules/auth/password";
import { toBusinessMonthKey } from "@formal/lib/time";
import { writeAuditEvent } from "@formal/modules/audit/audit-service";
import {
  createDictionaryItemSchema,
  createMechanicSchema,
  createRepairTeamSchema,
  commissionRateSchema,
  monthKeySchema,
  nonnegativeMinorAmountSchema,
  positiveDecimalSchema,
  updateDictionaryItemSchema,
} from "@formal/modules/master-data/master-data-schemas";

export type MasterDataActionContext = {
  actorAccountId: number;
  requestId: string;
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type ManagedDictionaryItem = {
  id: number;
  category: "payment_method" | "charge_unit" | "staff_position";
  code: string;
  labelZh: string;
  labelEn: string | null;
  isActive: boolean;
  sortOrder: number;
  version: number;
};

export type ManagedRepairTeam = {
  id: number;
  teamNo: string;
  name: string;
  isActive: boolean;
  version: number;
};

export type ManagedStaffMember = {
  id: number;
  staffNo: string;
  fullName: string;
  normalizedPhone: string | null;
  accountId: number;
  accountUsername: string;
  positionItemId: number;
  currentTeamId: number;
  status: "active" | "inactive";
  hiredOn: string;
  version: number;
};

export type PayrollParameterVersion = {
  effectiveMonth: string;
  commissionRate: string;
  cnyToJmdRate: string;
};

export type TeamCommissionRateVersion = {
  teamId: number;
  teamName: string;
  effectiveMonth: string;
  commissionRate: string | null;
};

export type StaffMemberListItem = ManagedStaffMember & {
  currentTeamName: string | null;
  positionLabel: string;
  latestBaseSalaryCnyMinor: number | null;
  salaryEffectiveMonth: string | null;
};

type DictionaryRow = {
  id: number;
  category: ManagedDictionaryItem["category"];
  code: string;
  label_zh: string;
  label_en: string | null;
  is_active: boolean;
  sort_order: number;
  version: number;
};

type TeamRow = {
  id: number;
  team_no: string;
  name: string;
  is_active: boolean;
  version: number;
};

type StaffRow = {
  id: number;
  staff_no: string;
  full_name: string;
  normalized_phone: string | null;
  account_id: number;
  position_item_id: number;
  current_team_id: number;
  status: "active" | "inactive";
  hired_on: string;
  version: number;
};

export class MasterDataManagementDeniedError extends Error {
  readonly status = 403;
  readonly code = "master_data_management_denied";

  constructor() {
    super("只有激活的超级管理员可以维护班组、员工和工资参数");
    this.name = "MasterDataManagementDeniedError";
  }
}

export class MasterDataConflictError extends Error {
  readonly status = 409;
  readonly code = "master_data_conflict";

  constructor(message = "编号、名称、手机号或登录名已经存在") {
    super(message);
    this.name = "MasterDataConflictError";
  }
}

export class MasterDataNotFoundError extends Error {
  readonly status = 404;
  readonly code = "master_data_not_found";

  constructor(message = "基础资料不存在或已经停用") {
    super(message);
    this.name = "MasterDataNotFoundError";
  }
}

export class TeamReplacementRequiredError extends Error {
  readonly status = 409;
  readonly code = "team_replacement_required";

  constructor() {
    super("该班组仍有成员，必须选择一个现存维修班组继承");
    this.name = "TeamReplacementRequiredError";
  }
}

export class MasterDataService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async listDictionaryItems(input: {
    viewerAccountId: number;
    category?: ManagedDictionaryItem["category"];
    activeOnly?: boolean;
  }): Promise<ManagedDictionaryItem[]> {
    await requirePcMasterDataReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<DictionaryRow>(
      `select id, category, code, label_zh, label_en, is_active, sort_order, version
       from dictionary_items
       where ($1::dictionary_category is null or category = $1)
         and ($2::boolean is false or is_active = true)
       order by category, sort_order, id`,
      [input.category ?? null, input.activeOnly ?? false],
    );
    return rows.map(mapDictionary);
  }

  async listRepairTeams(input: {
    viewerAccountId: number;
    activeOnly?: boolean;
  }): Promise<ManagedRepairTeam[]> {
    await requirePcMasterDataReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<TeamRow>(
      `select id, team_no, name, is_active, version
       from repair_teams
       where ($1::boolean is false or is_active = true)
       order by name, id`,
      [input.activeOnly ?? false],
    );
    return rows.map(mapTeam);
  }

  async listPayrollParameters(input: {
    viewerAccountId: number;
  }): Promise<PayrollParameterVersion[]> {
    await requirePayrollReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<{
      effective_month: string;
      commission_rate: string;
      cny_to_jmd_rate: string;
    }>(
      `select effective_month::text, commission_rate::text, cny_to_jmd_rate::text
       from payroll_parameter_versions
       order by effective_month desc`,
    );
    return rows.map((row) => ({
      effectiveMonth: row.effective_month.slice(0, 7),
      commissionRate: row.commission_rate,
      cnyToJmdRate: row.cny_to_jmd_rate,
    }));
  }

  async listTeamCommissionRates(input: {
    viewerAccountId: number;
  }): Promise<TeamCommissionRateVersion[]> {
    await requirePayrollReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<{
      team_id: number;
      team_name: string;
      effective_month: string;
      commission_rate: string | null;
    }>(
      `select version.team_id, team.name as team_name,
              version.effective_month::text,
              version.commission_rate::text
       from team_commission_rate_versions as version
       join repair_teams as team on team.id = version.team_id
       order by version.effective_month desc, version.team_id`,
    );
    return rows.map((row) => ({
      teamId: Number(row.team_id),
      teamName: row.team_name,
      effectiveMonth: row.effective_month.slice(0, 7),
      commissionRate: row.commission_rate,
    }));
  }

  async listStaffMembers(input: {
    viewerAccountId: number;
  }): Promise<StaffMemberListItem[]> {
    const viewerRole = await requirePcMasterDataReader(
      this.database,
      input.viewerAccountId,
    );
    const canReadSalary = viewerRole === "super_admin" || viewerRole === "owner";
    const rows = await this.database.query<StaffRow & {
      account_username: string;
      current_team_name: string | null;
      position_label: string;
      latest_base_salary_cny_minor: number | null;
      salary_effective_month: string | null;
    }>(
      `select member.id, member.staff_no, member.full_name,
              member.normalized_phone, member.account_id,
              account.normalized_username as account_username,
              member.position_item_id, member.current_team_id,
              member.status, member.hired_on::text, member.version,
              team.name as current_team_name,
              position.label_zh as position_label,
              case when $1::boolean then salary.base_salary_cny_minor end
                as latest_base_salary_cny_minor,
              case when $1::boolean then salary.effective_month::text end
                as salary_effective_month
       from staff_members as member
       join staff_accounts as account on account.id = member.account_id
       join dictionary_items as position on position.id = member.position_item_id
       left join repair_teams as team on team.id = member.current_team_id
       left join lateral (
         select version.base_salary_cny_minor, version.effective_month
         from employee_salary_versions as version
         where version.staff_member_id = member.id
         order by version.effective_month desc
         limit 1
       ) as salary on true
       order by member.status, member.full_name, member.id`,
      [canReadSalary],
    );
    return rows.map((row) => ({
      ...mapStaff(row),
      accountUsername: row.account_username,
      currentTeamName: row.current_team_name,
      positionLabel: row.position_label,
      latestBaseSalaryCnyMinor: row.latest_base_salary_cny_minor == null
        ? null
        : Number(row.latest_base_salary_cny_minor),
      salaryEffectiveMonth: row.salary_effective_month?.slice(0, 7) ?? null,
    }));
  }

  async createDictionaryItem(input: {
    category: ManagedDictionaryItem["category"];
    code: string;
    labelZh: string;
    labelEn?: string;
    context: MasterDataActionContext;
  }): Promise<ManagedDictionaryItem> {
    const fields = createDictionaryItemSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireSuperAdmin(transaction, input.context.actorAccountId);
        const rows = await transaction.query<DictionaryRow>(
          `insert into dictionary_items
            (category, code, label_zh, label_en, created_at, updated_at, created_by)
           values ($1::dictionary_category, $2, $3, $4, $5, $5, $6)
           returning id, category, code, label_zh, label_en, is_active, sort_order, version`,
          [
            fields.category,
            fields.code,
            fields.labelZh,
            fields.labelEn,
            now,
            input.context.actorAccountId,
          ],
        );
        const item = mapDictionary(rows[0]);
        await writeContextAudit(transaction, input.context, now, {
          eventType: "dictionary_item.created",
          objectType: "dictionary_item",
          objectId: String(item.id),
          after: item,
        });
        return item;
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async createRepairTeam(input: {
    name: string;
    context: MasterDataActionContext;
  }): Promise<ManagedRepairTeam> {
    const fields = createRepairTeamSchema.parse(input);
    const now = input.context.now ?? new Date();
    const normalizedName = normalizeName(fields.name);
    try {
      return await this.database.transaction(async (transaction) => {
        await requireSuperAdmin(transaction, input.context.actorAccountId);
        await transaction.query("lock table repair_teams in share row exclusive mode");
        const teamNo = await nextFormalNumber(
          transaction,
          "repair_teams",
          "team_no",
          "TEAM",
          toBusinessMonthKey(now),
        );
        const rows = await transaction.query<TeamRow>(
          `insert into repair_teams
            (team_no, name, normalized_name, created_at, updated_at, created_by)
           values ($1, $2, $3, $4, $4, $5)
           returning id, team_no, name, is_active, version`,
          [teamNo, fields.name, normalizedName, now, input.context.actorAccountId],
        );
        const team = mapTeam(rows[0]);
        await writeContextAudit(transaction, input.context, now, {
          eventType: "repair_team.created",
          objectType: "repair_team",
          objectId: String(team.id),
          after: team,
        });
        return team;
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async updateDictionaryItem(input: {
    itemId: number;
    labelZh: string;
    labelEn?: string;
    isActive: boolean;
    sortOrder: number;
    context: MasterDataActionContext;
  }): Promise<ManagedDictionaryItem> {
    const fields = updateDictionaryItemSchema.parse(input);
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireSuperAdmin(transaction, input.context.actorAccountId);
      const existing = await transaction.query<DictionaryRow>(
        `select id, category, code, label_zh, label_en, is_active, sort_order, version
         from dictionary_items
         where id = $1
         for update`,
        [input.itemId],
      );
      if (!existing[0]) throw new MasterDataNotFoundError("字典项目不存在");
      const before = mapDictionary(existing[0]);
      const updated = await transaction.query<DictionaryRow>(
        `update dictionary_items
         set label_zh = $2,
             label_en = $3,
             is_active = $4,
             sort_order = $5,
             updated_at = $6,
             version = version + 1
         where id = $1
         returning id, category, code, label_zh, label_en, is_active, sort_order, version`,
        [
          input.itemId,
          fields.labelZh,
          fields.labelEn,
          fields.isActive,
          fields.sortOrder,
          now,
        ],
      );
      const after = mapDictionary(updated[0]);
      await writeContextAudit(transaction, input.context, now, {
        eventType: "dictionary_item.updated",
        objectType: "dictionary_item",
        objectId: String(input.itemId),
        before,
        after,
      });
      return after;
    });
  }

  async renameRepairTeam(input: {
    teamId: number;
    name: string;
    context: MasterDataActionContext;
  }): Promise<ManagedRepairTeam> {
    const fields = createRepairTeamSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireSuperAdmin(transaction, input.context.actorAccountId);
        const existing = await transaction.query<TeamRow>(
          `select id, team_no, name, is_active, version
           from repair_teams
           where id = $1
           for update`,
          [input.teamId],
        );
        if (!existing[0]) throw new MasterDataNotFoundError("维修班组不存在");
        const before = mapTeam(existing[0]);
        const updated = await transaction.query<TeamRow>(
          `update repair_teams
           set name = $2,
               normalized_name = $3,
               updated_at = $4,
               version = version + 1
           where id = $1
           returning id, team_no, name, is_active, version`,
          [input.teamId, fields.name, normalizeName(fields.name), now],
        );
        const after = mapTeam(updated[0]);
        await writeContextAudit(transaction, input.context, now, {
          eventType: "repair_team.renamed",
          objectType: "repair_team",
          objectId: String(input.teamId),
          before,
          after,
        });
        return after;
      });
    } catch (error) {
      rethrowConflict(error, "维修班组名称已经存在");
    }
  }

  async createMechanic(input: {
    fullName: string;
    phone: string;
    positionItemId: number;
    teamId: number;
    hiredOn: string;
    effectiveMonth: string;
    baseSalaryCnyMinor: number;
    username: string;
    password: string;
    context: MasterDataActionContext;
  }): Promise<ManagedStaffMember> {
    const fields = createMechanicSchema.parse(input);
    const passwordHash = await hashPassword(fields.password);
    const now = input.context.now ?? new Date();
    const effectiveMonth = `${fields.effectiveMonth}-01`;

    try {
      return await this.database.transaction(async (transaction) => {
        await requireSuperAdmin(transaction, input.context.actorAccountId);
        const referenceRows = await transaction.query<{
          team_exists: boolean;
          position_exists: boolean;
        }>(
          `select
             exists(
               select 1 from repair_teams
               where id = $1 and is_active = true
             ) as team_exists,
             exists(
               select 1 from dictionary_items
               where id = $2
                 and category = 'staff_position'
                 and is_active = true
             ) as position_exists`,
          [fields.teamId, fields.positionItemId],
        );
        if (!referenceRows[0]?.team_exists || !referenceRows[0]?.position_exists) {
          throw new MasterDataNotFoundError("维修班组或员工岗位不存在或已经停用");
        }

        await transaction.query("lock table staff_members in share row exclusive mode");
        const staffNo = await nextFormalNumber(
          transaction,
          "staff_members",
          "staff_no",
          "STAFF",
          toBusinessMonthKey(now),
        );
        const accounts = await transaction.query<{ id: number }>(
          `insert into staff_accounts
            (display_name, normalized_username, password_hash, role,
             is_active, must_change_password, session_epoch, created_at,
             updated_at, created_by, version)
           values ($1, $2, $3, 'mechanic', true, true, 1, $4, $4, $5, 1)
           returning id`,
          [
            fields.fullName,
            fields.username,
            passwordHash,
            now,
            input.context.actorAccountId,
          ],
        );
        const accountId = Number(accounts[0].id);
        const members = await transaction.query<StaffRow>(
          `insert into staff_members
            (staff_no, full_name, normalized_phone, account_id,
             position_item_id, current_team_id, status, hired_on,
             created_at, updated_at, created_by, version)
           values ($1, $2, $3, $4, $5, $6, 'active', $7::date,
                   $8, $8, $9, 1)
           returning id, staff_no, full_name, normalized_phone, account_id,
                     position_item_id, current_team_id, status,
                     hired_on::text, version`,
          [
            staffNo,
            fields.fullName,
            fields.phone,
            accountId,
            fields.positionItemId,
            fields.teamId,
            fields.hiredOn,
            now,
            input.context.actorAccountId,
          ],
        );
        const member = {
          ...mapStaff(members[0]),
          accountUsername: fields.username,
        };
        await transaction.query(
          `insert into staff_team_assignment_versions
            (staff_member_id, effective_month, team_id, set_by, created_at)
           values ($1, $2::date, $3, $4, $5)`,
          [member.id, effectiveMonth, fields.teamId, input.context.actorAccountId, now],
        );
        await transaction.query(
          `insert into employee_salary_versions
            (staff_member_id, effective_month, base_salary_cny_minor, set_by, created_at)
           values ($1, $2::date, $3, $4, $5)`,
          [
            member.id,
            effectiveMonth,
            fields.baseSalaryCnyMinor,
            input.context.actorAccountId,
            now,
          ],
        );
        await writeContextAudit(transaction, input.context, now, {
          eventType: "account.created",
          objectType: "staff_account",
          objectId: String(accountId),
          after: {
            displayName: fields.fullName,
            normalizedUsername: fields.username,
            role: "mechanic",
            isActive: true,
            mustChangePassword: true,
          },
        });
        await writeContextAudit(transaction, input.context, now, {
          eventType: "staff.created",
          objectType: "staff_member",
          objectId: String(member.id),
          after: {
            ...member,
            effectiveMonth: fields.effectiveMonth,
            baseSalaryCnyMinor: fields.baseSalaryCnyMinor,
          },
        });
        return member;
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async retireRepairTeam(input: {
    teamId: number;
    replacementTeamId?: number;
    reason: string;
    context: MasterDataActionContext;
  }): Promise<ManagedRepairTeam & { movedMemberCount: number }> {
    const reason = input.reason.trim();
    if (!reason) throw new Error("班组停用原因不能为空");
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      await requireSuperAdmin(transaction, input.context.actorAccountId);
      const rows = await transaction.query<TeamRow>(
        `select id, team_no, name, is_active, version
         from repair_teams
         where id = $1 or id = $2
         order by id
         for update`,
        [input.teamId, input.replacementTeamId ?? null],
      );
      const source = rows.find((row) => Number(row.id) === input.teamId);
      if (!source?.is_active) throw new MasterDataNotFoundError("来源班组不存在或已经停用");
      const replacement = input.replacementTeamId == null
        ? undefined
        : rows.find((row) => Number(row.id) === input.replacementTeamId);
      if (input.replacementTeamId != null && !replacement?.is_active) {
        throw new MasterDataNotFoundError("继承班组不存在或已经停用");
      }
      if (replacement && Number(replacement.id) === input.teamId) {
        throw new MasterDataConflictError("班组不能继承自己");
      }

      const counts = await transaction.query<{ member_count: number }>(
        `select count(*)::integer as member_count
         from staff_members
         where current_team_id = $1
           and status = 'active'`,
        [input.teamId],
      );
      const memberCount = Number(counts[0]?.member_count ?? 0);
      if (memberCount > 0 && !replacement) {
        throw new TeamReplacementRequiredError();
      }

      await transaction.query(
        `insert into repair_team_retirements
          (source_team_id, replacement_team_id, reason, retired_at, retired_by)
         values ($1, $2, $3, $4, $5)`,
        [
          input.teamId,
          replacement ? Number(replacement.id) : null,
          reason,
          now,
          input.context.actorAccountId,
        ],
      );
      const nextAssignmentMonth = replacement
        ? nextMonthStart(toBusinessMonthKey(now))
        : null;
      if (replacement && nextAssignmentMonth) {
        const conflictingAssignments = await transaction.query<{ id: number }>(
          `select member.id
           from staff_members as member
           join staff_team_assignment_versions as assignment
             on assignment.staff_member_id = member.id
            and assignment.effective_month = $3::date
           where member.current_team_id = $1
             and member.status = 'active'
             and assignment.team_id <> $2
           limit 1`,
          [input.teamId, Number(replacement.id), nextAssignmentMonth],
        );
        if (conflictingAssignments[0]) {
          throw new MasterDataConflictError(
            "班组成员已经有不同的下月归属，请先处理该月份安排",
          );
        }
        await transaction.query(
          `insert into staff_team_assignment_versions
            (staff_member_id, effective_month, team_id, set_by, created_at)
           select member.id, $3::date, $2, $4, $5
           from staff_members as member
           where member.current_team_id = $1
             and member.status = 'active'
           on conflict (staff_member_id, effective_month) do nothing`,
          [
            input.teamId,
            Number(replacement.id),
            nextAssignmentMonth,
            input.context.actorAccountId,
            now,
          ],
        );
      }
      const moved = replacement
        ? await transaction.query<{ id: number }>(
            `update staff_members
             set current_team_id = $2,
                 updated_at = $3,
                 version = version + 1
             where current_team_id = $1
               and status = 'active'
             returning id`,
            [input.teamId, Number(replacement.id), now],
          )
        : [];
      const updated = await transaction.query<TeamRow>(
        `update repair_teams
         set is_active = false,
             updated_at = $2,
             version = version + 1
         where id = $1
         returning id, team_no, name, is_active, version`,
        [input.teamId, now],
      );
      const after = mapTeam(updated[0]);
      await writeContextAudit(transaction, input.context, now, {
        eventType: "repair_team.retired",
        objectType: "repair_team",
        objectId: String(input.teamId),
        reason,
        before: mapTeam(source),
        after: {
          ...after,
          replacementTeamId: replacement ? Number(replacement.id) : null,
          nextAssignmentMonth,
          movedMemberCount: moved.length,
        },
      });
      return { ...after, movedMemberCount: moved.length };
    });
  }

  async setEmployeeSalary(input: {
    staffMemberId: number;
    effectiveMonth: string;
    baseSalaryCnyMinor: number;
    context: MasterDataActionContext;
  }): Promise<void> {
    const effectiveMonth = `${monthKeySchema.parse(input.effectiveMonth)}-01`;
    const amount = nonnegativeMinorAmountSchema.parse(input.baseSalaryCnyMinor);
    const now = input.context.now ?? new Date();
    try {
      await this.database.transaction(async (transaction) => {
        await requireSuperAdmin(transaction, input.context.actorAccountId);
        const members = await transaction.query<{ id: number }>(
          "select id from staff_members where id = $1 for update",
          [input.staffMemberId],
        );
        if (!members[0]) throw new MasterDataNotFoundError("员工不存在");
        await transaction.query(
          `insert into employee_salary_versions
            (staff_member_id, effective_month, base_salary_cny_minor, set_by, created_at)
           values ($1, $2::date, $3, $4, $5)`,
          [input.staffMemberId, effectiveMonth, amount, input.context.actorAccountId, now],
        );
        await writeContextAudit(transaction, input.context, now, {
          eventType: "staff.salary_version_created",
          objectType: "staff_member",
          objectId: String(input.staffMemberId),
          after: { effectiveMonth: input.effectiveMonth, baseSalaryCnyMinor: amount },
        });
      });
    } catch (error) {
      rethrowConflict(error, "该员工在这个月份已经有工资版本");
    }
  }

  async setPayrollParameters(input: {
    effectiveMonth: string;
    commissionRate: string;
    cnyToJmdRate: string;
    context: MasterDataActionContext;
  }): Promise<PayrollParameterVersion> {
    const effectiveMonth = monthKeySchema.parse(input.effectiveMonth);
    const commissionRate = commissionRateSchema.parse(input.commissionRate);
    const cnyToJmdRate = positiveDecimalSchema.parse(input.cnyToJmdRate);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireSuperAdmin(transaction, input.context.actorAccountId);
        const rows = await transaction.query<{
          effective_month: string;
          commission_rate: string;
          cny_to_jmd_rate: string;
        }>(
          `insert into payroll_parameter_versions
            (effective_month, commission_rate, cny_to_jmd_rate, set_by, created_at)
           values ($1::date, $2::numeric, $3::numeric, $4, $5)
           returning effective_month::text, commission_rate::text,
                     cny_to_jmd_rate::text`,
          [
            `${effectiveMonth}-01`,
            commissionRate,
            cnyToJmdRate,
            input.context.actorAccountId,
            now,
          ],
        );
        const version = {
          effectiveMonth,
          commissionRate: rows[0].commission_rate,
          cnyToJmdRate: rows[0].cny_to_jmd_rate,
        };
        await writeContextAudit(transaction, input.context, now, {
          eventType: "payroll.parameters_version_created",
          objectType: "payroll_month",
          objectId: effectiveMonth,
          after: version,
        });
        return version;
      });
    } catch (error) {
      rethrowConflict(error, "这个月份已经有提成比例和汇率版本");
    }
  }

  async setTeamCommissionRate(input: {
    teamId: number;
    effectiveMonth: string;
    commissionRate: string | null;
    context: MasterDataActionContext;
  }): Promise<TeamCommissionRateVersion> {
    const effectiveMonth = monthKeySchema.parse(input.effectiveMonth);
    const commissionRate = input.commissionRate === null
      ? null
      : commissionRateSchema.parse(input.commissionRate);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireSuperAdmin(transaction, input.context.actorAccountId);
        const teams = await transaction.query<{ id: number; name: string }>(
          `select id, name
           from repair_teams
           where id = $1 and is_active = true
           for update`,
          [input.teamId],
        );
        const team = teams[0];
        if (!team) throw new MasterDataNotFoundError("维修组不存在或已经停用");
        const rows = await transaction.query<{
          team_id: number;
          effective_month: string;
          commission_rate: string | null;
        }>(
          `insert into team_commission_rate_versions
            (team_id, effective_month, commission_rate, set_by, created_at)
           values ($1, $2::date, $3::numeric, $4, $5)
           returning team_id, effective_month::text, commission_rate::text`,
          [
            input.teamId,
            `${effectiveMonth}-01`,
            commissionRate,
            input.context.actorAccountId,
            now,
          ],
        );
        const version = {
          teamId: Number(rows[0].team_id),
          teamName: team.name,
          effectiveMonth,
          commissionRate: rows[0].commission_rate,
        };
        await writeContextAudit(transaction, input.context, now, {
          eventType: commissionRate === null
            ? "payroll.team_commission_default_restored"
            : "payroll.team_commission_version_created",
          objectType: "repair_team",
          objectId: String(input.teamId),
          after: version,
        });
        return version;
      });
    } catch (error) {
      rethrowConflict(error, "这个维修组在该月份已经有提成比例版本");
    }
  }
}

async function requireSuperAdmin(
  executor: AuthSqlExecutor,
  accountId: number,
): Promise<void> {
  const rows = await executor.query<{ allowed: boolean }>(
    `select true as allowed
     from staff_accounts
     where id = $1
       and role = 'super_admin'
       and is_active = true
     for update`,
    [accountId],
  );
  if (!rows[0]?.allowed) throw new MasterDataManagementDeniedError();
}

async function requirePcMasterDataReader(
  executor: AuthSqlExecutor,
  accountId: number,
): Promise<"super_admin" | "front_desk" | "owner"> {
  const rows = await executor.query<{
    role: "super_admin" | "front_desk" | "owner";
  }>(
    `select role
     from staff_accounts
     where id = $1
       and is_active = true
       and role in ('super_admin', 'front_desk', 'owner')
     limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new MasterDataManagementDeniedError();
  return rows[0].role;
}

async function requirePayrollReader(
  executor: AuthSqlExecutor,
  accountId: number,
): Promise<void> {
  const rows = await executor.query<{ allowed: boolean }>(
    `select true as allowed
     from staff_accounts
     where id = $1
       and is_active = true
       and role in ('super_admin', 'owner')
     limit 1`,
    [accountId],
  );
  if (!rows[0]?.allowed) throw new MasterDataManagementDeniedError();
}

async function nextFormalNumber(
  executor: AuthSqlExecutor,
  table: "repair_teams" | "staff_members",
  column: "team_no" | "staff_no",
  prefix: "TEAM" | "STAFF",
  monthKey: string,
): Promise<string> {
  const month = monthKey.replace("-", "");
  const numberPrefix = `${prefix}-${month}-`;
  const rows = await executor.query<{ current_number: number }>(
    `select coalesce(max(right(${column}, 4)::integer), 0)::integer as current_number
     from ${table}
     where ${column} like $1`,
    [`${numberPrefix}%`],
  );
  const next = Number(rows[0]?.current_number ?? 0) + 1;
  if (next > 9_999) throw new MasterDataConflictError("本月正式编号已经用尽");
  return `${numberPrefix}${String(next).padStart(4, "0")}`;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function nextMonthStart(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function mapDictionary(row: DictionaryRow | undefined): ManagedDictionaryItem {
  if (!row) throw new Error("字典写入后无法读取");
  return {
    id: Number(row.id),
    category: row.category,
    code: row.code,
    labelZh: row.label_zh,
    labelEn: row.label_en,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    version: row.version,
  };
}

function mapTeam(row: TeamRow | undefined): ManagedRepairTeam {
  if (!row) throw new Error("班组写入后无法读取");
  return {
    id: Number(row.id),
    teamNo: row.team_no,
    name: row.name,
    isActive: row.is_active,
    version: row.version,
  };
}

function mapStaff(row: StaffRow | undefined): Omit<ManagedStaffMember, "accountUsername"> {
  if (!row) throw new Error("员工写入后无法读取");
  return {
    id: Number(row.id),
    staffNo: row.staff_no,
    fullName: row.full_name,
    normalizedPhone: row.normalized_phone,
    accountId: Number(row.account_id),
    positionItemId: Number(row.position_item_id),
    currentTeamId: Number(row.current_team_id),
    status: row.status,
    hiredOn: row.hired_on,
    version: row.version,
  };
}

async function writeContextAudit(
  executor: AuthSqlExecutor,
  context: MasterDataActionContext,
  now: Date,
  event: {
    eventType: string;
    objectType: string;
    objectId: string;
    reason?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  },
) {
  await writeAuditEvent(executor, {
    occurredAt: now,
    actorAccountId: context.actorAccountId,
    eventType: event.eventType,
    objectType: event.objectType,
    objectId: event.objectId,
    reason: event.reason,
    before: event.before,
    after: event.after,
    requestId: context.requestId,
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });
}

function rethrowConflict(error: unknown, message?: string): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    throw new MasterDataConflictError(message);
  }
  throw error;
}
