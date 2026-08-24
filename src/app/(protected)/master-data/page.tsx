import { connection } from "next/server";
import type {
  ManagedDictionaryItem,
  ManagedRepairTeam,
  PayrollParameterVersion,
} from "@/modules/master-data/master-data-service";
import { createMasterDataRuntime } from "@/modules/master-data/master-data-runtime";
import { currentSession } from "@/modules/auth/current-session";
import { hasPermission } from "@/modules/permissions/permissions";
import { requirePermission } from "@/modules/permissions/require-permission";
import { masterDataAction } from "@/app/(protected)/master-data/actions";

const categoryLabels = {
  payment_method: "支付方式",
  charge_unit: "收费单位",
  staff_position: "员工岗位",
} as const;

type MasterDataFormAction = (formData: FormData) => void | Promise<void>;

export function MasterDataView({
  dictionaries,
  teams,
  payroll,
  canManage,
  showPayroll = true,
  success,
  error,
  action = masterDataAction,
}: {
  dictionaries: ManagedDictionaryItem[];
  teams: ManagedRepairTeam[];
  payroll: PayrollParameterVersion[];
  canManage: boolean;
  showPayroll?: boolean;
  success?: string;
  error?: string;
  action?: MasterDataFormAction;
}) {
  return (
    <section className="master-data-workspace" aria-labelledby="master-data-title">
      <header className="section-heading">
        <div>
          <p className="eyebrow">系统 · 正式基础资料</p>
          <h1 id="master-data-title">基础资料</h1>
          <p>字典、维修班组和整月参数由真实后端保存；停用班组时明确选择继承关系。</p>
        </div>
      </header>

      {success ? <p className="form-alert success-alert">{success}</p> : null}
      {error ? <p className="form-alert">{error}</p> : null}

      <section className="master-data-card" aria-labelledby="dictionary-title">
        <header className="compact-section-heading">
          <div>
            <h2 id="dictionary-title">业务字典</h2>
            <p>支付方式、收费单位和员工岗位分开维护。</p>
          </div>
        </header>
        {canManage ? (
          <form action={action} className="compact-data-form">
            <input name="operation" type="hidden" value="create_dictionary" />
            <label>类别
              <select name="category" defaultValue="payment_method">
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>代码<input name="code" required placeholder="cash" /></label>
            <label>中文名称<input name="labelZh" required /></label>
            <label>英文名称<input name="labelEn" /></label>
            <button type="submit">添加字典项目</button>
          </form>
        ) : null}
        <div className="dictionary-groups">
          {Object.entries(categoryLabels).map(([category, label]) => (
            <section className="dictionary-group" key={category}>
              <h3>{label}</h3>
              <div className="compact-record-list">
                {dictionaries.filter((item) => item.category === category).map((item) => (
                  canManage ? (
                    <form action={action} className="dictionary-record" key={item.id}>
                      <input name="operation" type="hidden" value="update_dictionary" />
                      <input name="itemId" type="hidden" value={item.id} />
                      <code>{item.code}</code>
                      <input aria-label={`${item.code} 中文名称`} defaultValue={item.labelZh} name="labelZh" required />
                      <input aria-label={`${item.code} 英文名称`} defaultValue={item.labelEn ?? ""} name="labelEn" />
                      <select aria-label={`${item.code} 状态`} defaultValue={String(item.isActive)} name="isActive">
                        <option value="true">启用</option>
                        <option value="false">停用</option>
                      </select>
                      <input aria-label={`${item.code} 排序`} defaultValue={item.sortOrder} min="0" name="sortOrder" type="number" />
                      <button type="submit">保存字典项目</button>
                    </form>
                  ) : (
                    <div className="readonly-record" key={item.id}>
                      <strong>{item.labelZh}</strong>
                      <span>{item.labelEn ?? "—"}</span>
                      <code>{item.code}</code>
                      <span>{item.isActive ? "启用" : "停用"}</span>
                    </div>
                  )
                ))}
                {dictionaries.every((item) => item.category !== category) ? (
                  <p className="empty-inline">尚未添加</p>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="master-data-card" aria-labelledby="teams-title">
        <header className="compact-section-heading">
          <div>
            <h2 id="teams-title">维修班组</h2>
            <p>班组编号固定保留；停用不会改写历史归属。</p>
          </div>
        </header>
        {canManage ? (
          <form action={action} className="compact-data-form team-create-form">
            <input name="operation" type="hidden" value="create_team" />
            <label>班组名称<input name="name" required /></label>
            <button type="submit">添加维修班组</button>
          </form>
        ) : null}
        <div className="team-record-list">
          {teams.map((team) => (
            <article className="team-record" key={team.id}>
              <header>
                <code>{team.teamNo}</code>
                <span className={team.isActive ? "status-active" : "status-inactive"}>
                  {team.isActive ? "启用" : "已停用"}
                </span>
              </header>
              {canManage && team.isActive ? (
                <>
                  <form action={action} className="inline-record-form">
                    <input name="operation" type="hidden" value="rename_team" />
                    <input name="teamId" type="hidden" value={team.id} />
                    <label>班组名称<input defaultValue={team.name} name="name" required /></label>
                    <button type="submit">保存班组名称</button>
                  </form>
                  <form action={action} className="inline-record-form retire-team-form">
                    <input name="operation" type="hidden" value="retire_team" />
                    <input name="teamId" type="hidden" value={team.id} />
                    <label>继承班组
                      <select aria-label="继承班组" defaultValue="" name="replacementTeamId">
                        <option value="">没有成员时可不选</option>
                        {teams.filter((candidate) => candidate.isActive && candidate.id !== team.id).map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>停用原因<input name="reason" required /></label>
                    <button type="submit">停用并继承</button>
                  </form>
                </>
              ) : <h3>{team.name}</h3>}
            </article>
          ))}
          {teams.length === 0 ? <p className="audit-empty">尚未创建维修班组。</p> : null}
        </div>
      </section>

      {showPayroll ? (
        <section className="master-data-card" aria-labelledby="payroll-title">
          <header className="compact-section-heading">
            <div>
              <h2 id="payroll-title">工资月度参数</h2>
              <p>提成比例和 CNY/JMD 汇率按整月新增版本。</p>
            </div>
          </header>
          {canManage ? (
            <form action={action} className="compact-data-form">
              <input name="operation" type="hidden" value="set_payroll" />
              <label>生效月份<input name="effectiveMonth" required type="month" /></label>
              <label>提成比例<input inputMode="decimal" name="commissionRate" placeholder="0.100000" required /></label>
              <label>CNY/JMD 汇率<input inputMode="decimal" name="cnyToJmdRate" placeholder="21.500000" required /></label>
              <button type="submit">保存月度参数</button>
            </form>
          ) : null}
          <div className="readonly-record-list">
            {payroll.map((version) => (
              <div className="readonly-record" key={version.effectiveMonth}>
                <strong>{version.effectiveMonth}</strong>
                <span>提成比例 {version.commissionRate}</span>
                <span>汇率 {version.cnyToJmdRate}</span>
              </div>
            ))}
            {payroll.length === 0 ? <p className="empty-inline">尚未设置月度参数</p> : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}

export default async function MasterDataPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  await connection();
  const session = await currentSession();
  const viewer = requirePermission(session, "master_data.read");
  const canManage = hasPermission(viewer.role, "workforce.manage");
  const showPayroll = viewer.role === "super_admin" || viewer.role === "owner";
  const runtime = createMasterDataRuntime();
  try {
    const [dictionaries, teams, payroll, messages] = await Promise.all([
      runtime.service.listDictionaryItems({ viewerAccountId: viewer.id }),
      runtime.service.listRepairTeams({ viewerAccountId: viewer.id }),
      showPayroll
        ? runtime.service.listPayrollParameters({ viewerAccountId: viewer.id })
        : Promise.resolve([]),
      searchParams,
    ]);
    return (
      <MasterDataView
        canManage={canManage}
        dictionaries={dictionaries}
        error={messages.error}
        payroll={payroll}
        showPayroll={showPayroll}
        success={messages.success}
        teams={teams}
      />
    );
  } finally {
    await runtime.close();
  }
}
