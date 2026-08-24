import { connection } from "next/server";
import type { ManagedAccount } from "@/modules/accounts/account-service";
import { createAccountRuntime } from "@/modules/accounts/account-runtime";
import { currentSession } from "@/modules/auth/current-session";
import { requirePermission } from "@/modules/permissions/require-permission";
import { accountManagementAction } from "@/app/(protected)/settings/accounts/actions";

const roleLabels = {
  super_admin: "超级管理员",
  front_desk: "前台",
  owner: "老板只读",
  mechanic: "维修工手机端",
} as const;

type AccountFormAction = (formData: FormData) => void | Promise<void>;

export function AccountManagementView({
  accounts,
  success,
  error,
  action = accountManagementAction,
}: {
  accounts: ManagedAccount[];
  success?: string;
  error?: string;
  action?: AccountFormAction;
}) {
  return (
    <section className="accounts-workspace" aria-labelledby="accounts-title">
      <header className="section-heading">
        <div>
          <p className="eyebrow">系统设置 · 登录与权限</p>
          <h1 id="accounts-title">账号管理</h1>
          <p>账号只停用、不删除；角色、密码、会话和前台敏感权限均由后端记录审计。</p>
        </div>
      </header>

      {success ? <p className="form-alert success-alert">{success}</p> : null}
      {error ? <p className="form-alert">{error}</p> : null}

      <section className="account-create-card" aria-labelledby="create-account-title">
        <h2 id="create-account-title">新增账号</h2>
        <form action={action} className="account-create-form">
          <input name="operation" type="hidden" value="create" />
          <label>
            显示名
            <input name="displayName" required maxLength={120} />
          </label>
          <label>
            登录名
            <input name="username" required maxLength={120} autoCapitalize="none" />
          </label>
          <label>
            初始密码
            <input
              name="password"
              required
              minLength={12}
              maxLength={1_024}
              type="password"
              autoComplete="new-password"
            />
          </label>
          <label>
            新账号角色
            <select name="role" defaultValue="front_desk" aria-label="新账号角色">
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button className="primary-action compact-action" type="submit">创建账号</button>
        </form>
      </section>

      <div className="account-list" aria-label="现有账号">
        {accounts.map((account) => (
          <AccountCard account={account} action={action} key={account.id} />
        ))}
      </div>
    </section>
  );
}

function AccountCard({
  account,
  action,
}: {
  account: ManagedAccount;
  action: AccountFormAction;
}) {
  const sensitiveEnabled = account.delegatedPermissions.includes(
    "sensitive_operations.execute",
  );

  return (
    <article className="account-card">
      <header className="account-card-heading">
        <div>
          <h2>{account.displayName}</h2>
          <p>{account.normalizedUsername}</p>
        </div>
        <div className="account-badges">
          <span>{roleLabels[account.role]}</span>
          <span className={account.isActive ? "status-active" : "status-inactive"}>
            {account.isActive ? "已启用" : "已停用"}
          </span>
          {account.mustChangePassword ? <span>首次登录须改密</span> : null}
        </div>
      </header>

      <div className="account-operation-grid">
        <form action={action} className="account-operation">
          <input name="operation" type="hidden" value="rename" />
          <input name="accountId" type="hidden" value={account.id} />
          <label>
            显示名
            <input name="displayName" defaultValue={account.displayName} maxLength={120} required />
          </label>
          <button type="submit">保存显示名</button>
        </form>

        <form action={action} className="account-operation">
          <input name="operation" type="hidden" value="change_role" />
          <input name="accountId" type="hidden" value={account.id} />
          <label>
            角色
            <select name="role" defaultValue={account.role}>
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button type="submit">保存角色</button>
        </form>

        <form action={action} className="account-operation">
          <input name="operation" type="hidden" value="reset_password" />
          <input name="accountId" type="hidden" value={account.id} />
          <label>
            新密码
            <input
              name="newPassword"
              type="password"
              minLength={12}
              maxLength={1_024}
              autoComplete="new-password"
              required
            />
          </label>
          <button type="submit">重置密码</button>
        </form>
      </div>

      <div className="account-direct-actions">
        <form action={action}>
          <input name="operation" type="hidden" value="set_active" />
          <input name="accountId" type="hidden" value={account.id} />
          <input name="enabled" type="hidden" value={account.isActive ? "false" : "true"} />
          <button type="submit">{account.isActive ? "停用账号" : "启用账号"}</button>
        </form>
        <form action={action}>
          <input name="operation" type="hidden" value="force_logout" />
          <input name="accountId" type="hidden" value={account.id} />
          <button type="submit">强制退出</button>
        </form>
        {account.role === "front_desk" ? (
          <form action={action}>
            <input name="operation" type="hidden" value="set_sensitive_permission" />
            <input name="accountId" type="hidden" value={account.id} />
            <input name="enabled" type="hidden" value={sensitiveEnabled ? "false" : "true"} />
            <button type="submit">
              {sensitiveEnabled ? "关闭敏感操作权限" : "开启敏感操作权限"}
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

export default async function AccountManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  await connection();
  const session = await currentSession();
  const actor = requirePermission(session, "accounts.manage");
  const runtime = createAccountRuntime();
  try {
    const [accounts, messages] = await Promise.all([
      runtime.service.listAccounts({ actorAccountId: actor.id }),
      searchParams,
    ]);
    return (
      <AccountManagementView
        accounts={accounts}
        success={messages.success}
        error={messages.error}
      />
    );
  } finally {
    await runtime.close();
  }
}
