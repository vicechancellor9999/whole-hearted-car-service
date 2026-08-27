"use client";

import { cn } from "@/lib/utils";

export interface ArrowChainStep {
  key: string;
  label: string;
  state: "done" | "current" | "todo";
}

export interface ArrowChainEvent {
  stepKey: string;
  text: string;
  tone?: "normal" | "warn" | "danger";
}

/** 一条连续进度带：每个状态都是清楚的小方块，记录直接挂在对应状态下。 */
export function ArrowChainStatus({ steps, events, className }: {
  steps: ArrowChainStep[];
  events?: ArrowChainEvent[];
  className?: string;
}) {
  return (
    <div
      data-testid="status-arrow-chain"
      role="region"
      aria-label="检查结果客户沟通进度"
      tabIndex={0}
      className={cn("w-full min-w-0 max-w-full select-none overflow-x-hidden pb-1 focus:outline-none focus:ring-2 focus:ring-primary-200", className)}
    >
      <div role="list" className="grid w-full min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((step, index) => {
          const stepEvents = (events ?? []).filter((event) => event.stepKey === step.key);
          return (
            <div
              key={step.key}
              role="listitem"
              className="flex min-w-0 flex-col"
            >
              <div
                data-shape="square"
                data-current={step.state === "current" ? "true" : "false"}
                aria-current={step.state === "current" ? "step" : undefined}
                className={cn(
                  "flex min-h-12 w-full items-center justify-center rounded-md border px-2 py-2 text-center text-[10px] font-semibold leading-3 sm:text-[11px] sm:leading-4",
                  step.state === "done" && "bg-primary-600 text-white dark:bg-primary-500",
                  step.state === "current" && "border-amber-500 bg-amber-400 font-bold text-amber-950 shadow-sm ring-2 ring-amber-200",
                  step.state === "todo" && "border-line bg-gray-50 text-gray-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300",
                )}
              >
                <span><span className="mr-1 opacity-70">{index + 1}</span>{step.label}</span>
              </div>
              {stepEvents.length > 0 && (
                <div className="mt-1.5 flex w-full flex-col items-center gap-1 px-1">
                  {stepEvents.map((event, eventIndex) => (
                    <span
                      key={eventIndex}
                      className={cn(
                        "max-w-full whitespace-normal rounded-md border px-1.5 py-0.5 text-center text-[10px] font-medium leading-4 shadow-sm",
                        event.tone === "danger"
                          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                          : event.tone === "warn"
                            ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                            : "border-line bg-white text-ink-soft dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
                      )}
                    >
                      {event.text}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        当前进度：{steps.find((step) => step.state === "current")?.label ?? "未指定"}
      </span>
    </div>
  );
}
