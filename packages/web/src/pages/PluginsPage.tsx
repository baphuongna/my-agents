/**
 * PluginsPage — plugin hub (stub).
 *
 * Hermes has a full plugin system; mya's gateway returns empty arrays from
 * stubs, so there is no backend plugin support yet. This page renders an empty
 * state and a disabled "Install from URL" affordance so the layout is ready
 * when the backend lands.
 */
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader, EmptyState } from "@/components/PageBits";
import { Package, Download, Puzzle } from "lucide-react";

export function PluginsPage() {
  return (
    <div className="p-4 max-w-5xl w-full mx-auto animate-fade-in-up">
      <PageHeader
        title="Plugins"
        icon={Puzzle}
        actions={
          <Button size="sm" variant="primary" disabled title="Coming soon">
            <Download size={13} /> Install from URL
          </Button>
        }
      />

      <EmptyState
        icon={Package}
        title="No plugins installed"
        description="mya's plugin system is under development. When plugins are available, they'll appear here as cards you can install, enable, and configure."
      />

      {/* Future-ready card grid skeleton — shows the intended layout. */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
        <Card className="opacity-40">
          <CardContent>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                <Package size={16} className="text-accent" />
              </div>
              <span className="text-sm font-medium text-fg">Plugin name</span>
            </div>
            <p className="text-[11px] text-fg-subtle">
              Plugin cards will show status, version, and enable/configure controls.
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="text-[11px] text-fg-subtle text-center mt-4">
        Install from URL and the plugin marketplace will be available in a future release.
      </p>
    </div>
  );
}
