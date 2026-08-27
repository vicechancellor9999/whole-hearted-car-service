"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  PerformanceHistoryRow,
  PerformanceMetricValues,
  TeamMonthSnapshot,
} from "@/lib/performance/types";
import { formatCNYFull, formatJMDFull, formatPercentRatio, formatYearMonth } from "@/lib/utils";

type TrendMetric = "completion" | "actual" | "payroll";

interface PerformanceTrendChartProps {
  currentSnapshot: TeamMonthSnapshot;
  history: PerformanceHistoryRow[];
  selected: TeamMonthSnapshot;
}

const metricLabels: Record<TrendMetric, string> = {
  completion: "完成率趋势",
  actual: "实际绩效",
  payroll: "工资测算",
};

function metricValue(values: PerformanceMetricValues | TeamMonthSnapshot, metric: TrendMetric) {
  if (metric === "completion") return values.completionRate;
  if (metric === "actual") return values.actualPerformanceJmd;
  return values.payrollTotalCny;
}

function formatMetric(value: number | null, metric: TrendMetric): string {
  if (value === null) return "无法测算";
  if (metric === "completion") return formatPercentRatio(value, 4);
  if (metric === "actual") return formatJMDFull(value);
  return formatCNYFull(value);
}

function average(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length === 0
    ? null
    : available.reduce((sum, value) => sum + value, 0) / available.length;
}

function relativeComparison(value: number | null, baseline: number | null): string {
  if (value === null || baseline === null || baseline === 0) return "历史数据不足";
  const difference = value - baseline;
  if (difference === 0) return "与此前历史平均持平";
  return `${difference > 0 ? "高于" : "低于"}此前历史平均 ${Math.abs(difference / baseline * 100).toFixed(2)}%`;
}

function directionText(delta: number | null, metric: TrendMetric): string {
  if (delta === null) return "历史数据不足";
  if (delta === 0) return "— 持平";
  return `${delta > 0 ? "↑ 上涨" : "↓ 下跌"} ${formatMetric(Math.abs(delta), metric)}`;
}

export function PerformanceTrendChart({ currentSnapshot, history, selected }: PerformanceTrendChartProps) {
  const [metric, setMetric] = useState<TrendMetric>("completion");
  const sectionRef = useRef<HTMLElement>(null);
  const chartData = useMemo(() => {
    const locked = history.map((row) => ({
      month: row.snapshot.month,
      label: formatYearMonth(row.snapshot.month),
      status: row.snapshot.status,
      value: metricValue(row.snapshot, metric),
      historicalAverage: metricValue(row.historicalAverage, metric),
      delta: metricValue(row.previousMonthDelta, metric),
    }));
    const lockedValues = history.map((row) => metricValue(row.snapshot, metric));
    return [
      ...locked,
      {
        month: currentSnapshot.month,
        label: formatYearMonth(currentSnapshot.month),
        status: currentSnapshot.status,
        value: metricValue(currentSnapshot, metric),
        historicalAverage: average(lockedValues),
        delta: null,
      },
    ];
  }, [currentSnapshot, history, metric]);

  const selectedPoint = chartData.find((point) => point.month === selected.month);
  const selectedAverage = selectedPoint?.historicalAverage ?? null;
  const comparison = selected.status === "collecting"
    ? "正在归集，不输出最终涨跌结论"
    : `${directionText(selectedPoint?.delta ?? null, metric)}；${relativeComparison(selectedPoint?.value ?? null, selectedAverage)}`;

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const markAveragePath = () => {
      section.querySelector<SVGPathElement>("path.recharts-line-curve")
        ?.setAttribute("data-testid", "trend-average-path");
    };
    markAveragePath();
    const observer = new MutationObserver(markAveragePath);
    observer.observe(section, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [metric]);

  return (
    <section
      ref={sectionRef}
      data-testid="performance-trend-chart"
      data-active-metric={metric}
      className="rounded-2xl border border-line bg-white p-4 shadow-card dark:bg-slate-800"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-ink dark:text-slate-100">班组表现趋势</h2>
          <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">
            最近完整月份用于判断趋势；当前归集月不形成整月结论。
          </p>
        </div>
        <div className="grid grid-cols-3 rounded-lg bg-surface p-1 dark:bg-slate-900/60">
          {(Object.keys(metricLabels) as TrendMetric[]).map((item) => (
            <button
              key={item}
              type="button"
              data-testid="trend-metric"
              data-metric={item}
              aria-pressed={metric === item}
              onClick={() => setMetric(item)}
              className={`min-h-9 rounded-md px-2 text-[11px] font-medium transition-colors sm:min-h-7 sm:px-3 ${
                metric === item
                  ? "bg-white text-ink shadow-sm dark:bg-slate-700 dark:text-slate-100"
                  : "text-ink-soft hover:text-ink dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {metricLabels[item]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 h-[240px] min-w-0 sm:h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 14, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--wh-border)" strokeOpacity={0.65} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--wh-text-soft)" }} tickLine={false} axisLine={false} />
            <YAxis
              width={54}
              tick={{ fontSize: 10, fill: "var(--wh-text-soft)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => metric === "completion"
                ? `${(value * 100).toFixed(1)}%`
                : value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(Math.round(value))}
            />
            <Tooltip
              formatter={(value: number) => formatMetric(value, metric)}
              labelFormatter={(label) => String(label)}
              contentStyle={{
                borderRadius: 10,
                borderColor: "var(--wh-border)",
                background: "var(--wh-card-bg)",
                color: "var(--wh-text)",
                fontSize: 11,
              }}
            />
            <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={38}>
              {chartData.map((point) => (
                <Cell
                  key={point.month}
                  fill={point.status === "collecting" ? "#a5b4fc" : "#5268f5"}
                  fillOpacity={point.status === "collecting" ? 0.45 : 0.95}
                  stroke={point.status === "collecting" ? "#5268f5" : "none"}
                  strokeDasharray={point.status === "collecting" ? "4 3" : undefined}
                />
              ))}
            </Bar>
            <Line
              dataKey="historicalAverage"
              type="monotone"
              stroke="#059669"
              strokeWidth={2}
              strokeDasharray="6 5"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-col gap-2 text-[11px] text-ink-soft dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <span data-testid="trend-average-line">虚线：历史平均 {formatMetric(selectedAverage, metric)}</span>
        <span data-testid="trend-comparison" className="font-medium text-ink dark:text-slate-200">{comparison}</span>
      </div>

      <ul className="sr-only" aria-label={`${metricLabels[metric]}文字摘要`}>
        {chartData.map((point) => (
          <li key={point.month} data-testid="trend-point" data-status={point.status}>
            {point.label}；{formatMetric(point.value, metric)}；
            {point.status === "collecting"
              ? "正在归集"
              : `${directionText(point.delta, metric)}；${relativeComparison(point.value, point.historicalAverage)}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
