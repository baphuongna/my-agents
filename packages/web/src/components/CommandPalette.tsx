/**
 * CommandPalette — Cmd+K quick navigation overlay.
 * Port of common dashboard pattern (not in Hermes, but essential UX).
 */
import { useEffect, useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  Search,
  Terminal,
  MessageSquare,
  Clock,
  Cpu,
  Zap,
  Activity,
  BarChart3,
  FileText,
  FolderOpen,
  Radio,
  Plug,
  Package,
  Database,
  Settings,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PaletteItem {
  label: string;
  path: string;
  icon: LucideIcon;
  keywords?: string[];
}

const ITEMS: PaletteItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: Activity, keywords: ["home", "overview", "summary"] },
  { label: "Chat", path: "/chat", icon: Terminal, keywords: ["agent", "prompt", "ai"] },
  { label: "Sessions", path: "/sessions", icon: MessageSquare, keywords: ["history", "conversations"] },
  { label: "Live Events", path: "/events", icon: Activity, keywords: ["stream", "websocket", "realtime"] },
  { label: "Cron Jobs", path: "/cron", icon: Clock, keywords: ["schedule", "automation", "timer"] },
  { label: "Models", path: "/models", icon: Cpu, keywords: ["provider", "llm", "ai"] },
  { label: "Tools", path: "/tools", icon: Zap, keywords: ["functions", "permissions"] },
  { label: "Files", path: "/files", icon: FolderOpen, keywords: ["browse", "directory"] },
  { label: "Analytics", path: "/analytics", icon: BarChart3, keywords: ["stats", "metrics", "usage"] },
  { label: "Logs", path: "/logs", icon: FileText, keywords: ["output", "debug"] },
  { label: "Channels", path: "/channels", icon: Radio, keywords: ["telegram", "discord", "slack"] },
  { label: "MCP", path: "/mcp", icon: Plug, keywords: ["model context protocol"] },
  { label: "Skills", path: "/skills", icon: Package, keywords: ["templates"] },
  { label: "Sync", path: "/sync", icon: Database, keywords: ["replica", "convergence"] },
  { label: "API Keys", path: "/keys", icon: KeyRound, keywords: ["env", "secrets", "credentials"] },
  { label: "Config", path: "/config", icon: Settings, keywords: ["settings", "preferences"] },
  { label: "System", path: "/status", icon: Activity, keywords: ["health", "status", "uptime"] },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Cmd+K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus input when open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return ITEMS;
    const q = query.toLowerCase();
    return ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q) ||
        item.keywords?.some((k) => k.includes(q)),
    );
  }, [query]);

  function select(item: PaletteItem) {
    navigate(item.path);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selected]) select(filtered[selected]);
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center pt-[15vh] bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-lg bg-bg-surface border border-border rounded-xl shadow-2xl overflow-hidden animate-fade-in">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search size={16} className="text-fg-subtle" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none text-sm text-fg placeholder:text-fg-subtle"
            placeholder="Search pages… (Cmd+K)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="text-[10px] text-fg-subtle bg-bg-elevated border border-border rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="text-center text-fg-subtle text-sm py-8">No results found</p>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.path}
              onMouseEnter={() => setSelected(i)}
              onClick={() => select(item)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                i === selected ? "bg-bg-elevated" : "hover:bg-bg-elevated/50",
              )}
            >
              <item.icon
                size={15}
                className={cn(i === selected ? "text-accent" : "text-fg-muted")}
              />
              <span className="text-[13px] text-fg flex-1">{item.label}</span>
              <code className="text-[10px] text-fg-subtle">{item.path}</code>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border text-[10px] text-fg-subtle">
          <div className="flex items-center gap-2">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
          </div>
          <span>{filtered.length} results</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
