/**
 * Sidebar status strip — shows gateway state + active session count.
 * Port of Hermes SidebarStatusStrip pattern.
 */
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";

export function StatusStrip({
  status,
  uptime,
}: {
  status: "ok" | "loading" | "error";
  uptime: number | null;
}) {
  const config = {
    ok: { label: "running", color: "text-success" },
    loading: { label: "connecting", color: "text-warning" },
    error: { label: "offline", color: "text-danger" },
  };
  const { label, color } = config[status];

  return (
    <Link
      to="/status"
      className="block px-4 pb-2 pt-1 text-text-secondary transition-colors hover:text-accent focus-visible:ring-1 focus-visible:ring-accent/40 focus-visible:ring-inset"
    >
      <div className="flex flex-col gap-0.5 text-[11px] leading-snug tracking-wide">
        <div className="flex items-center gap-1.5">
          <span className="text-fg-subtle">gateway</span>
          <span className={cn("font-medium", color)}>● {label}</span>
        </div>
        {uptime != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-fg-subtle">uptime</span>
            <span className="font-mono tabular-nums text-fg-muted">
              {formatDuration(uptime)}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
