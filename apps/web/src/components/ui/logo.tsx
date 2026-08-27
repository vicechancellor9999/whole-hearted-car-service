import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  collapsed?: boolean;
}

export function Logo({ className, collapsed }: LogoProps) {
  const companyName = "Whole Hearted Car Service Limited";

  return (
    <div
      className={cn("flex items-center gap-2.5", className)}
      aria-label={companyName}
    >
      {/* 真实 Logo 图标 */}
      <img
        src="/logo-icon.png"
        alt="Whole Hearted"
        className="h-10 w-10 flex-shrink-0 rounded-xl object-cover shadow-sm"
      />

      {!collapsed && (
        <div className="flex min-w-0 flex-col leading-tight">
          <span
            data-testid="brand-name"
            className="whitespace-normal break-words text-[11px] font-bold tracking-tight text-ink"
          >
            {companyName}
          </span>
          <span className="text-[9px] text-ink-faint dark:text-slate-400">
            综合管理系统
          </span>
        </div>
      )}
    </div>
  );
}
