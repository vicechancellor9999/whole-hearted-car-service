import Link from "next/link";
import { connection } from "next/server";
import { toBusinessMonthKey } from "@/lib/time";
import { currentSession } from "@/modules/auth/current-session";
import type { MonthlyPerformanceResult } from "@/modules/performance/performance-service";
import { createPerformanceRuntime } from "@/modules/performance/performance-runtime";
import { requirePermission } from "@/modules/permissions/require-permission";

function money(value: number) {
  return `JMD ${(value / 100).toLocaleString("en-JM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function handoffTime(value: Date) {
  return value.toLocaleString("zh-CN", {
    timeZone: "America/Jamaica",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PerformanceView({ result }: { result: MonthlyPerformanceResult }) {
  return (
    <section className="performance-workspace" aria-labelledby="performance-title">
      <header className="section-heading performance-heading">
        <div>
          <p className="eyebrow">业务管理 · 绩效</p>
          <h1 id="performance-title">绩效管理</h1>
          <p>按每一次有效正式交单的牙买加月份汇总；售后维修轮次的正数、零值或负数绩效独立计入。</p>
        </div>
        <form className="performance-month-form" method="get">
          <label>绩效月份<input aria-label="绩效月份" defaultValue={result.month} name="month" required type="month" /></label>
          <button type="submit">查看</button>
        </form>
      </header>

      <section className="performance-summary" aria-label="本月绩效概览">
        <article className="performance-total-card">
          <span>{result.month.replace("-", "年")}月有效交单绩效</span>
          <strong className={result.totalPerformanceMinor < 0 ? "negative-money" : ""}>{money(result.totalPerformanceMinor)}</strong>
          <small>{result.handoffs.length} 次有效正式交单</small>
        </article>
        <article><span>参与班组</span><strong>{result.teams.length} 组</strong><small>含本月暂无交单的正式班组</small></article>
        <article><span>绩效目标 / 完成率</span><strong>未设置目标</strong><small>尚无正式目标配置，不能计算完成率</small></article>
      </section>

      <section aria-label="班组绩效汇总" className="performance-panel">
        <header className="compact-section-heading">
          <div><h2>班组绩效汇总</h2><p>同一 Business Order 的不同维修轮次分别计算；当月取消交单 {result.cancelledHandoffCount} 次已排除。</p></div>
        </header>
        {result.teams.length === 0 ? (
          <p className="record-empty">本月没有有效的正式交单绩效记录。</p>
        ) : (
          <div className="performance-team-grid">
            {result.teams.map((team) => (
              <article key={team.teamId}>
                <div><strong>{team.teamName}</strong><span>{team.handoffCount} 次交单</span></div>
                <b className={team.performanceMinor < 0 ? "negative-money" : ""}>{money(team.performanceMinor)}</b>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-label="逐次交单绩效明细" className="performance-panel performance-detail-panel">
        <header className="compact-section-heading">
          <div><h2>逐次交单绩效明细</h2><p>每行是一份独立的正式交单事实；取消的交单不参与本月汇总。</p></div>
        </header>
        {result.handoffs.length === 0 ? (
          <p className="record-empty">本月没有交单明细。</p>
        ) : (
          <div className="performance-detail-table">
            <div className="performance-detail-row performance-detail-head">
              <span>Business Order</span><span>车辆</span><span>维修轮次</span><span>维修班组</span><span>交单时间</span><span>绩效值</span>
            </div>
            {result.handoffs.map((handoff) => (
              <article className="performance-detail-row" key={handoff.id}>
                <span><Link href={`/business-orders/${handoff.businessOrderId}`}>{handoff.orderNo}</Link></span>
                <span>{handoff.plateDisplay}</span>
                <span>第 {handoff.repairRoundNo} 轮维修</span>
                <span>{handoff.teamName}</span>
                <span>{handoffTime(handoff.handedOffAt)}</span>
                <strong className={handoff.performanceMinor < 0 ? "negative-money" : ""}>{money(handoff.performanceMinor)}</strong>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

export default async function PerformancePage({ searchParams }: {
  searchParams: Promise<{ month?: string }>;
}) {
  await connection();
  const [session, query] = await Promise.all([currentSession(), searchParams]);
  const viewer = requirePermission(session, "pc.dashboard.read");
  const month = query.month?.normalize("NFKC").trim() || toBusinessMonthKey(new Date());
  const runtime = createPerformanceRuntime();
  try {
    const result = await runtime.service.getMonthlyPerformance({
      month,
      viewerAccountId: viewer.id,
    });
    return <PerformanceView result={result} />;
  } finally {
    await runtime.close();
  }
}
