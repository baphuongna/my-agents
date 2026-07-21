/**
 * Shared page components — header, loading, error, empty state.
 */
import { type ReactNode } from "react";
import { RefreshCw, type LucideIcon } from "lucide-react";

export function PageHeader({
  title,
  icon: Icon,
  actions,
}: {
  title: string;
  icon: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-4 shrink-0">
      <Icon size={18} className="text-accent" />
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      <div className="flex-1" />
      {actions}
    </div>
  );
}

export function LoadingSpinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-12 gap-2">
      <RefreshCw size={16} className="text-fg-muted animate-spin" />
      {label && <span className="text-sm text-fg-muted">{label}</span>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="card border-danger">
      <div className="text-danger text-sm font-medium">Error</div>
      <div className="text-danger/80 text-xs mt-1 font-mono">{message}</div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card text-center py-12">
      <Icon size={28} className="text-fg-subtle mx-auto mb-3" />
      <p className="text-fg-muted text-sm font-medium">{title}</p>
      {description && <p className="text-fg-subtle text-xs mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn-ghost" onClick={onClick} title="Refresh">
      <RefreshCw size={13} />
    </button>
  );
}
