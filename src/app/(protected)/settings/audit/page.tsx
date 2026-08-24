import Link from "next/link";
import { connection } from "next/server";
import {
  fromBusinessDateKey,
  nextBusinessDateStart,
} from "@/lib/time";
import type {
  AuditActorOption,
  AuditEventPage,
} from "@/modules/audit/audit-service";
import { createAuditRuntime } from "@/modules/audit/audit-runtime";
import { currentSession } from "@/modules/auth/current-session";
import { requirePermission } from "@/modules/permissions/require-permission";

export type AuditFilters = {
  from?: string;
  to?: string;
  actorId?: string;
  eventType?: string;
  objectId?: string;
  page?: string;
};

const eventLabels: Record<string, string> = {
  "account.bootstrap_created": "创建首个超级管理员",
  "account.created": "创建账号",
  "account.display_name_changed": "修改账号显示名",
  "account.role_changed": "修改账号角色",
  "account.activated": "启用账号",
  "account.deactivated": "停用账号",
  "account.password_reset": "重置账号密码",
  "account.sessions_revoked": "强制账号退出",
  "account.permission_granted": "开启前台敏感操作权限",
  "account.permission_revoked": "关闭前台敏感操作权限",
  "auth.login_failed": "登录失败",
  "auth.login_rate_limited": "登录频率受限",
  "auth.login_succeeded": "登录成功",
  "auth.logout": "退出登录",
  "customer.dispute_opened": "登记客户争议",
  "customer.dispute_resolved": "解决客户争议",
  "refund.created": "登记退款",
};

const auditTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "America/Jamaica",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function AuditLogView({
  actors,
  events,
  filters,
}: {
  actors: AuditActorOption[];
  events: AuditEventPage;
  filters: AuditFilters;
}) {
  return (
    <section className="audit-workspace" aria-labelledby="audit-title">
      <header className="section-heading">
        <div>
          <p className="eyebrow">系统设置 · 只读追溯</p>
          <h1 id="audit-title">审计记录</h1>
          <p>账号、登录和后续敏感业务动作统一留痕；记录只允许查看和筛选。</p>
        </div>
      </header>

      <form className="audit-filter-form" method="get">
        <label>
          开始日期
          <input aria-label="开始日期" defaultValue={filters.from} name="from" type="date" />
        </label>
        <label>
          结束日期
          <input aria-label="结束日期" defaultValue={filters.to} name="to" type="date" />
        </label>
        <label>
          操作人
          <select aria-label="操作人" defaultValue={filters.actorId ?? ""} name="actorId">
            <option value="">全部操作人</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.displayName} · {actor.username}
              </option>
            ))}
          </select>
        </label>
        <label>
          事件类型
          <input
            aria-label="事件类型"
            defaultValue={filters.eventType}
            name="eventType"
            placeholder="例如 account.password_reset"
          />
        </label>
        <label>
          对象编号
          <input
            aria-label="对象编号"
            defaultValue={filters.objectId}
            name="objectId"
            placeholder="账号、车辆或业务编号"
          />
        </label>
        <div className="audit-filter-actions">
          <button className="primary-action compact-action" type="submit">查询</button>
          <Link href="/settings/audit">重置</Link>
        </div>
      </form>

      <div className="audit-list" aria-label="审计事件列表">
        {events.items.length === 0 ? (
          <p className="audit-empty">没有符合条件的审计记录。</p>
        ) : events.items.map((event) => (
          <article className="audit-event" key={event.id}>
            <header>
              <div>
                <strong>{eventLabels[event.eventType] ?? event.eventType}</strong>
                <code>{event.eventType}</code>
              </div>
              <time dateTime={event.occurredAt.toISOString()}>
                {auditTimeFormatter.format(event.occurredAt)}
              </time>
            </header>
            <dl className="audit-facts">
              <div>
                <dt>操作人</dt>
                <dd>{event.actorDisplayName ?? "系统"}{event.actorUsername ? ` · ${event.actorUsername}` : ""}</dd>
              </div>
              <div>
                <dt>对象</dt>
                <dd>{event.objectType} · {event.objectId}</dd>
              </div>
              <div>
                <dt>原因</dt>
                <dd>{event.reason ?? "—"}</dd>
              </div>
              <div>
                <dt>请求编号</dt>
                <dd>{event.requestId}</dd>
              </div>
            </dl>
            {event.before || event.after ? (
              <details>
                <summary>查看变更前后</summary>
                <pre>{JSON.stringify({ before: event.before, after: event.after }, null, 2)}</pre>
              </details>
            ) : null}
          </article>
        ))}
      </div>

      <footer className="audit-pagination">
        <span>第 {events.page} / {events.pageCount} 页 · 共 {events.total} 条</span>
        <nav aria-label="审计记录翻页">
          {events.page > 1 ? (
            <Link href={buildPageHref(filters, events.page - 1)}>上一页</Link>
          ) : <span aria-disabled="true">上一页</span>}
          {events.page < events.pageCount ? (
            <Link href={buildPageHref(filters, events.page + 1)}>下一页</Link>
          ) : <span aria-disabled="true">下一页</span>}
        </nav>
      </footer>
    </section>
  );
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<AuditFilters>;
}) {
  await connection();
  const session = await currentSession();
  const viewer = requirePermission(session, "audit.read");
  const filters = await searchParams;
  const runtime = createAuditRuntime();
  try {
    const [events, actors] = await Promise.all([
      runtime.service.queryEvents({
        viewerAccountId: viewer.id,
        from: filters.from ? fromBusinessDateKey(filters.from) ?? undefined : undefined,
        toExclusive: filters.to ? nextBusinessDateStart(filters.to) ?? undefined : undefined,
        actorAccountId: parsePositiveInteger(filters.actorId),
        eventType: filters.eventType,
        objectId: filters.objectId,
        page: parsePositiveInteger(filters.page),
        pageSize: 25,
      }),
      runtime.service.listActors({ viewerAccountId: viewer.id }),
    ]);
    return <AuditLogView actors={actors} events={events} filters={filters} />;
  } finally {
    await runtime.close();
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function buildPageHref(filters: AuditFilters, page: number): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key !== "page" && value) parameters.set(key, value);
  }
  parameters.set("page", String(page));
  return `/settings/audit?${parameters.toString()}`;
}
