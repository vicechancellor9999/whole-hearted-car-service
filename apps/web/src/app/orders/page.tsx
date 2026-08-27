import { redirect } from "next/navigation";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const resolvedSearchParams = await (
    searchParams ?? Promise.resolve<{ tab?: string }>({})
  );
  if (resolvedSearchParams.tab === "business") redirect("/orders/business");
  if (resolvedSearchParams.tab === "inspection") redirect("/orders/inspections");
  redirect("/orders/business");
}
