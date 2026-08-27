"use client";

import { ChevronRight } from "lucide-react";
import type { TeamMonthSnapshot } from "@/lib/performance/types";
import { formatCNYFull, formatJMDFull, formatYearMonth } from "@/lib/utils";

interface MemberPayrollTableProps {
  snapshot: TeamMonthSnapshot;
  onSelectMember: (memberId: string) => void;
}

const amountOrError = (value: number | null, currency: "cny" | "jmd") => (
  value === null ? "无法测算" : currency === "cny" ? formatCNYFull(value) : formatJMDFull(value)
);

export function MemberPayrollTable({ snapshot, onSelectMember }: MemberPayrollTableProps) {
  const salaryTotal = snapshot.members.every((member) => member.standardSalaryCny !== null)
    ? snapshot.members.reduce((sum, member) => sum + (member.standardSalaryCny ?? 0), 0)
    : null;
  const targetTotal = snapshot.members.every((member) => member.carriedTargetJmd !== null)
    ? snapshot.members.reduce((sum, member) => sum + (member.carriedTargetJmd ?? 0), 0)
    : null;
  const wageTotal = snapshot.members.every((member) => member.wageBudgetCny !== null)
    ? snapshot.members.reduce((sum, member) => sum + (member.wageBudgetCny ?? 0), 0)
    : null;

  return (
    <section data-testid="member-payroll-table" className="overflow-hidden rounded-2xl border border-line bg-white shadow-card dark:bg-slate-800">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-ink dark:text-slate-100">
            {formatYearMonth(snapshot.month)}成员工资测算
          </h2>
          <p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">
            所有成员统一使用班组完成率，不重复展示个人完成率。
          </p>
        </div>
        <span className="text-xs font-semibold text-ink dark:text-slate-200">
          {snapshot.members.length} 人 · {snapshot.status === "locked" ? "已锁定快照" : "正在归集"}
        </span>
      </div>
      <div data-testid="member-table-scroll" className="max-w-full transform-gpu overflow-hidden">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="bg-surface text-[11px] font-semibold text-ink-soft dark:bg-slate-900/60 dark:text-slate-300">
            <tr>
              <th className="w-[19%] px-4 py-2.5">员工</th>
              <th className="w-[16%] px-4 py-2.5">月标准工资</th>
              <th className="w-[23%] px-4 py-2.5">携带班组指标</th>
              <th className="w-[17%] px-4 py-2.5">工资预算</th>
              <th className="w-[20%] px-4 py-2.5">应发工资测算</th>
              <th className="w-[5%] px-3 py-2.5"><span className="sr-only">动作</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {snapshot.members.map((member) => (
              <tr
                key={member.memberId}
                data-testid="member-row"
                tabIndex={0}
                role="button"
                onClick={() => onSelectMember(member.memberId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectMember(member.memberId);
                  }
                }}
                className="cursor-pointer transition-colors hover:bg-primary-50/50 focus-visible:bg-primary-50/50 dark:hover:bg-slate-700/50"
              >
                <td className="px-4 py-3">
                  <div className="font-semibold text-ink dark:text-slate-100">{member.name}</div>
                  <div className="mt-1 text-[10px] text-ink-faint dark:text-slate-400">{member.employeeNo} · {member.role}</div>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  <div className="font-semibold text-ink dark:text-slate-100">
                    {member.standardSalaryCny === null ? "缺少月标准工资" : formatCNYFull(member.standardSalaryCny, 0)}
                  </div>
                  <div className="mt-1 text-[10px] text-ink-faint dark:text-slate-400">人民币</div>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  <div className="font-semibold text-ink dark:text-slate-100">{amountOrError(member.carriedTargetJmd, "jmd")}</div>
                  <div className="mt-1 text-[10px] text-ink-faint dark:text-slate-400">标准工资折算指标</div>
                </td>
                <td data-testid="member-wage-budget" className="px-4 py-3 tabular-nums">
                  <div className="font-semibold text-ink dark:text-slate-100">{amountOrError(member.wageBudgetCny, "cny")}</div>
                  <div className="mt-1 text-[10px] text-ink-faint dark:text-slate-400">班组统一完成率</div>
                </td>
                <td data-testid="member-estimated-pay" className="px-4 py-3 tabular-nums">
                  <div className="font-semibold text-ink dark:text-slate-100">{amountOrError(member.estimatedPayableCny, "cny")}</div>
                  <div className="mt-1 text-[10px] text-ink-faint dark:text-slate-400">最低线 {formatCNYFull(snapshot.appliedRule.minimumPayableCny, 0)}</div>
                </td>
                <td className="px-3 py-3 text-primary"><ChevronRight size={16} aria-hidden /></td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line bg-primary-50/50 font-bold text-ink dark:bg-slate-900/50 dark:text-slate-100">
            <tr>
              <td className="px-4 py-3">全组合计</td>
              <td className="px-4 py-3 tabular-nums">{amountOrError(salaryTotal, "cny")}</td>
              <td className="px-4 py-3 tabular-nums">{amountOrError(targetTotal, "jmd")}</td>
              <td className="px-4 py-3 tabular-nums">{amountOrError(wageTotal, "cny")}</td>
              <td className="px-4 py-3 tabular-nums">{amountOrError(snapshot.payrollTotalCny, "cny")}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
