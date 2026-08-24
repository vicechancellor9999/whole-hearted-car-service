import { connection } from "next/server";
import { formatMinorAmount } from "@/lib/money";
import type {
  ManagedDictionaryItem,
  ManagedRepairTeam,
  StaffMemberListItem,
} from "@/modules/master-data/master-data-service";
import { createMasterDataRuntime } from "@/modules/master-data/master-data-runtime";
import { currentSession } from "@/modules/auth/current-session";
import { hasPermission } from "@/modules/permissions/permissions";
import { requirePermission } from "@/modules/permissions/require-permission";
import { masterDataAction } from "@/app/(protected)/master-data/actions";

type EmployeeFormAction = (formData: FormData) => void | Promise<void>;

export function EmployeesView({
  members,
  positions,
  teams,
  canManage,
  success,
  error,
  action = masterDataAction,
}: {
  members: StaffMemberListItem[];
  positions: ManagedDictionaryItem[];
  teams: ManagedRepairTeam[];
  canManage: boolean;
  success?: string;
  error?: string;
  action?: EmployeeFormAction;
}) {
  return (
    <section className="employees-workspace" aria-labelledby="employees-title">
      <header className="section-heading">
        <div>
          <p className="eyebrow">系统 · 班组成员与账号</p>
          <h1 id="employees-title">员工管理</h1>
          <p>员工资料、维修班组、登录账号和整月工资版本在同一个入口维护。</p>
        </div>
      </header>

      {success ? <p className="form-alert success-alert">{success}</p> : null}
      {error ? <p className="form-alert">{error}</p> : null}

      {canManage ? (
        <section className="master-data-card" aria-labelledby="create-mechanic-title">
          <header className="compact-section-heading">
            <div>
              <h2 id="create-mechanic-title">新增维修工与账号</h2>
              <p>一次提交同时建立员工资料、班组归属、基准工资和手机端登录账号。</p>
            </div>
          </header>
          <form action={action} className="employee-create-form">
            <input name="operation" type="hidden" value="create_mechanic" />
            <label>姓名<input name="fullName" required /></label>
            <label>手机号<input inputMode="tel" name="phone" required /></label>
            <label>岗位
              <select name="positionItemId" required defaultValue="">
                <option disabled value="">选择岗位</option>
                {positions.map((position) => <option key={position.id} value={position.id}>{position.labelZh}</option>)}
              </select>
            </label>
            <label>维修班组
              <select name="teamId" required defaultValue="">
                <option disabled value="">选择班组</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label>入职日期<input name="hiredOn" required type="date" /></label>
            <label>工资生效月份<input name="effectiveMonth" required type="month" /></label>
            <label>月标准工资（CNY）
              <input aria-label="月标准工资（CNY）" inputMode="decimal" name="baseSalaryCny" required />
            </label>
            <label>登录名<input aria-label="登录名" autoCapitalize="none" name="username" required /></label>
            <label>初始密码<input aria-label="初始密码" autoComplete="new-password" minLength={12} name="password" required type="password" /></label>
            <button type="submit">创建员工与账号</button>
          </form>
        </section>
      ) : null}

      <div className="employee-list" aria-label="员工列表">
        {members.map((member) => (
          <article className="employee-card" key={member.id}>
            <header>
              <div>
                <h2>{member.fullName}</h2>
                <p>{member.staffNo} · {member.accountUsername}</p>
              </div>
              <span className={member.status === "active" ? "status-active" : "status-inactive"}>
                {member.status === "active" ? "在职" : "停用"}
              </span>
            </header>
            <dl className="employee-facts">
              <div><dt>手机号</dt><dd>{member.normalizedPhone}</dd></div>
              <div><dt>岗位</dt><dd>{member.positionLabel}</dd></div>
              <div><dt>当前班组</dt><dd>{member.currentTeamName ?? "未分组"}</dd></div>
              <div><dt>入职日期</dt><dd>{member.hiredOn}</dd></div>
              <div><dt>当前工资版本</dt><dd>{member.latestBaseSalaryCnyMinor == null ? "仅超级管理员与老板可见" : `CNY ${formatMinorAmount(member.latestBaseSalaryCnyMinor)}`}</dd></div>
              <div><dt>生效月份</dt><dd>{member.salaryEffectiveMonth ?? "—"}</dd></div>
            </dl>
            {canManage ? (
              <form action={action} className="inline-record-form salary-version-form">
                <input name="operation" type="hidden" value="set_salary" />
                <input name="staffMemberId" type="hidden" value={member.id} />
                <label>生效月份<input name="effectiveMonth" required type="month" /></label>
                <label>月标准工资（CNY）<input inputMode="decimal" name="baseSalaryCny" required /></label>
                <button type="submit">新增工资版本</button>
              </form>
            ) : null}
          </article>
        ))}
        {members.length === 0 ? <p className="audit-empty">尚未创建员工。</p> : null}
      </div>
    </section>
  );
}

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  await connection();
  const session = await currentSession();
  const viewer = requirePermission(session, "master_data.read");
  const canManage = hasPermission(viewer.role, "workforce.manage");
  const runtime = createMasterDataRuntime();
  try {
    const [members, positions, teams, messages] = await Promise.all([
      runtime.service.listStaffMembers({ viewerAccountId: viewer.id }),
      runtime.service.listDictionaryItems({
        viewerAccountId: viewer.id,
        category: "staff_position",
        activeOnly: true,
      }),
      runtime.service.listRepairTeams({ viewerAccountId: viewer.id, activeOnly: true }),
      searchParams,
    ]);
    return (
      <EmployeesView
        canManage={canManage}
        error={messages.error}
        members={members}
        positions={positions}
        success={messages.success}
        teams={teams}
      />
    );
  } finally {
    await runtime.close();
  }
}
