/**
 * ActionLogViewer — live tail of a spawned admin action's output.
 *
 * Port of Hermes SystemPage's inline `ActionLogViewer`. Polls
 * GET /actions/:name/status every 1.2s (recursive setTimeout via usePolling)
 * and renders the log tail in a `<pre>`. Fires `onComplete` exactly once when
 * the process exits (deduped via `completeRef`), passing the exit code.
 *
 * A `cancelledRef` is kept as belt-and-suspenders (Hermes's original guard) so
 * an in-flight fetch can't write state after unmount, even though usePolling
 * already tears down its own timer on cleanup.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 1200;

export interface ActionLogViewerProps {
  /** Backend action name to poll (e.g. "gateway-restart"). */
  actionName: string;
  /** Fired once when the action exits, with the exit code (null if unknown). */
  onComplete?: (exitCode: number | null) => void;
  /** Max log lines to request per poll (default 200). */
  maxLines?: number;
  /** Optional close handler; renders a dismiss button when provided. */
  onClose?: () => void;
}

export function ActionLogViewer({
  actionName,
  onComplete,
  maxLines = 200,
  onClose,
}: ActionLogViewerProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(true);
  const [exitCode, setExitCode] = useState<number | null>(null);

  // Belt-and-suspenders cancelled flag — set on unmount, checked in the poll.
  const cancelledRef = useRef(false);
  // Dedup guard: onComplete must fire at most once per action run.
  const completeRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    completeRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, [actionName]);

  const poll = useCallback(async () => {
    try {
      const st = await api.getActionStatus(actionName, maxLines);
      if (cancelledRef.current) return;
      setLines(st.lines);
      setRunning(st.running);
      setExitCode(st.exit_code);
      if (!st.running && !completeRef.current) {
        completeRef.current = true;
        onComplete?.(st.exit_code);
      }
    } catch {
      // Transient fetch error — stop the spinner but keep the last log.
      if (!cancelledRef.current) setRunning(false);
    }
  }, [actionName, maxLines, onComplete]);

  // Recursive setTimeout — only active while the action is still running.
  usePolling(poll, POLL_INTERVAL_MS, { enabled: running });

  const done = !running;
  const success = done && exitCode === 0;

  return (
    <Card className="animate-fade-in">
      <CardContent className="py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-fg">{actionName}</span>
            {running ? (
              <Badge color="yellow">running</Badge>
            ) : (
              <Badge color={success ? "green" : "red"}>
                {success ? "done" : exitCode === null ? "stopped" : `exit ${exitCode}`}
              </Badge>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-fg-muted hover:text-fg text-xs"
              aria-label={`Dismiss ${actionName} log`}
            >
              ✕
            </button>
          )}
        </div>
        <pre
          className={cn(
            "max-h-72 overflow-auto whitespace-pre-wrap break-words",
            "bg-bg-elevated/50 border border-border-subtle rounded-md p-3",
            "text-[11px] font-mono text-fg-muted",
          )}
        >
          {lines.length ? lines.join("\n") : "Starting…"}
        </pre>
      </CardContent>
    </Card>
  );
}
