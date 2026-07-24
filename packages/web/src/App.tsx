import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPalette } from "@/components/CommandPalette";
import { DashboardPage } from "@/pages/DashboardPage";
import { ChatPage } from "@/pages/ChatPage";
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
import { ProfilesPage } from "@/pages/ProfilesPage";
import { ProfileBuilderPage } from "@/pages/ProfileBuilderPage";
import { WebhooksPage } from "@/pages/WebhooksPage";
import { PairingPage } from "@/pages/PairingPage";
import { PetsPage } from "@/pages/PetsPage";
import { AchievementsPage } from "@/pages/AchievementsPage";
import { EnvPage } from "@/pages/EnvPage";
import { PushPage } from "@/pages/PushPage";
import { CollabPage } from "@/pages/CollabPage";
import { SyncPage } from "@/pages/SyncPage";
import { ChannelsPage } from "@/pages/ChannelsPage";
import { DocsPage } from "@/pages/DocsPage";
import { McpPage } from "@/pages/McpPage";
import { SystemPage } from "@/pages/SystemPage";
import { PluginsPage } from "@/pages/PluginsPage";

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.title = "mya — Dashboard";
  }, []);

  // R4: body scroll lock when mobile sidebar open
  // R5: escape key closes mobile sidebar
  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      {/* Ambient gradient background */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0" style={{
        background: "radial-gradient(ellipse 80% 50% at 50% -20%, rgb(var(--accent) / 0.08), transparent)",
      }} />
      <CommandPalette />
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="relative z-10 flex flex-col flex-1 min-w-0 h-full overflow-hidden">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/cron" element={<CronPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/keys" element={<EnvPage />} />
            <Route path="/push" element={<PushPage />} />
            <Route path="/collab" element={<CollabPage />} />
            <Route path="/sync" element={<SyncPage />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/mcp" element={<McpPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/system" element={<SystemPage />} />
            <Route path="/plugins" element={<PluginsPage />} />
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/profiles/new" element={<ProfileBuilderPage />} />
            <Route path="/webhooks" element={<WebhooksPage />} />
            <Route path="/pairing" element={<PairingPage />} />
            <Route path="/pets" element={<PetsPage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
