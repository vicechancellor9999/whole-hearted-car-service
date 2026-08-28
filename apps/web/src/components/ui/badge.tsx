import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Variant = "default" | "success" | "warning" | "danger" | "info" | "neutral";

const variantStyles: Record<Variant, string> = {
  default: "bg-state-info-subtle text-state-info-text",
  success: "bg-state-success-subtle text-state-success-text",
  warning: "bg-state-warning-subtle text-state-warning-text",
  danger: "bg-state-danger-subtle text-state-danger-text",
  info: "bg-state-info-subtle text-state-info-text",
  neutral: "bg-layer-2 text-ink-soft",
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
