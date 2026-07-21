import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { SessionsPage } from "@/pages/SessionsPage";
import { CronPage } from "@/pages/CronPage";
import { StatusPage } from "@/pages/StatusPage";
import { ModelsPage } from "@/pages/ModelsPage";
import { ToolsPage } from "@/pages/ToolsPage";
import { EventsPage } from "@/pages/EventsPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { Radio, Plug, Package, Database, Settings } from "lucide-react";

export default function App() {
  // Set document title
  useEffect(() => {
    document.title = "mya — Dashboard";
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:block h-full shrink-0">
        <Sidebar />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/sessions" replace />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/cron" element={<CronPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route
              path="/channels"
              element={
                <PlaceholderPage
                  title="Channels"
                  icon={Radio}
                  description="Telegram / Discord / Slack / Email / WhatsApp / Signal management"
                />
              }
            />
            <Route
              path="/mcp"
              element={
                <PlaceholderPage
                  title="MCP"
                  icon={Plug}
                  description="Model Context Protocol server lifecycle and tool discovery"
                />
              }
            />
            <Route
              path="/skills"
              element={
                <PlaceholderPage
                  title="Skills"
                  icon={Package}
                  description="SKILL.md curator and skill management"
                />
              }
            />
            <Route
              path="/sync"
              element={
                <PlaceholderPage
                  title="Sync"
                  icon={Database}
                  description="Cross-device state convergence (HLC + LWW)"
                />
              }
            />
            <Route
              path="/config"
              element={
                <PlaceholderPage
                  title="Config"
                  icon={Settings}
                  description="Runtime configuration editor"
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
