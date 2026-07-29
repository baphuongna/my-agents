import { useEffect, useState, useMemo, type ComponentType } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageHeaderProvider } from "@/components/PageHeaderProvider";
import { CommandPalette } from "@/components/CommandPalette";
import { buildRoutes, resolveRouteElement, type BuiltinRoute } from "@/lib/plugin-routes";
import { getPluginPage } from "@/lib/plugin-registry";
import { exposePluginSDK } from "@/lib/plugin-sdk";
import { usePlugins } from "@/lib/usePlugins";
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

/**
 * Single source of truth for builtin page routes (path → page component).
 * Distilled from hermes-agent/web `BUILTIN_ROUTES_CORE` (data-driven routing,
 * commit a61183b5). Previously each route was a separate static `<Route>` line
 * AND a `NAV_ITEMS` entry in Sidebar.tsx — adding a page meant two edits that
 * could silently desync. Now one entry here drives the `<Route>` list.
 * Exported so a unit test can assert the route set never drops a page.
 */
export const PAGE_ROUTES: Record<string, ComponentType> = {
  "/dashboard": DashboardPage,
  "/chat": ChatPage,
  "/sessions": SessionsPage,
  "/events": EventsPage,
  "/cron": CronPage,
  "/models": ModelsPage,
  "/tools": ToolsPage,
  "/files": FilesPage,
  "/analytics": AnalyticsPage,
  "/logs": LogsPage,
  "/skills": SkillsPage,
  "/keys": EnvPage,
  "/push": PushPage,
  "/collab": CollabPage,
  "/sync": SyncPage,
  "/config": ConfigPage,
  "/status": StatusPage,
  "/channels": ChannelsPage,
  "/mcp": McpPage,
  "/docs": DocsPage,
  "/system": SystemPage,
  "/plugins": PluginsPage,
  "/profiles": ProfilesPage,
  "/profiles/new": ProfileBuilderPage,
  "/webhooks": WebhooksPage,
  "/pairing": PairingPage,
  "/pets": PetsPage,
  "/achievements": AchievementsPage,
};

// Exported so a unit test guards against accidental redirect-target drift.
// /redirects to /dashboard on cold load; * (catch-all) redirects unknown paths to /chat.
export const ROOT_REDIRECT = "/dashboard";
export const FALLBACK_PATH = "/chat";

// Expose the plugin SDK (register pages/slots + React/hooks/utils) on window so
// plugin bundles (loaded via <script> by usePlugins) can integrate without
// bundling their own React copy. F5 port of Hermes exposePluginSDK().
exposePluginSDK();

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { manifests } = usePlugins();

  // Distilled from hermes-agent/web buildRoutes (commit a61183b5): merge builtin
  // routes with plugin manifests. When plugins are discovered via
  // usePlugins(), their routes render automatically via <PluginPage>.
  const mergedRoutes = useMemo(() => {
    const builtin: BuiltinRoute[] = Object.entries(PAGE_ROUTES).map(
      ([path, component]) => ({ path, component }),
    );
    return buildRoutes(builtin, manifests);
  }, [manifests]);

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
        <PageHeaderProvider>
          <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Navigate to={ROOT_REDIRECT} replace />} />
            {mergedRoutes.map((r) => (
              <Route
                key={r.key}
                path={r.path}
                element={resolveRouteElement(r.element, getPluginPage)}
              />
            ))}
            <Route path="*" element={<Navigate to={FALLBACK_PATH} replace />} />
          </Routes>
          </ErrorBoundary>
        </PageHeaderProvider>
      </div>
    </div>
  );
}
