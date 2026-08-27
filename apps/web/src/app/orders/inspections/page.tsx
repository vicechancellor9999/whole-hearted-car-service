"use client";

import { Suspense } from "react";
import { FormalInspectionReportsWorkspace } from "@/components/orders/formal-inspection-reports-workspace";

export default function InspectionReportsPage() {
  return (
    <Suspense fallback={<div className="mx-auto mt-6 h-[420px] w-[calc(100%-24px)] max-w-[1720px] animate-pulse rounded-[22px] bg-slate-100 dark:bg-slate-800" />}>
      <FormalInspectionReportsWorkspace />
    </Suspense>
  );
}
