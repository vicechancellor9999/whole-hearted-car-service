import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Variant = "default" | "success" | "warning" | "danger" | "info" | "neutral";

const variantStyles: Record<Variant, string> = {
  default: "bg-primary-50 text-primary",
  success: "bg-emerald-50 text-success",
  warning: "bg-amber-50 text-warning",
  danger: "bg-rose-50 text-danger",
  info: "bg-blue-50 text-blue-500",
  neutral: "bg-gray-100 text-ink-soft",
};

interface BadgeProps {
  children: ReactNode;
  variant?: Variant;
  className?: string;
  dot?: boolean;
  color?: string;
}

export function Badge({ children, variant = "default", className, dot, color }: BadgeProps) {
  if (color) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
          className
        )}
        style={{ backgroundColor: `${color}15`, color }}
      >
        {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />}
        {children}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantStyles[variant],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
