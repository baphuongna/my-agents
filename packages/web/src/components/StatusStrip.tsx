/**
 * Sidebar status strip — gateway state with glow indicator.
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
    ok: { label: "running", color: "text-success", dot: "bg-success" },
    loading: { label: "connecting", color: "text-warning", dot: "bg-warning" },
    error: { label: "offline", color: "text-danger", dot: "bg-danger" },
  };
  const { label, color, dot } = config[status];

  return (
    <Link
      to="/status"
      aria-label={`Gateway ${label}. View system status.`}
      className="block mx-2 mb-1 px-3 py-2 rounded-lg hover:bg-fg/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="grid grid-cols-2 gap-x-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span
            className={cn("w-2 h-2 rounded-full transition-colors duration-300", dot, status === "ok" && "animate-pulse")}
            style={status === "ok" ? { boxShadow: "0 0 6px rgb(var(--success))" } : undefined}
          />
          <span className="text-fg-muted">gateway</span>
        </div>
        <span className={cn("font-medium text-right", color)}>{label}</span>
        {uptime != null && (
          <>
            <span className="text-fg-subtle">uptime</span>
            <span className="font-mono tabular-nums text-fg-muted text-right">{formatDuration(uptime)}</span>
          </>
        )}
      </div>
    </Link>
  );
}
