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
      className="block mx-2 mb-1 px-3 py-2 rounded-lg hover:bg-fg/5 transition-colors group"
    >
      <div className="flex flex-col gap-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className={cn("w-1.5 h-1.5 rounded-full", dot, status === "ok" && "animate-pulse")}
            style={status === "ok" ? { boxShadow: "0 0 6px currentColor" } : undefined} />
          <span className="text-fg-subtle">gateway</span>
          <span className={cn("font-medium ml-auto", color)}>{label}</span>
        </div>
        {uptime != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-fg-subtle/60">uptime</span>
            <span className="font-mono tabular-nums text-fg-muted ml-auto">{formatDuration(uptime)}</span>
          </div>
        )}
      </div>
    </Link>
  );
}
