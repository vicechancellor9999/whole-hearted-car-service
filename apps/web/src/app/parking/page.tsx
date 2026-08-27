import { Suspense } from "react";
import { FormalParkingWorkspace } from "@/components/parking/formal-parking-workspace";

export default function ParkingPage() {
  return (
    <Suspense fallback={null}>
      <FormalParkingWorkspace />
    </Suspense>
  );
}
