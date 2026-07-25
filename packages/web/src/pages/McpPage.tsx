/**
 * McpPage — Model Context Protocol server lifecycle.
 *
 * Port of Hermes McpPage, adapted to mya's gateway schema:
 * mya uses `id`/`command`/`args[]` (Hermes uses `name`/`transport`/`url`).
 * Endpoints: GET/POST /mcp/servers, POST /mcp/servers/:id/test, DELETE /mcp/servers/:id.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type McpServer, type McpTestResult, type ToolInfo } from "@/lib/api";
import { useConfirmDelete } from "@/hooks/useConfirmDelete";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  PageHeader,
  LoadingSpinner,
  ErrorBox,
  EmptyState,
  RefreshButton,
} from "@/components/PageBits";
import { Modal, ConfirmDialog } from "@/lib/modal";
import { useToast } from "@/lib/toast";
import { Plug, Plus, Server, Trash2, Zap, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TRANSPORT_BADGE, resolveBadge } from "@/lib/badges";

/** Tone for the health badge. */
const HEALTH_TONE: Record<string, "green" | "yellow" | "red" | "gray"> = {
  healthy: "green",
  ok: "green",
  connected: "green",
  degraded: "yellow",
  error: "red",
  unhealthy: "red",
  disconnected: "red",
};

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

export function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Add-server modal
  const [showAdd, setShowAdd] = useState(false);
  const [id, setId] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [creating, setCreating] = useState(false);

  // Per-server test results
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, McpTestResult>>({});

  // Catalog of agent tools — loaded in parallel with servers so a failing
  // /tools endpoint never blocks the server list (Hermes allSettled pattern).
  const [toolset, setToolset] = useState<ToolInfo[] | null>(null);

  // Delete confirmation (centralized hook)
  const del = useConfirmDelete<string>();
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const [serversR, toolsR] = await Promise.allSettled([
      api.mcpServers(),
      api.tools(),
    ]);
    if (serversR.status === "fulfilled") {
      setServers(serversR.value);
      setError(null);
    } else {
      setError(
        serversR.reason instanceof Error
          ? serversR.reason.message
          : String(serversR.reason),
      );
    }
    if (toolsR.status === "fulfilled") setToolset(toolsR.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([api.mcpServers(), api.tools()]).then(([serversR, toolsR]) => {
      if (cancelled) return;
      if (serversR.status === "fulfilled") {
        setServers(serversR.value);
        setError(null);
      } else {
        setError(
          serversR.reason instanceof Error
            ? serversR.reason.message
            : String(serversR.reason),
        );
      }
      if (toolsR.status === "fulfilled") setToolset(toolsR.value);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setId("");
    setCommand("");
    setArgs("");
    setEnv("");
  }

  async function handleCreate() {
    if (!id.trim() || !command.trim()) {
      toast("ID and command are required", "error");
      return;
    }
    setCreating(true);
    try {
      await api.mcpAdd({
        id: id.trim(),
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : [],
        env: parseEnv(env),
      });
      toast(`Added MCP server "${id.trim()}"`, "success");
      resetForm();
      setShowAdd(false);
      reload();
    } catch (e) {
      toast(`Failed to add: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setCreating(false);
    }
  }

  async function handleTest(server: McpServer) {
    setTesting(server.id);
    try {
      const result = await api.mcpTest(server.id);
      setTestResults((prev) => ({ ...prev, [server.id]: result }));
      if (result.ok) {
        const n = result.tools?.length ?? 0;
        toast(`${server.id}: ${n} tool${n === 1 ? "" : "s"}`, "success");
      } else {
        toast(`${server.id}: ${result.error ?? "test failed"}`, "error");
      }
    } catch (e) {
      toast(`Error: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setTesting(null);
    }
  }

  async function handleDelete() {
    const target = del.confirmDelete();
    if (!target) return;
    setDeleting(true);
    try {
      await api.mcpRemove(target);
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[target];
        return next;
      });
      toast(`Removed "${target}"`, "success");
      reload();
    } catch (e) {
      toast(`Error: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-4 max-w-4xl w-full mx-auto animate-fade-in-up">
      <PageHeader
        title="MCP Servers"
        icon={Plug}
        actions={
          <>
            <RefreshButton onClick={reload} />
            <Button size="sm" variant="primary" onClick={() => setShowAdd(true)}>
              <Plus size={13} /> Add Server
            </Button>
          </>
        }
      />

      {loading && servers.length === 0 && <LoadingSpinner label="Loading MCP servers…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && servers.length === 0 && (
        <EmptyState
          icon={Server}
          title="No MCP servers configured"
          description="Add a Model Context Protocol server to expose its tools to your agents."
          action={
            <Button size="sm" variant="primary" onClick={() => setShowAdd(true)}>
              <Plus size={13} /> Add your first server
            </Button>
          }
        />
      )}

      <div className="space-y-2">
        {servers.map((server) => {
          const result = testResults[server.id];
          return (
            <Card key={server.id} hover>
              <CardContent className="flex items-start gap-3 py-3.5 !space-y-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-sm text-fg truncate">{server.id}</span>
                    <Badge color={HEALTH_TONE[server.health?.toLowerCase()] ?? "gray"}>
                      {server.health || "unknown"}
                    </Badge>
                    {server.phase && <Badge color="blue">{server.phase}</Badge>}
                    {/* Transport: mya MCP servers run via command/args (stdio).
                        Hermes also surfaces sse/http transports — resolveBadge
                        keeps unknown values readable. */}
                    <Badge config={resolveBadge(TRANSPORT_BADGE, server.command ? "stdio" : undefined)} />
                    {server.lastError && <Badge color="red">error</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-fg-muted flex-wrap">
                    <code className="font-mono truncate">
                      {[server.command, ...(server.args ?? [])].filter(Boolean).join(" ") || "—"}
                    </code>
                    {server.tools && server.tools.length > 0 && (
                      <span>{server.tools.length} tool{server.tools.length === 1 ? "" : "s"}</span>
                    )}
                  </div>
                  {result && (
                    <div className="mt-1.5 text-xs">
                      {result.ok ? (
                        <p className="text-success">
                          {result.tools && result.tools.length > 0
                            ? `Tools: ${result.tools.join(", ")}`
                            : "Connected — no tools"}
                        </p>
                      ) : (
                        <p className="text-danger">{result.error ?? "Connection failed"}</p>
                      )}
                    </div>
                  )}
                  {server.lastError && (
                    <p className="mt-1 text-[11px] text-danger/80 break-all">{server.lastError}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Test connection"
                    onClick={() => handleTest(server)}
                    disabled={testing === server.id}
                  >
                    <Zap size={13} className={cn(testing === server.id && "animate-pulse")} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Remove server"
                    onClick={() => del.requestDelete(server.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {toolset && toolset.length > 0 && (
        <p className="text-[10px] text-fg-subtle mt-2">
          Agent tool catalog: {toolset.length} tool{toolset.length === 1 ? "" : "s"} available.
        </p>
      )}

      {/* Add server modal */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add MCP server"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)} disabled={creating}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleCreate} disabled={creating}>
              {creating ? "Adding…" : "Add"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="mcp-id" className="text-xs font-medium text-fg-muted">Server ID *</label>
            <input
              id="mcp-id"
              className="input w-full text-sm"
              autoFocus
              placeholder="filesystem"
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="mcp-command" className="text-xs font-medium text-fg-muted">Command *</label>
            <input
              id="mcp-command"
              className="input w-full text-sm"
              placeholder="npx"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="mcp-args" className="text-xs font-medium text-fg-muted">Arguments (space-separated)</label>
            <input
              id="mcp-args"
              className="input w-full text-sm"
              placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="mcp-env" className="text-xs font-medium text-fg-muted">
              Environment (KEY=VALUE per line)
            </label>
            <textarea
              id="mcp-env"
              className="input w-full text-sm font-mono min-h-[80px] resize-y"
              placeholder={"API_KEY=secret\nDEBUG=1"}
              value={env}
              onChange={(e) => setEnv(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={del.isOpen}
        onClose={() => !deleting && del.cancelDelete()}
        onConfirm={handleDelete}
        title="Remove MCP server"
        description={
          del.deleteTarget
            ? `"${del.deleteTarget}" — this will disconnect and remove the server.`
            : "This will remove the server."
        }
        confirmLabel={deleting ? "Deleting…" : "Remove"}
        destructive
      />
    </div>
  );
}
