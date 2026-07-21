import { useEffect, useRef, useState } from "react";
import { eventClient, type GatewayEvent } from "@/lib/ws";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "./SessionsPage";
import { Terminal, Trash2, Wifi, WifiOff } from "lucide-react";
import { formatTime, cn } from "@/lib/utils";

const EVENT_COLORS: Record<string, string> = {
  tool: "border-l-orange",
  approval: "border-l-warning",
  error: "border-l-danger",
  budget: "border-l-purple",
  response: "border-l-accent",
};

export function EventsPage() {
  const [events, setEvents] = useState<GatewayEvent[]>([]);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [filter, setFilter] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    eventClient.connect();
    const unsubEvents = eventClient.onEvent((ev) => {
      setEvents((prev) => {
        const next = [...prev, ev];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });
    const unsubStatus = eventClient.onStatus(setWsStatus);

    return () => {
      unsubEvents();
      unsubStatus();
    };
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, autoScroll]);

  const filtered = filter
    ? events.filter((e) =>
        JSON.stringify(e).toLowerCase().includes(filter.toLowerCase()),
      )
    : events;

  return (
    <div className="p-4 space-y-3 flex flex-col h-full">
      <PageHeader
        title="Live Events"
        icon={Terminal}
        actions={
          <>
            <input
              className="input text-xs w-40"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <Badge color={wsStatus === "connected" ? "green" : "red"}>
              {wsStatus === "connected" ? <Wifi size={10} /> : <WifiOff size={10} />}
              {wsStatus}
            </Badge>
            <button
              className="btn-ghost p-1.5"
              onClick={() => setEvents([])}
              title="Clear"
            >
              <Trash2 size={14} />
            </button>
          </>
        }
      />

      <div
        className="flex-1 overflow-y-auto space-y-1 bg-bg-input rounded-lg p-2 border border-border"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          setAutoScroll(atBottom);
        }}
      >
        {filtered.length === 0 && (
          <p className="text-fg-subtle text-xs text-center py-8">
            Waiting for events…
          </p>
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
  const colorClass = EVENT_COLORS[ev.type] ?? "border-l-accent";
  return (
    <div className={cn("ev p-1.5 rounded text-[11px] bg-bg-surface border-l-2 font-mono", colorClass)}>
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-fg-subtle">{formatTime(ev.timestamp)}</span>
        <span className="text-accent font-semibold">{ev.type}</span>
        {ev.sessionId && <span className="text-fg-muted">{ev.sessionId.slice(0, 8)}</span>}
      </div>
      <pre className="text-fg-muted whitespace-pre-wrap break-all text-[10px] leading-tight">
        {JSON.stringify(ev, null, 0).slice(0, 500)}
      </pre>
    </div>
  );
}
