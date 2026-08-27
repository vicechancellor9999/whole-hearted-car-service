import { Suspense } from "react";
import { WorkbenchWorkspace } from "@/components/workbench/workbench-workspace";

export default function WorkbenchPage() {
  return (
    <Suspense fallback={null}>
      <WorkbenchWorkspace />
    </Suspense>
  );
}
