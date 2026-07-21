/**
 * Collapsible sidebar — polished with gradient brand, glow active state.
 */
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Activity, BarChart3, Clock, Cpu, FileText, FolderOpen, Settings,
  Terminal, MessageSquare, Radio, Plug, Package, Database,
  PanelLeftClose, PanelLeftOpen, Zap, Bell, Users, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusStrip } from "./StatusStrip";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { LangToggle } from "./LangToggle";
import { useHealth } from "@/hooks/useHealth";

interface NavItem { path: string; label: string; icon: typeof Activity; group?: string }

const NAV_ITEMS: NavItem[] = [
  { path: "/dashboard", label: "Dashboard", icon: Activity, group: "main" },
  { path: "/chat", label: "Chat", icon: Terminal, group: "main" },
  { path: "/sessions", label: "Sessions", icon: MessageSquare, group: "main" },
  { path: "/events", label: "Live Events", icon: Activity, group: "main" },
  { path: "/cron", label: "Cron", icon: Clock, group: "main" },
  { path: "/models", label: "Models", icon: Cpu, group: "main" },
  { path: "/tools", label: "Tools", icon: Zap, group: "main" },
  { path: "/files", label: "Files", icon: FolderOpen, group: "main" },
  { path: "/analytics", label: "Analytics", icon: BarChart3, group: "main" },
  { path: "/logs", label: "Logs", icon: FileText, group: "main" },
  { path: "/channels", label: "Channels", icon: Radio, group: "config" },
  { path: "/collab", label: "Collaboration", icon: Users, group: "config" },
  { path: "/push", label: "Push", icon: Bell, group: "config" },
  { path: "/mcp", label: "MCP", icon: Plug, group: "config" },
  { path: "/skills", label: "Skills", icon: Package, group: "config" },
  { path: "/sync", label: "Sync", icon: Database, group: "config" },
  { path: "/keys", label: "API Keys", icon: KeyRound, group: "config" },
  { path: "/config", label: "Config", icon: Settings, group: "config" },
  { path: "/status", label: "System", icon: Activity, group: "config" },
];

const COLLAPSE_KEY = "mya-sidebar-collapsed";

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const { status: gwStatus, uptime } = useHealth();

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
      {mobileOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={onClose} />}

      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-dvh lg:h-full shrink-0",
          "flex flex-col border-r border-border/50 glass font-sans",
          "transition-[width,transform] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
          collapsed ? "lg:w-14" : "lg:w-56", "w-56",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Brand header with gradient logo */}
        <div className="flex items-center gap-2.5 h-12 shrink-0 border-b border-border/40 px-3">
          <div className="w-7 h-7 rounded-lg gradient-accent flex items-center justify-center shrink-0 shadow-lg" style={{ boxShadow: "0 2px 12px color-mix(in srgb, theme('colors.accent.DEFAULT') 40%, transparent)" }}>
            <span className="text-white font-bold text-sm">m</span>
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <strong className="text-fg text-sm font-bold tracking-wide leading-none">mya</strong>
              <span className="text-[9px] text-fg-subtle tracking-widest uppercase mt-0.5">dashboard</span>
            </div>
          )}
          <div className="flex-1" />
          <button onClick={toggleCollapse} className="hidden lg:flex text-fg-subtle hover:text-accent p-1 rounded transition-colors" title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          <NavGroup items={mainItems} collapsed={collapsed} onItemClick={onClose} />
          {!collapsed && <div className="px-4 pt-4 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-fg-subtle/70">Configuration</div>}
          {collapsed && <div className="my-2 mx-3 border-t border-border/30" />}
          <NavGroup items={configItems} collapsed={collapsed} onItemClick={onClose} />
        </nav>

        {/* Status strip */}
        {!collapsed && <StatusStrip status={gwStatus} uptime={uptime} />}

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-border/40 shrink-0 gap-1">
          {!collapsed ? (
            <>
              <span className="text-[9px] font-mono text-fg-subtle/60 tabular-nums">v0.1.0</span>
              <div className="flex items-center gap-0.5">
                <LangToggle />
                <ThemeSwitcher />
              </div>
            </>
          ) : (
            <div className="w-2 h-2 rounded-full bg-success/60 mx-auto" />
          )}
        </div>
      </aside>
    </>
  );
}

function NavGroup({ items, collapsed, onItemClick }: { items: NavItem[]; collapsed: boolean; onItemClick?: () => void }) {
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={onItemClick}
          title={collapsed ? item.label : undefined}
          className={({ isActive }) => cn(
            "relative flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-[13px] transition-all duration-150 nav-link",
            collapsed && "justify-center mx-1.5",
            isActive
              ? "text-fg bg-accent/10 font-medium"
              : "text-fg-muted hover:text-fg hover:bg-fg/5",
          )}
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full gradient-accent" />}
              <item.icon size={16} className={cn("shrink-0 transition-colors", isActive && "text-accent")} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}
