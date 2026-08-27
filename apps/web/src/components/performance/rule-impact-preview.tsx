"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { RuleImpactPreview as RuleImpactPreviewData } from "@/lib/performance/types";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const target = (value: number | null) => value === null ? "—" : `JMD ${integer.format(value)}`;
const rate = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(4)}%`;
const money = (value: number | null) => value === null ? "—" : `¥${value.toFixed(2)}`;

export function RuleImpactPreview({ preview }: { preview: RuleImpactPreviewData }) {
  return (
    <div className="mt-5 space-y-3">
      <div>
        <h3 className="font-semibold text-ink">四组影响预览</h3>
        <p className="mt-1 text-xs text-ink-soft">只替换规则参数，实际绩效与成员标准工资保持不变。</p>
      </div>
      {preview.teams.map((team) => <TeamImpact key={team.teamId} team={team} />)}
    </div>
  );
}

function TeamImpact({ team }: { team: RuleImpactPreviewData["teams"][number] }) {
  const [expanded, setExpanded] = useState(false);
  const unchanged = team.before.payrollTotalCny === team.after.payrollTotalCny;
  return (
    <section data-testid="rule-impact-team" className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-semibold text-ink">{team.teamName}</h4>
          <button data-testid="rule-impact-expand" onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-1 text-xs font-medium text-primary">
            {expanded ? "收起成员" : "展开成员"}{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Comparison label="班组指标" before={target(team.before.teamTargetJmd)} after={target(team.after.teamTargetJmd)} beforeId="rule-team-target-before" afterId="rule-team-target-after" />
          <Comparison label="完成率" before={rate(team.before.completionRate)} after={rate(team.after.completionRate)} beforeId="rule-team-completion-before" afterId="rule-team-completion-after" />
          <Comparison label={`工资测算合计${unchanged ? " · 无变化" : ""}`} before={money(team.before.payrollTotalCny)} after={money(team.after.payrollTotalCny)} beforeId="rule-team-payroll-before" afterId="rule-team-payroll-after" />
        </div>
      </div>
      {expanded && (
        <div className="border-t border-line bg-surface px-3 py-2 sm:px-4">
          {team.before.members.map((member, index) => {
            const after = team.after.members[index];
            return (
              <div key={member.memberId} data-testid="rule-impact-member" className="grid grid-cols-1 gap-2 border-b border-line py-3 text-sm last:border-0 sm:grid-cols-[1.1fr_1fr_1fr]">
                <div><p className="font-medium text-ink">{member.name}</p><p className="text-xs text-ink-soft">{member.role}</p></div>
                <div><p className="text-xs text-ink-soft">携带班组指标</p><p><span data-testid="rule-member-target-before">{target(member.carriedTargetJmd)}</span> <span className="text-ink-faint">→</span> <span data-testid="rule-member-target-after" className="font-medium text-primary">{target(after.carriedTargetJmd)}</span></p></div>
                <div><p className="text-xs text-ink-soft">工资测算</p><p><span data-testid="rule-member-pay-before">{money(member.estimatedPayableCny)}</span> <span className="text-ink-faint">→</span> <span data-testid="rule-member-pay-after" className="font-medium text-primary">{money(after.estimatedPayableCny)}</span></p></div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Comparison({ label, before, after, beforeId, afterId }: { label: string; before: string; after: string; beforeId: string; afterId: string }) {
  return (
    <div className="rounded-lg bg-surface p-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm"><span data-testid={beforeId}>{before}</span><span className="text-ink-faint">→</span><span data-testid={afterId} className="font-semibold text-primary">{after}</span></div>
    </div>
  );
}
