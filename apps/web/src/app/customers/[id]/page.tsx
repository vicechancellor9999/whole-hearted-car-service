import { Suspense } from "react";
import { CustomerDetailPage } from "@/components/customers/customer-detail-page";

export default async function CustomerDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <CustomerDetailPage customerId={id} />
    </Suspense>
  );
}
