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
    <header role="banner" className="flex items-center gap-2 px-4 h-12 shrink-0 bg-bg-surface/80 backdrop-blur-md border-b border-border/30">
      <button className="lg:hidden btn-ghost p-1.5" onClick={onMenuClick} aria-label="Toggle menu">
        <Menu size={18} />
      </button>
      <div className="flex-1" />
      {/* Status with animated glow */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "w-2 h-2 rounded-full transition-colors duration-300",
            status === "ok" ? "bg-success" : status === "error" ? "bg-danger" : "bg-warning",
            status === "ok" && "animate-pulse",
          )}
          style={status === "ok" ? { boxShadow: "0 0 8px rgb(var(--success))" } : undefined}
        />
        <span aria-live="polite" className="text-[11px] font-mono text-fg-muted">
          {status === "ok" ? "online" : status === "loading" ? "connecting" : "offline"}
        </span>
        <span className="h-3 w-px bg-border/50" />
      </div>
      {uptime != null && uptime > 0 && (
        <Badge color="gray" className="font-mono tabular-nums text-[10px] sm:text-[11px]">
          {formatDuration(uptime)}
        </Badge>
      )}
    </header>
  );
}
