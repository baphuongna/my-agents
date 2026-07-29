import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { BadgeConfig } from "@/lib/badges";

type Color = "green" | "yellow" | "red" | "blue" | "gray" | "purple";

/**
 * Badge — small status pill.
 *
 * Two styling modes:
 *  1. Legacy `color` prop → maps to a theme `badge-<color>` CSS class
 *     (defined in index.css using CSS variables).
 *  2. `config` prop (Hermes badge-mapping pattern) → a {@link BadgeConfig}
 *     whose `className` carries explicit tailwind colour classes, and whose
 *     `label` becomes the content unless explicit children are supplied.
 *
 * When both are given, `config` wins. Callers merge extra `className`
 * through `cn` (tailwind-merge dedupes conflicting utilities).
 */
export function Badge({
  children,
  color = "gray",
  config,
  className,
  onClick,
}: {
  children?: ReactNode;
  color?: Color;
  config?: BadgeConfig;
  className?: string;
  onClick?: () => void;
}) {
  if (config) {
    return (
      <span className={cn(config.className, className)} onClick={onClick}>
        {children ?? config.label}
      </span>
    );
  }
  return (
    <span className={cn(`badge-${color}`, className)} onClick={onClick}>
      {children}
    </span>
  );
}
