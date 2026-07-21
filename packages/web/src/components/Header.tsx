/**
 * Header — top bar with mobile menu toggle + live status pills.
 */
import { Menu } from "lucide-react";
import { Badge } from "./ui/Badge";
import { useHealth } from "@/hooks/useHealth";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { status, uptime } = useHealth();

  const statusColor =
    status === "ok" ? "green" : status === "loading" ? "yellow" : "red";
  const statusLabel =
    status === "ok" ? "online" : status === "loading" ? "connecting" : "offline";

  return (
    <header className="flex items-center gap-2 px-3 py-2 bg-bg-surface border-b border-border h-11 shrink-0">
      <button
        className="lg:hidden btn-ghost p-1.5"
        onClick={onMenuClick}
        aria-label="Menu"
      >
        <Menu size={18} />
      </button>

      <div className="flex-1" />

      {/* Status pills */}
      <Badge color={statusColor as "green" | "yellow" | "red"}>
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            status === "ok" ? "bg-success" : status === "error" ? "bg-danger" : "bg-warning",
            status === "ok" && "animate-pulse-slow",
          )}
        />
        {statusLabel}
      </Badge>
      {uptime != null && uptime > 0 && (
        <Badge color="gray" className="hidden sm:inline-flex font-mono tabular-nums">
          {formatDuration(uptime)}
        </Badge>
      )}
    </header>
  );
}
