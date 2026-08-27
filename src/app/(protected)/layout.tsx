import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import type { CurrentSession } from "@/modules/auth/auth-service";
import { currentSession } from "@/modules/auth/current-session";
import { getRoleNavigation } from "@/modules/permissions/role-navigation";
import { ProtectedNavigation } from "@/app/(protected)/protected-navigation";

type ProtectedShellProps = {
  children: ReactNode;
  session: CurrentSession;
};

const roleLabels = {
  super_admin: "超级管理员",
  front_desk: "前台",
  owner: "老板只读",
  mechanic: "维修工",
} as const;

export function ProtectedShell({ children, session }: ProtectedShellProps) {
  if (session.account.role === "mechanic") {
    return (
      <main className="access-shell">
        <section className="access-card" aria-labelledby="mobile-only-title">
          <div className="brand-mark" aria-hidden="true">WH</div>
          <h1 id="mobile-only-title">此账号不提供 PC 网页端</h1>
          <p>维修工账号只能使用维修工手机端，不会显示 PC 业务数据。</p>
          <form action="/logout" method="post">
            <button className="secondary-action" type="submit">退出登录</button>
          </form>
        </section>
      </main>
    );
  }

  const navigation = getRoleNavigation(session.account.role);

  return (
    <div className="protected-shell">
      <aside className="protected-sidebar">
        <Link className="protected-brand" href="/dashboard">
          <Image alt="Whole Hearted Car Service Limited" height={44} priority src="/brand-logo-wh-512.png" width={44} />
          <span><strong>Whole Hearted Car<br />Service Limited</strong><small>综合管理系统</small></span>
        </Link>
        <ProtectedNavigation items={navigation} />
        <div className="protected-account">
          <div className="protected-account-identity"><span aria-hidden="true">{session.account.displayName.slice(0, 1)}</span><div><strong>{session.account.displayName}</strong><small>{roleLabels[session.account.role]}</small></div></div>
          <form action="/logout" method="post">
            <button className="secondary-action" type="submit">退出</button>
          </form>
          <p><i aria-hidden="true" />正式数据模式</p>
        </div>
      </aside>
      <main className="protected-content">
        {session.account.role === "owner" ? <span className="readonly-badge shell-readonly-badge">全部业务只读</span> : null}
        {children}
      </main>
    </div>
  );
}

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await connection();
  const session = await currentSession();
  if (!session) redirect("/login");
  return <ProtectedShell session={session}>{children}</ProtectedShell>;
}
