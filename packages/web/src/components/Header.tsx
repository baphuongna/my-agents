import { useEffect, useState } from "react";
import { Menu, X, Clock } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { useHealth } from "@/hooks/useHealth";
import { Badge } from "./ui/Badge";
import { cn } from "@/lib/utils";

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { status, uptime } = useHealth();

  const statusColor = status === "ok" ? "green" : status === "loading" ? "yellow" : "red";
  const statusLabel = status === "ok" ? "online" : status === "loading" ? "…" : "offline";

  const fmtUptime = (s: number) => {
    if (s < 60) return `${Math.floor(s)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  };

  return (
    <>
      <header className="flex items-center gap-2 px-3 py-2 bg-bg-surface border-b border-border h-11 shrink-0">
        {/* Mobile menu button */}
        <button
          className="lg:hidden btn-ghost p-1.5"
          onClick={() => setMobileOpen(true)}
          aria-label="Menu"
        >
          <Menu size={18} />
        </button>

        {/* Title */}
        <strong className="text-sm text-fg hidden sm:inline">Dashboard</strong>

        <div className="flex-1" />

        {/* Status pills */}
        <Badge color={statusColor as "green" | "yellow" | "red"}>
          <span className={cn("w-1.5 h-1.5 rounded-full bg-current")} />
          {statusLabel}
        </Badge>
        {uptime != null && (
          <Badge color="gray">
            <Clock /> {fmtUptime(uptime)}
          </Badge>
        )}
        <Badge color="blue" className="hidden sm:inline-flex">
          mya
        </Badge>
      </header>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full">
            <Sidebar onClose={() => setMobileOpen(false)} />
            <button
              className="absolute top-2 right-2 btn-ghost p-1"
              onClick={() => setMobileOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
