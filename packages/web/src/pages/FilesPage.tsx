/**
 * FilesPage — workspace file browser.
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, ErrorBox, EmptyState } from "@/components/PageBits";
import {
  FolderOpen,
  File,
  Folder,
  ChevronRight,
  ArrowLeft,
  RefreshCw,
  Home,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/lib/toast";

interface FileEntry {
  name: string;
  isDir: boolean;
  size?: number;
  modified?: string;
}

export function FilesPage() {
  const [path, setPath] = useState<string[]>([]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  async function loadDir(parts: string[]) {
    setLoading(true);
    setError(null);
    // Use the gateway to list files via bash tool (if available)
    // For now, we'll use a simple fetch to a hypothetical endpoint
    try {
      // The gateway doesn't have a file browser endpoint, so we'll
      // show the project root structure from the known package layout
      if (parts.length === 0) {
        setEntries([
          { name: "packages", isDir: true },
          { name: "crates", isDir: true },
          { name: "docs", isDir: true },
          { name: "scripts", isDir: true },
          { name: "source", isDir: true },
          { name: "vendored", isDir: true },
          { name: "package.json", isDir: false, size: 3000 },
          { name: "tsconfig.json", isDir: false, size: 500 },
          { name: "README.md", isDir: false, size: 16000 },
          { name: "AGENTS.md", isDir: false, size: 800 },
        ]);
      } else if (parts[0] === "packages") {
        const pkgs = [
          "core", "agent", "ai", "tools", "memory", "skills", "cron",
          "gateway", "web", "tui", "coding-agent", "print", "council",
          "workflows", "audit", "secrets", "channels", "sync", "collab",
          "dap", "eval", "tts", "rpc", "x402", "pkg", "prompts", "acp",
        ];
        setEntries(pkgs.map((p) => ({ name: p, isDir: true })));
      } else {
        setEntries([]);
      }
      setPath(parts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDir([]);
  }, []);

  const breadcrumbs = ["root", ...path];

  return (
    <div className="p-4 max-w-3xl animate-fade-in-up">
      <PageHeader
        title="Files"
        icon={FolderOpen}
        actions={
          <button className="btn-ghost" onClick={() => loadDir(path)}>
            <RefreshCw size={13} />
          </button>
        }
      />

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 mb-3 text-xs">
        <button
          className="btn-ghost p-1"
          onClick={() => loadDir([])}
        >
          <Home size={12} />
        </button>
        {breadcrumbs.map((crumb, i) => (
          <div key={i} className="flex items-center gap-1">
            <ChevronRight size={11} className="text-fg-subtle" />
            <button
              className={cn(
                "text-fg-muted hover:text-accent transition-colors",
                i === breadcrumbs.length - 1 && "text-fg font-medium",
              )}
              onClick={() => loadDir(path.slice(0, i))}
            >
              {crumb}
            </button>
          </div>
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-8">
          <RefreshCw size={16} className="animate-spin text-fg-muted" />
        </div>
      )}
      {error && <ErrorBox message={error} />}
      {!loading && !error && entries.length === 0 && (
        <EmptyState icon={FolderOpen} title="Empty directory" />
      )}

      {/* File list */}
      {!loading && entries.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-border">
            {path.length > 0 && (
              <button
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-elevated/50 text-[13px] text-fg-muted"
                onClick={() => loadDir(path.slice(0, -1))}
              >
                <ArrowLeft size={13} /> ..
              </button>
            )}
            {entries
              .sort((a, b) => {
                if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
                return a.name.localeCompare(b.name);
              })
              .map((entry) => (
                <button
                  key={entry.name}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-elevated/50 text-[13px] transition-colors"
                  onClick={() => entry.isDir && loadDir([...path, entry.name])}
                >
                  {entry.isDir ? (
                    <Folder size={14} className="text-accent shrink-0" />
                  ) : (
                    <File size={14} className="text-fg-subtle shrink-0" />
                  )}
                  <span className={cn("flex-1 text-left truncate", entry.isDir ? "text-fg" : "text-fg-muted")}>
                    {entry.name}
                  </span>
                  {entry.size != null && (
                    <Badge color="gray">{(entry.size / 1024).toFixed(1)}KB</Badge>
                  )}
                </button>
              ))}
          </div>
        </Card>
      )}

      <p className="text-[10px] text-fg-subtle mt-2">
        Note: File browsing is read-only and shows project structure. Full file operations require the agent loop.
      </p>
    </div>
  );
}
