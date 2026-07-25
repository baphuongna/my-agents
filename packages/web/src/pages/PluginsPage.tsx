/**
 * PluginsPage — plugin hub + slot reference.
 *
 * mya has no plugin loader yet, but the slot *infrastructure* (registry +
 * `PluginSlot` seams) is wired across the shell and built-in pages. This page
 * documents every available injection point (`KNOWN_SLOT_NAMES`), shows how
 * many components are currently registered, and lists them live — so the
 * "Plugin system is ready" state is visible while the loader remains a future
 * phase.
 */
import { useSyncExternalStore } from "react";
import { Card, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader, EmptyState } from "@/components/PageBits";
import { Puzzle, Download, CheckCircle2, LayoutGrid, Puzzle as PuzzleIcon } from "lucide-react";
import {
  KNOWN_SLOT_NAMES,
  SLOT_DESCRIPTIONS,
} from "@/lib/plugin-slots";
import {
  subscribe,
  totalRegistrations,
  registeredSlotNames,
  getSlotComponents,
} from "@/lib/plugin-registry";

const SHELL_PREFIXES = ["sidebar", "header"];
function isShellSlot(name: string): boolean {
  return SHELL_PREFIXES.some((p) => name.startsWith(p));
}

export function PluginsPage() {
  // Re-render reactively when the registry mutates so the registered list
  // stays live (totalRegistrations changes on every register/unregister).
  useSyncExternalStore(subscribe, totalRegistrations);

  const active = totalRegistrations();
  const registered = registeredSlotNames();
  const shellSlots = KNOWN_SLOT_NAMES.filter(isShellSlot);
  const pageSlots = KNOWN_SLOT_NAMES.filter((s) => !isShellSlot(s));

  return (
    <div className="p-4 max-w-5xl w-full mx-auto animate-fade-in-up">
      <PageHeader
        title="Plugins"
        icon={Puzzle}
        actions={
          <Button size="sm" variant="primary" disabled title="Plugin loader coming soon">
            <Download size={13} /> Install from URL
          </Button>
        }
      />

      {/* Ready banner */}
      <Card className="mb-3">
        <CardContent>
          <div className="flex items-center gap-2 flex-wrap">
            <CheckCircle2 size={16} className="text-success" />
            <span className="text-sm font-semibold text-fg">Plugin system is ready</span>
            <Badge color="green" className="ml-auto">{active} active</Badge>
          </div>
          <p className="text-[11px] text-fg-muted mt-1">
            Slot injection seams are wired across the shell and {pageSlots.length / 2} built-in
            pages. The plugin loader (SRI bundles) is a future phase — but components registered
            via <code className="font-mono text-accent">registerSlot()</code> render immediately.
          </p>
        </CardContent>
      </Card>

      {/* Slot reference */}
      <Card className="mb-3">
        <CardTitle>
          <LayoutGrid size={14} className="text-accent" />
          Available Slots ({KNOWN_SLOT_NAMES.length})
        </CardTitle>

        <div className="mt-3 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1.5">
              Shell-wide
            </div>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {shellSlots.map((slot) => (
                <div key={slot} className="flex items-center gap-2 py-1 px-2 rounded bg-fg/3">
                  <code className="text-[11px] text-accent font-mono shrink-0">{slot}</code>
                  <span className="text-[10px] text-fg-muted truncate">{SLOT_DESCRIPTIONS[slot]}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1.5">
              Page-scoped
            </div>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {pageSlots.map((slot) => (
                <div key={slot} className="flex items-center gap-2 py-1 px-2 rounded bg-fg/3">
                  <code className="text-[11px] text-accent font-mono shrink-0">{slot}</code>
                  <span className="text-[10px] text-fg-muted truncate">{SLOT_DESCRIPTIONS[slot]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Registered components */}
      {registered.length === 0 ? (
        <EmptyState
          icon={PuzzleIcon}
          title="No plugins registered"
          description="No components have claimed a slot yet. Plugins that call registerSlot() will appear here."
        />
      ) : (
        <Card>
          <CardTitle>
            <PuzzleIcon size={14} className="text-purple" />
            Registered Slot Components ({active})
          </CardTitle>
          <div className="mt-3 space-y-1.5">
            {registered.map((slot) => {
              const count = getSlotComponents(slot).length;
              return (
                <div
                  key={slot}
                  className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-bg-elevated/50"
                >
                  <code className="text-[12px] text-accent font-mono">{slot}</code>
                  <span className="text-[11px] text-fg-muted flex-1 truncate">
                    {SLOT_DESCRIPTIONS[slot]}
                  </span>
                  <Badge color="blue">{count}</Badge>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <p className="text-[11px] text-fg-subtle text-center mt-4">
        Install from URL and the plugin marketplace will be available in a future release.
      </p>
    </div>
  );
}
