import { Suspense } from "react";
import { PerformanceLoadingFallback, PerformanceWorkspace } from "@/components/performance/performance-workspace";

export default function PerformancePage() {
  return (
    <Suspense fallback={<PerformanceLoadingFallback />}>
      <PerformanceWorkspace />
    </Suspense>
  );
}
