import { Suspense } from "react";
import { VehicleDetailPage } from "@/components/customers/vehicle-detail-page";

export default async function VehicleDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <VehicleDetailPage vehicleId={id} />
    </Suspense>
  );
}
