"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RevenueDetailResponse } from "@/lib/revenue/types";
import { formatJMDFull } from "@/lib/utils";

const rangeTitles: Record<RevenueDetailResponse["range"], string> = {
  day: "今日收退款",
  week: "本周收款趋势",
  month: "本月收款趋势",
  year: "本年收款趋势",
  all: "历年收款趋势",
};

export function RevenueChart({ detail }: { detail: RevenueDetailResponse }) {
  return (
    <section data-testid="revenue-chart" data-view="trend" className="min-w-0 overflow-hidden rounded-2xl border border-line bg-white p-4 shadow-card dark:bg-slate-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-ink dark:text-slate-100">{rangeTitles[detail.range]}</h2>
          <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">净收款 = 独立收款总额 − 实际退款；不把分次付款强行拆成工时或配件收入。</p>
        </div>
        <div data-testid="revenue-chart-legend" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-ink-soft dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" />净收款</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-500" />收款总额</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-rose-500" />退款</span>
        </div>
      </div>
      <div className="mt-4 h-[280px] min-w-0 sm:h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={detail.rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--wh-border)" strokeOpacity={0.7} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--wh-text-soft)" }} tickLine={false} axisLine={false} />
            <YAxis width={58} tick={{ fontSize: 10, fill: "var(--wh-text-soft)" }} tickLine={false} axisLine={false} tickFormatter={(value: number) => Math.abs(value) >= 1_000 ? `${Math.round(value / 1_000)}K` : String(Math.round(value))} />
            <Tooltip formatter={(value: number) => formatJMDFull(Number(value))} contentStyle={{ borderRadius: 10, borderColor: "var(--wh-border)", background: "var(--wh-card-bg)", color: "var(--wh-text)", fontSize: 11 }} />
            <Line type="monotone" dataKey="netPaidJmd" name="净收款" stroke="#465fff" strokeWidth={3} dot={{ r: 3 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="grossPaidJmd" name="收款总额" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="cashRefundedJmd" name="退款" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
