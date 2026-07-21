/**
 * ErrorBoundary — catches render errors with graceful fallback.
 * R57-R64 fixes: role=alert, aria-hidden icons, dev-only stack, try-again without reload.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, RefreshCw } from "lucide-react";

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="flex items-center justify-center h-full p-8">
          <div className="max-w-lg text-center">
            <AlertTriangle size={36} className="text-warning mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-fg mb-2">Something went wrong</h2>
            <p className="text-sm text-fg-muted mb-4">
              {import.meta.env.DEV
                ? this.state.error?.message ?? "An unexpected error occurred."
                : "An unexpected error occurred. Please try again."}
            </p>
            {import.meta.env.DEV && this.state.error?.stack && (
              <details className="text-left mb-4">
                <summary className="cursor-pointer text-xs text-fg-muted hover:text-accent">Show technical details</summary>
                <pre className="text-[10px] text-fg-subtle font-mono bg-bg-input rounded-lg p-3 overflow-x-auto max-h-40 mt-2 border border-border/30">
                  {this.state.error.stack.slice(0, 800)}
                </pre>
              </details>
            )}
            <div className="flex items-center justify-center gap-2">
              <button
                className="btn-primary"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                <RotateCcw size={14} /> Try again
              </button>
              <button className="btn-ghost" onClick={() => window.location.reload()}>
                <RefreshCw size={14} /> Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
