/**
 * LogsPage — live log viewer with level filtering.
 */
import { useEffect, useRef, useState } from "react";
import { eventClient, type GatewayEvent } from "@/lib/ws";
import { PageHeader } from "@/components/PageBits";
import { Badge } from "@/components/ui/Badge";
import { FileText, Trash2, Search, Pause, Play } from "lucide-react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    eventClient.connect();
    const unsub = eventClient.onEvent((ev) => {
      if (pausedRef.current) return;
      // Convert gateway events to log entries
      const entry: LogEntry = {
        timestamp: ev.timestamp ?? new Date().toISOString(),
        level: ev.type.includes("error") ? "ERROR" : ev.type.includes("warn") ? "WARN" : "INFO",
        source: ev.sessionId?.slice(0, 8) ?? "system",
        message: `${ev.type}: ${JSON.stringify({ ...ev, type: undefined, timestamp: undefined, sessionId: undefined }).slice(0, 200)}`,
      };
      setLogs((prev) => (prev.length > 500 ? [...prev.slice(-499), entry] : [...prev, entry]));
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, paused]);

  const filtered = logs.filter((l) => {
    if (levelFilter && l.level !== levelFilter) return false;
    if (filter && !l.message.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const LEVEL_COLORS: Record<string, "red" | "yellow" | "green" | "gray"> = {
    ERROR: "red",
    WARN: "yellow",
    INFO: "green",
  };

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <PageHeader
        title="Logs"
        icon={FileText}
        actions={
          <>
            <select
              className="input text-xs w-24"
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="ERROR">Error</option>
              <option value="WARN">Warning</option>
              <option value="INFO">Info</option>
            </select>
            <input
              className="input text-xs w-28"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button
              className={cn("btn-ghost", paused && "text-warning")}
              onClick={() => setPaused(!paused)}
            >
              {paused ? <Play size={13} /> : <Pause size={13} />}
            </button>
            <button className="btn-ghost" onClick={() => setLogs([])}>
              <Trash2 size={13} />
            </button>
          </>
        }
      />

      <div className="flex items-center gap-3 text-[11px] text-fg-muted shrink-0">
        <span>{logs.length} total</span>
        <span>{filtered.length} shown</span>
      </div>

      <div className="flex-1 overflow-y-auto bg-bg-input rounded-lg border border-border font-mono">
        {filtered.length === 0 && (
          <div className="text-center py-12">
            <FileText size={24} className="text-fg-subtle mx-auto mb-2" />
            <p className="text-fg-subtle text-xs">
              {logs.length === 0 ? "Waiting for log events…" : "No logs match filter"}
            </p>
          </div>
        )}
        {filtered.map((log, i) => (
          <div
            key={i}
            className="flex items-start gap-2 px-2 py-1 text-[11px] border-b border-border-subtle/50 hover:bg-bg-elevated/30"
          >
            <span className="text-fg-subtle tabular-nums shrink-0">{formatTime(log.timestamp)}</span>
            <Badge color={LEVEL_COLORS[log.level] ?? "gray"} className="shrink-0">
              {log.level}
            </Badge>
            <span className="text-fg-muted shrink-0">[{log.source}]</span>
            <span className="text-fg-muted break-all">{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
