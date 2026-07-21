/**
 * CollabPage — collaboration rooms visualization.
 * Uses gateway endpoint: GET /collab/rooms
 */
import { useEffect, useState } from "react";
import { Card, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox, EmptyState, RefreshButton } from "@/components/PageBits";
import { Users, User, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface RoomData {
  rooms: Record<string, { clients: number }>;
  totalClients: number;
}

export function CollabPage() {
  const [data, setData] = useState<RoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/collab/rooms", { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      const rooms = await res.json();
      const totalClients = Object.values(rooms).reduce(
        (sum: number, r: unknown) => sum + ((r as { clients: number }).clients ?? 0),
        0,
      );
      setData({ rooms, totalClients });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, []);

  const roomEntries = data ? Object.entries(data.rooms).sort((a, b) => b[1].clients - a[1].clients) : [];

  return (
    <div className="p-4 max-w-3xl space-y-3">
      <PageHeader
        title="Collaboration"
        icon={Users}
        actions={<RefreshButton onClick={reload} />}
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="py-3 px-4 text-center">
          <div className="text-2xl font-bold text-accent">{roomEntries.length}</div>
          <div className="text-[10px] text-fg-subtle uppercase tracking-wide mt-0.5">Active Rooms</div>
        </Card>
        <Card className="py-3 px-4 text-center">
          <div className="text-2xl font-bold text-success">{data?.totalClients ?? 0}</div>
          <div className="text-[10px] text-fg-subtle uppercase tracking-wide mt-0.5">Connected Clients</div>
        </Card>
      </div>

      {loading && !data && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}

      {/* Room list */}
      {!loading && !error && roomEntries.length === 0 && (
        <EmptyState
          icon={Users}
          title="No active rooms"
          description="Collaboration rooms appear here when multiple clients connect to the same session"
        />
      )}

      {roomEntries.length > 0 && (
        <Card>
          <CardTitle>Active Rooms</CardTitle>
          <CardContent>
            <div className="space-y-1 mt-2">
              {roomEntries.map(([roomName, info]) => (
                <div
                  key={roomName}
                  className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-bg-elevated/50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
                    <Users size={14} className="text-accent" />
                  </div>
                  <code className="text-[13px] text-fg font-mono flex-1 truncate">{roomName}</code>
                  <Badge color={info.clients > 1 ? "green" : "gray"}>
                    <User size={9} /> {info.clients} {info.clients === 1 ? "client" : "clients"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info */}
      <Card className="border-accent/30 bg-accent/5">
        <div className="text-[12px] text-fg-muted">
          <p className="font-medium text-fg mb-1">How collaboration works</p>
          <p className="mb-1">
            Multiple browser tabs can connect to the same session via WebSocket. The first client
            becomes the <strong className="text-fg">owner</strong> (read-write), subsequent clients
            are <strong className="text-fg">guests</strong> (read-only).
          </p>
          <p className="text-[11px] text-fg-subtle">
            Rooms are created automatically when clients subscribe to the same session ID.
          </p>
        </div>
      </Card>
    </div>
  );
}
