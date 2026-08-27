import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PaymentsWorkspace } from "@/components/payments/payments-workspace";

interface PaymentsPageProps {
  searchParams?: {
    view?: string | string[];
    range?: string | string[];
  };
}

export default function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const view = Array.isArray(searchParams?.view) ? searchParams?.view[0] : searchParams?.view;
  if (view === "revenue") {
    const requestedRange = Array.isArray(searchParams?.range)
      ? searchParams?.range[0]
      : searchParams?.range;
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
