import { Suspense } from "react";
import { VehicleDetailPage } from "@/components/customers/vehicle-detail-page";

export default function VehicleDetailRoute({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={null}>
      <VehicleDetailPage vehicleId={params.id} />
    </Suspense>
  );
}
