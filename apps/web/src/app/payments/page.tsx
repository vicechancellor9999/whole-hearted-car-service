import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PaymentsWorkspace } from "@/components/payments/payments-workspace";

interface PaymentsPageProps {
  searchParams?: Promise<{
    view?: string | string[];
    range?: string | string[];
  }>;
}

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const resolvedSearchParams = await (
    searchParams ?? Promise.resolve<{ view?: string | string[]; range?: string | string[] }>({})
  );
  const view = Array.isArray(resolvedSearchParams.view)
    ? resolvedSearchParams.view[0]
    : resolvedSearchParams.view;
  if (view === "revenue") {
    const requestedRange = Array.isArray(resolvedSearchParams.range)
      ? resolvedSearchParams.range[0]
      : resolvedSearchParams.range;
    const range = ["day", "week", "month", "year", "all"].includes(requestedRange ?? "")
      ? requestedRange
      : "day";
    redirect(`/revenue?range=${range}`);
  }

  return (
    <Suspense fallback={null}>
      <PaymentsWorkspace />
    </Suspense>
  );
}
