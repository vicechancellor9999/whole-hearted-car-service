import { Suspense } from "react";
import { VehiclesWorkspace } from "@/components/customers/vehicles-workspace";

export default function VehiclesPage() {
  return (
    <Suspense fallback={null}>
      <VehiclesWorkspace />
    </Suspense>
  );
}
