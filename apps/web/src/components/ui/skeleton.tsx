import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-28" />
        </div>
      </div>
      <Skeleton className="mt-3 h-3 w-32" />
    </div>
  );
}

export function SkeletonChart({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-line bg-card p-5 shadow-card", className)}>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-48 w-full" />
    </div>
  );
}
