import { Suspense } from "react";
import { redirect } from "next/navigation";
import { RevenueWorkspace } from "@/components/revenue/revenue-workspace";
import { isRevenueViewRange } from "@/lib/revenue/types";

interface RevenuePageProps {
  searchParams?: { range?: string | string[] };
}

export default function RevenuePage({ searchParams }: RevenuePageProps) {
  const requestedRange = Array.isArray(searchParams?.range)
    ? searchParams?.range[0]
    : searchParams?.range;
  if (!isRevenueViewRange(requestedRange)) {
    redirect("/revenue?range=day");
  }

  return (
    <Suspense fallback={<div className="min-h-full bg-[var(--wh-page-bg)] p-6 text-sm text-ink-soft">正在准备经营收款分析…</div>}>
      <RevenueWorkspace />
    </Suspense>
  );
}
