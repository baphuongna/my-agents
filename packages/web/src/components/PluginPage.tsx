/**
 * PluginPage — renders a plugin-registered page component via useSyncExternalStore.
 * Distilled from hermes-agent/web/plugins/PluginPage.tsx. Falls back to a
 * friendly "loading" / "not found" UI when the plugin hasn't registered yet
 * (async plugin script still loading) or has been unregistered (HMR).
 */
import { useSyncExternalStore } from "react";
import { getPluginPage, subscribePages } from "@/lib/plugin-registry";

export interface PluginPageProps {
  /** Plugin name — matches the manifest's `name` field. */
  name: string;
}

export function PluginPage({ name }: PluginPageProps) {
  // useSyncExternalStore with a getter that returns the SAME reference until
  // the registry mutates (via `subscribePages`). We approximate "same reference"
  // by returning either the component (when present) or `null`.
  const Component = useSyncExternalStore(
    subscribePages,
    () => getPluginPage(name) ?? null,
    () => null, // server snapshot
  );

  if (Component) return <Component />;

  return (
    <div
      className="flex flex-col items-center justify-center h-full text-fg-muted gap-2 p-8"
      data-testid={`plugin-page-loading:${name}`}
    >
      <div className="text-sm">Plugin "{name}" not yet registered.</div>
      <div className="text-xs opacity-70">
        The plugin script may still be loading. If this persists, check the
        Plugins admin page for load errors.
      </div>
    </div>
  );
}
