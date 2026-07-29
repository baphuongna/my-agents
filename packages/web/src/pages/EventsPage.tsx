/**
 * EventsPage — enhanced live WebSocket event stream.
 */
import { useEffect, useRef, useState } from "react";
import { eventClient, type GatewayEvent } from "@/lib/ws";
import { PageHeader } from "@/components/PageBits";
import { Badge } from "@/components/ui/Badge";
import { Terminal, Trash2, Wifi, WifiOff, Pause, Play, Search } from "lucide-react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const EVENT_STYLES: Record<string, { border: string; label: string }> = {
  tool: { border: "border-l-orange", label: "TOOL" },
  tool_call: { border: "border-l-orange", label: "TOOL" },
  tool_result: { border: "border-l-orange", label: "RESULT" },
  approval: { border: "border-l-warning", label: "APPROVAL" },
  error: { border: "border-l-danger", label: "ERROR" },
  budget: { border: "border-l-purple", label: "BUDGET" },
  response: { border: "border-l-accent", label: "RESPONSE" },
  message: { border: "border-l-accent", label: "MSG" },
  message_delta: { border: "border-l-accent", label: "DELTA" },
  turn: { border: "border-l-accent", label: "TURN" },
  session: { border: "border-l-success", label: "SESSION" },
};

export function EventsPage() {
  const [events, setEvents] = useState<GatewayEvent[]>([]);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    // Subscribe to ALL sessions (wildcard) for the live events viewer
    eventClient.setSession("*");
    eventClient.connect();
    const unsubEvents = eventClient.onEvent((ev) => {
      if (pausedRef.current) return;
      setEvents((prev) => {
        const next = [...prev, ev];
        return next.length > 1000 ? next.slice(-1000) : next;
      });
    });
    const unsubStatus = eventClient.onStatus(setWsStatus);
    return () => {
      unsubEvents();
      unsubStatus();
    };
  }, []);

  useEffect(() => {
    if (autoScroll && !paused) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, autoScroll, paused]);

  const eventTypes = [...new Set(events.map((e) => e.type))].sort();

  const filtered = events.filter((e) => {
    if (typeFilter && e.type !== typeFilter) return false;
    if (filter && !JSON.stringify(e).toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full p-4 gap-3 animate-fade-in-up">
      <PageHeader
        title="Live Events"
        icon={Terminal}
        actions={
          <>
            <select
              className="input text-xs w-32"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">All types</option>
              {eventTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
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
              title={paused ? "Resume" : "Pause"}
            >
              {paused ? <Play size={13} /> : <Pause size={13} />}
            </button>
            <Badge color={wsStatus === "connected" ? "green" : "red"}>
              {wsStatus === "connected" ? <Wifi size={10} /> : <WifiOff size={10} />}
              {wsStatus}
            </Badge>
            <button className="btn-ghost" onClick={() => setEvents([])} title="Clear">
              <Trash2 size={13} />
            </button>
          </>
        }
      />

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-fg-muted shrink-0">
        <span>{events.length} total</span>
        <span>{filtered.length} shown</span>
        {paused && <Badge color="yellow">PAUSED</Badge>}
        {eventTypes.length > 0 && (
          <div className="flex items-center gap-1 ml-auto">
            {eventTypes.slice(0, 6).map((t) => (
              <Badge
                key={t}
                color="gray"
                className="cursor-pointer hover:bg-border"
                onClick={() => setTypeFilter(typeFilter === t ? "" : t)}
              >
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Event stream */}
      <div
        className="flex-1 overflow-y-auto space-y-0.5 bg-bg-input rounded-lg p-2 border border-border"
        onScroll={(e) => {
          const el = e.currentTarget;
          setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 50);
        }}
      >
        {filtered.length === 0 && (
          <div className="text-center py-12">
            <Terminal size={24} className="text-fg-subtle mx-auto mb-2" />
            <p className="text-fg-subtle text-xs">
              {events.length === 0 ? "Waiting for events…" : "No events match filter"}
            </p>
          </div>
        )}
        {filtered.map((ev, i) => (
          <EventRow key={i} ev={ev} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function EventRow({ ev }: { ev: GatewayEvent }) {
  const style = EVENT_STYLES[ev.type] ?? { border: "border-l-accent", label: ev.type.toUpperCase().slice(0, 7) };
  const { type: _t, timestamp: _ts, ...data } = ev;

  return (
    <div
      className={cn(
        "p-1.5 rounded text-[11px] bg-bg-surface border-l-2 font-mono hover:bg-bg-elevated/50 transition-colors",
        style.border,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-0.5">
        <span className="text-fg-subtle tabular-nums">{formatTime(ev.timestamp)}</span>
        <span className="text-accent font-semibold uppercase tracking-wide">{style.label}</span>
        <span className="text-fg-muted">{ev.type}</span>
        {ev.sessionId && (
          <span className="text-fg-subtle text-[10px]">{ev.sessionId.slice(0, 8)}</span>
        )}
      </div>
      {Object.keys(data).length > 0 && (
        <pre className="text-fg-muted whitespace-pre-wrap break-all text-[10px] leading-tight">
          {JSON.stringify(data).slice(0, 400)}
        </pre>
      )}
    </div>
  );
}
