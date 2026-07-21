/**
 * Shared page components — polished with animations + better empty states.
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
    <div className="flex items-center gap-2.5 mb-4 shrink-0 animate-fade-in-up">
      <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
        <Icon size={17} className="text-accent" />
      </div>
      <h1 className="text-base font-semibold text-fg">{title}</h1>
      <div className="flex-1" />
      {actions}
    </div>
  );
}

export function LoadingSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2.5 animate-fade-in">
      <RefreshCw size={20} className="text-accent animate-spin" />
      {label && <span className="text-xs text-fg-muted">{label}</span>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-danger/40 bg-danger/5 p-3.5 animate-scale-in">
      <div className="flex items-start gap-2">
        <span className="text-danger font-semibold text-sm shrink-0">⚠ Error</span>
        <code className="text-danger/70 text-[11px] font-mono break-all">{message}</code>
      </div>
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
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in-up">
      <div className="w-14 h-14 rounded-2xl bg-fg/5 flex items-center justify-center mb-4">
        <Icon size={26} className="text-fg-subtle/60" />
      </div>
      <p className="text-fg-muted text-sm font-medium">{title}</p>
      {description && <p className="text-fg-subtle text-xs mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function RefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn-ghost p-1.5" onClick={onClick} title="Refresh">
      <RefreshCw size={14} />
    </button>
  );
}

/** Stagger children with fade-in-up animation */
export function StaggerGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

export function StaggerItem({ children, index, className }: { children: ReactNode; index: number; className?: string }) {
  return (
    <div
      className={className}
      style={{ animation: `fadeInUp 0.3s ease-out ${Math.min(index * 40, 400)}ms both` }}
    >
      {children}
    </div>
  );
}
