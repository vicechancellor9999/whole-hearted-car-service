import { Suspense } from "react";
import { PerformanceWorkspace } from "@/components/performance/performance-workspace";

export default function PerformancePage() {
  return (
    <Suspense fallback={<div className="min-h-full bg-[var(--wh-page-bg)] p-6 text-sm text-ink-soft">正在准备班组绩效…</div>}>
      <PerformanceWorkspace />
    </Suspense>
  );
}
