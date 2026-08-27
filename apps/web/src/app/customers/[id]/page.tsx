import { Suspense } from "react";
import { CustomerDetailPage } from "@/components/customers/customer-detail-page";

export default function CustomerDetailRoute({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={null}>
      <CustomerDetailPage customerId={params.id} />
    </Suspense>
  );
}
