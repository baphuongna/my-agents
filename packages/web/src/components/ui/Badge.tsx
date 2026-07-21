import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Color = "green" | "yellow" | "red" | "blue" | "gray";

export function Badge({
  children,
  color = "gray",
  className,
}: {
  children: ReactNode;
  color?: Color;
  className?: string;
}) {
  return (
    <span className={cn(`badge-${color}`, className)}>
      {children}
    </span>
  );
}
