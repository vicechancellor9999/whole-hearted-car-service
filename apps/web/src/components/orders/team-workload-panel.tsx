"use client";

import { Activity } from "lucide-react";
import { TEAM_COLORS, TEAM_LABELS, type TeamWorkload } from "./types";
import { cn } from "@/lib/utils";

interface TeamWorkloadPanelProps {
  workloads: TeamWorkload[];
}

const WORKLOAD_FIELDS: Array<{
  key: keyof Omit<TeamWorkload, "teamId" | "teamName">;
  label: string;
  tone: "default" | "warning" | "danger";
}> = [
  { key: "inspectionAwaiting", label: "待接检查", tone: "default" },
  { key: "inspectionInProgress", label: "检查中", tone: "default" },
  { key: "repairAwaiting", label: "待接维修", tone: "default" },
  { key: "repairInProgress", label: "维修施工中", tone: "warning" },
  { key: "blocked", label: "阻滞", tone: "danger" },
];

export function TeamWorkloadPanel({ workloads }: TeamWorkloadPanelProps) {
  return (
    <section
      data-testid="team-workload-panel"
      className="flex flex-col rounded-[22px] border border-line bg-white/80 p-4 shadow-card dark:bg-slate-800/80"
    >
      <div className="flex items-center gap-2">
        <Activity size={16} className="shrink-0 text-primary" aria-hidden />
        <h2 className="text-sm font-bold text-ink dark:text-slate-100">
          班组当前实时负载
        </h2>
      </div>
      <p className="mt-1 text-[10px] text-ink-soft dark:text-slate-400">
        按有效作业任务计算。已回交待前台单独显示，不计入维修工在手作业。
      </p>

      {/* Four-team grid */}
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {workloads.map((team) => {
          const color = TEAM_COLORS[team.teamId];
          const inHand =
            team.inspectionAwaiting +
            team.inspectionInProgress +
            team.repairAwaiting +
            team.repairInProgress;
          return (
            <div
              key={team.teamId}
              data-testid={`team-workload-${team.teamId}`}
              className="rounded-xl border border-line bg-surface/60 p-3 dark:border-slate-600 dark:bg-slate-700/30"
              style={{ borderLeftWidth: 3, borderLeftColor: color }}
            >
              {/* Team header */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-ink dark:text-slate-100">
                  {team.teamName ?? TEAM_LABELS[team.teamId]}
                </span>
                <span className="text-[10px] tabular-nums text-ink-soft dark:text-slate-400">
                  在手 <b className="text-ink dark:text-slate-100">{inHand}</b>
                </span>
              </div>

              {/* Workload items */}
              <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 text-[10px]">
                {WORKLOAD_FIELDS.map((field) => {
                  const value = team[field.key];
                  return (
                    <div key={field.key} className="flex items-center justify-between">
                      <span className="text-ink-soft dark:text-slate-400">{field.label}</span>
                      <span
                        className={cn(
                          "tabular-nums font-semibold",
                          field.tone === "danger" && value > 0
                            ? "text-danger dark:text-rose-400"
                            : field.tone === "warning" && value > 0
                              ? "text-warning dark:text-amber-400"
                              : "text-ink dark:text-slate-100",
                        )}
                      >
                        {value}
                      </span>
                    </div>
                  );
                })}
                {/* Separator */}
                <div className="my-0.5 border-t border-line dark:border-slate-600" />
                {/* Returned to frontdesk - shown separately */}
                <div className="flex items-center justify-between">
                  <span className="text-ink-soft dark:text-slate-400">回交待前台</span>
                  <span
                    className={cn(
                      "tabular-nums font-semibold",
                      team.returnedAwaitingFrontdesk > 0
                        ? "text-danger dark:text-rose-400"
                        : "text-ink dark:text-slate-100",
                    )}
                  >
                    {team.returnedAwaitingFrontdesk}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[9px] text-ink-faint dark:text-slate-500">
        当前无班组标准产能数据，不显示负载百分比。前台根据真实数量和现场情况人工决定派组。
      </p>
    </section>
  );
}
