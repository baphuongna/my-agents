/**
 * Collapsible sidebar — Hermes-inspired with status strip, footer, localStorage persistence.
 */
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Clock,
  Cpu,
  FileText,
  FolderOpen,
  Settings,
  Terminal,
  MessageSquare,
  Radio,
  Plug,
  Package,
  Database,
  Shield,
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusStrip } from "./StatusStrip";
import { useHealth } from "@/hooks/useHealth";

interface NavItem {
  path: string;
  label: string;
  icon: typeof Activity;
  group?: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/sessions", label: "Sessions", icon: MessageSquare, group: "main" },
  { path: "/events", label: "Live Events", icon: Terminal, group: "main" },
  { path: "/cron", label: "Cron", icon: Clock, group: "main" },
  { path: "/models", label: "Models", icon: Cpu, group: "main" },
  { path: "/tools", label: "Tools", icon: Zap, group: "main" },
  { path: "/files", label: "Files", icon: FolderOpen, group: "main" },
  { path: "/analytics", label: "Analytics", icon: BarChart3, group: "main" },
  { path: "/logs", label: "Logs", icon: FileText, group: "main" },
  { path: "/channels", label: "Channels", icon: Radio, group: "config" },
  { path: "/mcp", label: "MCP", icon: Plug, group: "config" },
  { path: "/skills", label: "Skills", icon: Package, group: "config" },
  { path: "/sync", label: "Sync", icon: Database, group: "config" },
  { path: "/config", label: "Config", icon: Settings, group: "config" },
  { path: "/status", label: "System", icon: Activity, group: "config" },
];

const COLLAPSE_KEY = "mya-sidebar-collapsed";

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const { status: gwStatus, uptime } = useHealth();

  // Load persisted collapse state
  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSE_KEY);
    if (stored === "true") setCollapsed(true);
  }, []);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, String(next));
  }

  const mainItems = NAV_ITEMS.filter((i) => i.group === "main");
  const configItems = NAV_ITEMS.filter((i) => i.group === "config");

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/70"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-dvh lg:h-full shrink-0",
          "flex flex-col bg-bg-surface border-r border-border font-sans",
          "transition-[width,transform] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
          collapsed ? "lg:w-14" : "lg:w-56",
          "w-56",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Brand header */}
        <div className="flex items-center gap-2 h-11 shrink-0 border-b border-border px-3">
          <div className="w-6 h-6 rounded bg-accent flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-xs">m</span>
          </div>
          {!collapsed && (
            <strong className="text-fg text-sm tracking-[0.05em] uppercase truncate">mya</strong>
          )}
          <div className="flex-1" />
          {/* Collapse toggle (desktop only) */}
          <button
            onClick={toggleCollapse}
            className="hidden lg:flex text-fg-muted hover:text-fg p-1"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-1">
          <NavGroup items={mainItems} collapsed={collapsed} onItemClick={onClose} />
          {!collapsed && (
            <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.12em] text-fg-subtle">
              Configuration
            </div>
          )}
          {collapsed && <div className="my-2 mx-3 border-t border-border-subtle" />}
          <NavGroup items={configItems} collapsed={collapsed} onItemClick={onClose} />
        </nav>

        {/* Status strip */}
        {!collapsed && <StatusStrip status={gwStatus} uptime={uptime} />}

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-border shrink-0">
          {!collapsed ? (
            <>
              <span className="text-[10px] font-mono text-fg-subtle tabular-nums">v0.1.0</span>
              <Shield size={11} className="text-fg-subtle" />
            </>
          ) : (
            <Shield size={11} className="text-fg-subtle mx-auto" />
          )}
        </div>
      </aside>
    </>
  );
}

function NavGroup({
  items,
  collapsed,
  onItemClick,
}: {
  items: NavItem[];
  collapsed: boolean;
  onItemClick?: () => void;
}) {
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={onItemClick}
          title={collapsed ? item.label : undefined}
          className={({ isActive }) =>
            cn(
              "relative flex items-center gap-2.5 px-4 py-2 text-[13px] transition-colors group",
              collapsed && "justify-center px-0",
              isActive
                ? "text-accent bg-bg-elevated"
                : "text-fg-muted hover:text-fg hover:bg-bg-elevated/50",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent" />
              )}
              <item.icon size={15} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}
