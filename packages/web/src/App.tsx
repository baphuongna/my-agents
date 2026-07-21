import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { SessionsPage } from "@/pages/SessionsPage";
import { CronPage } from "@/pages/CronPage";
import { StatusPage } from "@/pages/StatusPage";
import { ModelsPage } from "@/pages/ModelsPage";
import { ToolsPage } from "@/pages/ToolsPage";
import { EventsPage } from "@/pages/EventsPage";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { FilesPage } from "@/pages/FilesPage";
import { LogsPage } from "@/pages/LogsPage";
import { ConfigPage } from "@/pages/ConfigPage";
import { SkillsPage } from "@/pages/SkillsPage";
import { RichInfoPage } from "@/pages/RichInfoPage";
import { Radio, Plug, Database } from "lucide-react";

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.title = "mya — Dashboard";
  }, []);

  return (
    <div className="flex h-dvh max-h-dvh overflow-hidden bg-bg text-fg">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/sessions" replace />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/cron" element={<CronPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route
              path="/channels"
              element={
                <RichInfoPage
                  title="Channels"
                  icon={Radio}
                  description="Multi-platform delivery: Telegram, Discord, Slack, Email, WhatsApp, Signal"
                  endpoints={[
                    { method: "GET", path: "/channels/:id/config", desc: "Get channel config" },
                    { method: "POST", path: "/channels/:id/config", desc: "Update channel config" },
                    { method: "POST", path: "/channels/:id/test", desc: "Test channel delivery" },
                    { method: "GET", path: "/channel/sessions", desc: "List channel sessions" },
                    { method: "POST", path: "/channel/:id/webhook", desc: "Inbound webhook" },
                  ]}
                  features={[
                    "Channel adapter management UI",
                    "Inbound message → agent turn flow",
                    "Outbound delivery testing",
                    "Multi-bot alias configuration",
                  ]}
                />
              }
            />
            <Route
              path="/mcp"
              element={
                <RichInfoPage
                  title="MCP"
                  icon={Plug}
                  description="Model Context Protocol server lifecycle and tool discovery"
                  endpoints={[
                    { method: "GET", path: "/mcp/servers", desc: "List MCP servers" },
                    { method: "POST", path: "/mcp/connect", desc: "Connect to server" },
                    { method: "GET", path: "/mcp/tools", desc: "Discovered tools" },
                  ]}
                  features={[
                    "11-phase lifecycle FSM visualization",
                    "Server connect/disconnect controls",
                    "Tool discovery and health monitoring",
                    "OAuth flow for remote servers",
                  ]}
                />
              }
            />
            <Route
              path="/sync"
              element={
                <RichInfoPage
                  title="Sync"
                  icon={Database}
                  description="Cross-device state convergence (HLC + LWW push/pull)"
                  endpoints={[
                    { method: "GET", path: "/sync/state", desc: "Replica state" },
                    { method: "GET", path: "/sync/pull", desc: "Pull since HLC" },
                    { method: "POST", path: "/sync/push", desc: "Push entries" },
                  ]}
                  features={[
                    "HLC timestamp visualization",
                    "Push/pull sync controls",
                    "Conflict resolution (LWW) viewer",
                    "A2A protocol endpoint",
                  ]}
                />
              }
            />
            <Route path="*" element={<Navigate to="/sessions" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
