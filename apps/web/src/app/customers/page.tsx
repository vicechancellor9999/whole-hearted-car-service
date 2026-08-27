import { Suspense } from "react";
import { redirect } from "next/navigation";
import { CustomersWorkspace } from "@/components/customers/customers-workspace";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string | string[] }>;
}) {
  const resolvedSearchParams = await (
    searchParams ?? Promise.resolve<{ view?: string | string[] }>({})
  );
  const view = Array.isArray(resolvedSearchParams.view)
    ? resolvedSearchParams.view[0]
    : resolvedSearchParams.view;
  // 旧双视图地址迁移：客户与车辆档案已拆分为独立页面
  if (view === "vehicles") redirect("/vehicles");

  return (
    <Suspense fallback={null}>
      <CustomersWorkspace />
    </Suspense>
  );
}
