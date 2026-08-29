import { Suspense } from "react";
import { MechanicWorkspace } from "@/components/mechanic/mechanic-workspace";

export default function MechanicPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-page p-6 text-ink">Loading…</main>}>
      <MechanicWorkspace />
    </Suspense>
  );
}
