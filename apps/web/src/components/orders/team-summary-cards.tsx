"use client";

import { TEAM_COLORS, type TeamId, type TeamSummary } from "./types";
import { cn } from "@/lib/utils";

interface TeamSummaryCardsProps {
  summaries: TeamSummary[];
  selectedTeam: TeamId | null;
  onSelectTeam: (teamId: TeamId | null) => void;
}

export function TeamSummaryCards({
  summaries,
  selectedTeam,
  onSelectTeam,
}: TeamSummaryCardsProps) {
  return (
    <div
      data-testid="orders-team-cards"
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {summaries.map((team) => {
        const isSelected = selectedTeam === team.id;
        const color = TEAM_COLORS[team.id];
        return (
          <button
            key={team.id}
            type="button"
            data-testid={`orders-team-${team.id}`}
            aria-pressed={isSelected}
            onClick={() => onSelectTeam(isSelected ? null : team.id)}
            className={cn(
              "group relative flex min-h-[120px] flex-col justify-between rounded-[22px] border p-4 text-left",
              "transition-[box-shadow,transform] duration-200 ease-out",
              "motion-reduce:transition-none motion-reduce:hover:transform-none",
              isSelected
                ? "border-primary/30 bg-white/90 shadow-card-lift dark:bg-slate-800/90"
                : "border-line bg-white/80 shadow-card hover:-translate-y-0.5 hover:shadow-card-hover dark:bg-slate-800/80",
            )}
            style={{ borderLeftWidth: 3, borderLeftColor: color }}
          >
            {/* Team name */}
            <div>
              <div className="text-[11px] font-medium text-ink-soft dark:text-slate-400">
                {team.name}
              </div>
              <div className="mt-1.5 text-[22px] font-bold tabular-nums text-ink dark:text-slate-100">
                {team.activeCount}
                <span className="ml-1 text-[11px] font-normal text-ink-soft dark:text-slate-400">
                  手上未完成
                </span>
              </div>
            </div>

            {/* Detail chips */}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-soft dark:text-slate-400">
              <span>
                待接单{" "}
                <b className="tabular-nums text-ink dark:text-slate-100">
                  {team.awaitingAcceptanceCount}
                </b>
              </span>
              <span>
                办理中{" "}
                <b className="tabular-nums text-warning dark:text-amber-400">
                  {team.inProgressCount}
                </b>
              </span>
              <span>
                回单待前台{" "}
                <b
                  className={cn(
                    "tabular-nums",
                    team.returnedAwaitingFrontdeskCount > 0
                      ? "text-danger dark:text-rose-400"
                      : "text-ink dark:text-slate-100",
                  )}
                >
                  {team.returnedAwaitingFrontdeskCount}
                </b>
              </span>
            </div>

            {/* Selected indicator */}
            {isSelected && (
              <div
                className="absolute right-3 top-3 h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
