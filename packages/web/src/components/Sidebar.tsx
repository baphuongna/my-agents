import { NavLink } from "react-router-dom";
import {
  Activity,
  Clock,
  Cpu,
  FileText,
  Settings,
  Terminal,
  MessageSquare,
  Radio,
  Plug,
  Package,
  Database,
  Shield,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  path: string;
  label: string;
  icon: typeof Activity;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/sessions", label: "Sessions", icon: MessageSquare },
  { path: "/events", label: "Live Events", icon: Terminal },
  { path: "/cron", label: "Cron", icon: Clock },
  { path: "/models", label: "Models", icon: Cpu },
  { path: "/tools", label: "Tools", icon: Zap },
  { path: "/status", label: "System", icon: Activity },
  { path: "/channels", label: "Channels", icon: Radio },
  { path: "/mcp", label: "MCP", icon: Plug },
  { path: "/skills", label: "Skills", icon: Package },
  { path: "/sync", label: "Sync", icon: Database },
  { path: "/config", label: "Config", icon: Settings },
];

export function Sidebar({ onClose }: { onClose?: () => void }) {
  return (
    <aside className="w-56 h-full bg-bg-surface border-r border-border flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="w-6 h-6 rounded bg-accent flex items-center justify-center">
          <span className="text-white font-bold text-xs">m</span>
        </div>
        <strong className="text-fg text-sm tracking-wide">mya</strong>
        <span className="badge-gray ml-auto text-[9px]">dashboard</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 px-4 py-2 text-[13px] transition-colors border-l-2",
                isActive
                  ? "bg-bg-elevated text-accent border-accent"
                  : "text-fg-muted border-transparent hover:bg-bg-elevated hover:text-fg",
              )
            }
          >
            <item.icon size={15} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border text-[10px] text-fg-subtle">
        <div className="flex items-center gap-1.5">
          <Shield size={11} />
          <span>Loopback only</span>
        </div>
      </div>
    </aside>
  );
}
