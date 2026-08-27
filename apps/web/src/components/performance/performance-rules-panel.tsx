"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api/client";
import type { PerformanceRuleVersion, RuleStatus, RuleWorkspaceResponse } from "@/lib/performance/types";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RuleVersionForm } from "./rule-version-form";

export function PerformanceRulesPanel() {
  const [workspace, setWorkspace] = useState<RuleWorkspaceResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.performance.rules()
      .then((value) => { if (active) setWorkspace(value); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);

  if (error?.includes("无权查看绩效")) {
    return (
      <div data-testid="performance-access-denied">
        <Card>
          <CardBody className="py-10 text-center">
            <h2 className="text-lg font-bold text-ink">无权查看班组绩效</h2>
            <p className="mt-2 text-sm text-ink-soft">请联系系统管理员开通绩效查看权限。</p>
          </CardBody>
        </Card>
      </div>
    );
  }
  if (error) return <Card><CardBody><p className="text-danger">加载失败：{error}</p></CardBody></Card>;
  if (!workspace) return <Card><CardBody><p className="text-sm text-ink-soft">正在加载规则版本…</p></CardBody></Card>;

  const current = workspace.currentRule;
  const history = [current, ...workspace.scheduledRules, ...workspace.draftRules, ...workspace.historicalRules]
    .filter((rule, index, rules) => rules.findIndex((item) => item.id === rule.id) === index);

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 data-testid="current-rule-version" className="text-xl font-semibold text-ink">{current.version}</h2>
                <Badge variant="success" dot>当前生效</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-soft">所有班组统一使用的现行绩效计算参数</p>
            </div>
            {workspace.permissions.canManageRules && (
              <button data-testid="new-rule-version" onClick={() => setEditing((value) => !value)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-600">
                <Plus size={16} />新建规则版本
              </button>
            )}
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div data-testid="current-commission-rate" className="rounded-xl bg-primary-50 p-4"><p className="text-xs text-ink-soft">工时费提成比例</p><p className="mt-1 text-2xl font-semibold text-primary">{current.parameters.commissionRate * 100}%</p></div>
            <div data-testid="current-exchange-rate" className="rounded-xl bg-surface p-4"><p className="text-xs text-ink-soft">人民币汇率</p><p className="mt-1 text-2xl font-semibold text-ink">1 CNY = {current.parameters.cnyToJmdRate} JMD</p></div>
          </div>
          <div data-testid="current-rule-metadata" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft">
            <span>{monthLabel(current.effectiveMonth)}起生效</span><span>{current.createdBy}</span><span>{current.reason}</span><span>当前生效</span>
            <span data-testid="current-rule-created-at">{formatJamaicaDate(current.createdAt)}</span>
          </div>
          <div data-testid="readonly-rule-formulas" className="mt-5 rounded-xl border border-line bg-surface p-4">
            <p className="text-sm font-semibold text-ink">固定计算口径</p>
            <ol className="mt-2 space-y-2 text-sm text-ink-soft">
              <li>1. 个人携带班组指标 = 月标准工资 ÷ 工时费提成比例 × 人民币汇率</li>
              <li>2. 班组指标 = 全体成员携带班组指标合计</li>
              <li>3. 班组完成率 = 班组实际绩效 ÷ 班组指标</li>
              <li>4. 个人工资测算 = 个人月标准工资 × 班组统一完成率，最低按 0</li>
            </ol>
          </div>
        </CardBody>
      </Card>

      {editing && workspace.permissions.canManageRules && (
        <Card><CardBody><h2 className="mb-4 text-lg font-semibold text-ink">新建规则版本</h2><RuleVersionForm workspace={workspace} onActivated={(next) => { setWorkspace(next); setEditing(false); }} /></CardBody></Card>
      )}

      <Card>
        <CardBody>
          <h2 className="text-lg font-semibold text-ink">版本历史</h2>
          <div data-testid="rule-version-history" className="mt-3 space-y-2">
            {history.map((rule) => <VersionRow key={rule.id} rule={rule} currentId={current.id} />)}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function VersionRow({ rule, currentId }: { rule: PerformanceRuleVersion; currentId: string }) {
  const label = rule.id === currentId ? "当前生效" : statusLabel[rule.status];
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="font-medium text-ink">{rule.version} · {monthLabel(rule.effectiveMonth)}</p><p className="mt-0.5 text-xs text-ink-soft">{rule.parameters.commissionRate * 100}% · 1 CNY = {rule.parameters.cnyToJmdRate} JMD · {rule.reason}</p></div>
      <Badge variant={rule.status === "scheduled" ? "warning" : rule.id === currentId ? "success" : "neutral"}>{label}</Badge>
    </div>
  );
}

const statusLabel: Record<RuleStatus, string> = { active: "当前生效", scheduled: "待生效", historical: "历史版本", draft: "草稿" };
const monthLabel = (month: string) => { const [year, value] = month.split("-"); return `${year}年${Number(value)}月`; };
function formatJamaicaDate(iso: string) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Jamaica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replace(",", "");
}
