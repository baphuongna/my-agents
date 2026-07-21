import { Card } from "@/components/ui/Card";
import type { LucideIcon } from "lucide-react";

export function PlaceholderPage({
  title,
  icon: Icon,
  description,
}: {
  title: string;
  icon: LucideIcon;
  description: string;
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Icon size={18} className="text-accent" />
        <h1 className="text-lg font-semibold text-fg">{title}</h1>
      </div>
      <Card>
        <div className="text-center py-12">
          <Icon size={32} className="text-fg-subtle mx-auto mb-3" />
          <p className="text-fg-muted text-sm">{description}</p>
          <p className="text-fg-subtle text-[11px] mt-2">
            This page is under construction. API endpoints exist — UI coming soon.
          </p>
        </div>
      </Card>
    </div>
  );
}
