import { Suspense } from "react";
import { redirect } from "next/navigation";
import { CustomersWorkspace } from "@/components/customers/customers-workspace";

export default function CustomersPage({ searchParams }: { searchParams?: { view?: string | string[] } }) {
  const view = Array.isArray(searchParams?.view) ? searchParams?.view[0] : searchParams?.view;
  // 旧双视图地址迁移：客户与车辆档案已拆分为独立页面
  if (view === "vehicles") redirect("/vehicles");

  return (
    <Suspense fallback={null}>
      <CustomersWorkspace />
    </Suspense>
  );
}
