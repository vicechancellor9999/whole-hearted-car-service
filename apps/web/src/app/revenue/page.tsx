import { Suspense } from "react";
import { redirect } from "next/navigation";
import { RevenueWorkspace } from "@/components/revenue/revenue-workspace";
import { isRevenueViewRange } from "@/lib/revenue/types";

interface RevenuePageProps {
  searchParams?: Promise<{ range?: string | string[] }>;
}

export default async function RevenuePage({ searchParams }: RevenuePageProps) {
  const resolvedSearchParams = await (
    searchParams ?? Promise.resolve<{ range?: string | string[] }>({})
  );
  const requestedRange = Array.isArray(resolvedSearchParams.range)
    ? resolvedSearchParams.range[0]
    : resolvedSearchParams.range;
  if (!isRevenueViewRange(requestedRange)) {
    redirect("/revenue?range=day");
  }

  return (
    <Suspense fallback={<div className="min-h-full bg-[var(--wh-page-bg)] p-6 text-sm text-ink-soft">正在准备经营收款分析…</div>}>
      <RevenueWorkspace />
    </Suspense>
  );
}
