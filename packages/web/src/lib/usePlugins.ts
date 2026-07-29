/**
 * usePlugins — discovers and loads dashboard plugins.
 * Distilled from hermes-agent/web/plugins/usePlugins.ts (commit a61183b5).
 *
 * Flow:
 *   1. Fetch manifests from GET /api/dashboard/plugins
 *   2. Inject <script> tags for each plugin's JS bundle
 *   3. Plugin scripts call window.__MYA_PLUGINS__.register(name, Component)
 *   4. <PluginPage> resolves the component from the registry at render time
 */
import { useState, useEffect, useRef } from "react";
import type { PluginManifest } from "./plugin-manifest";

export interface UsePluginsResult {
  manifests: PluginManifest[];
  loading: boolean;
}

export function usePlugins(): UsePluginsResult {
  const [manifests, setManifests] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const loaded = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    fetch("/api/dashboard/plugins")
      .then((r) => r.json())
      .then((list: PluginManifest[]) => {
        if (cancelled || !Array.isArray(list)) {
          setLoading(false);
          return;
        }
        setManifests(list);

        // Inject plugin scripts. Each plugin calls window.__MYA_PLUGINS__.register()
        // when its bundle executes, which updates the plugin-registry store.
        for (const m of list) {
          if (!m.entry) continue;
          const src = `/api/dashboard-plugins/${m.name}/${m.entry}`;
          if (loaded.current.has(m.name)) continue;
          loaded.current.add(m.name);

          const script = document.createElement("script");
          script.src = src;
          script.async = true;
          script.setAttribute("data-mya-plugin", m.name);
          script.onerror = () => console.warn(`[plugins] failed to load: ${m.name}`);
          document.head.appendChild(script);
        }

        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { manifests, loading };
}
