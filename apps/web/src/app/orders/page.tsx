import { redirect } from "next/navigation";

export default function OrdersPage({ searchParams }: { searchParams?: { tab?: string } }) {
  if (searchParams?.tab === "business") redirect("/orders/business");
  if (searchParams?.tab === "inspection") redirect("/orders/inspections");
  redirect("/orders/business");
}
