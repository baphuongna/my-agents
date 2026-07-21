/**
 * Header — glassmorphic top bar with animated status indicator.
 */
import { Menu } from "lucide-react";
import { Badge } from "./ui/Badge";
import { useHealth } from "@/hooks/useHealth";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { status, uptime } = useHealth();

  return (
    <header className="flex items-center gap-2 px-4 h-12 shrink-0 glass border-b border-border/40">
      <button className="lg:hidden btn-ghost p-1.5" onClick={onMenuClick} aria-label="Menu">
        <Menu size={18} />
      </button>
      <div className="flex-1" />
      {/* Status with animated glow */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "w-2 h-2 rounded-full",
            status === "ok" ? "bg-success" : status === "error" ? "bg-danger" : "bg-warning",
            status === "ok" && "animate-pulse",
          )}
          style={status === "ok" ? { boxShadow: "0 0 8px theme('colors.success')" } : undefined}
        />
        <span className="text-[11px] font-mono text-fg-muted">
          {status === "ok" ? "online" : status === "loading" ? "…" : "offline"}
        </span>
      </div>
      {uptime != null && uptime > 0 && (
        <Badge color="gray" className="hidden sm:inline-flex font-mono tabular-nums">
          {formatDuration(uptime)}
        </Badge>
      )}
    </header>
  );
}
