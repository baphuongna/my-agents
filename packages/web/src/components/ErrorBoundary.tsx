/**
 * ErrorBoundary — catches render errors and shows a graceful fallback.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

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
        <div className="flex items-center justify-center h-full p-8">
          <div className="max-w-md text-center">
            <AlertTriangle size={40} className="text-warning mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-fg mb-2">Something went wrong</h2>
            <p className="text-sm text-fg-muted mb-4">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            {this.state.error?.stack && (
              <pre className="text-[10px] text-fg-subtle font-mono bg-bg-input rounded-lg p-3 overflow-x-auto max-h-40 mb-4 text-left">
                {this.state.error.stack.slice(0, 500)}
              </pre>
            )}
            <button
              className="btn-primary"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              <RotateCcw size={14} /> Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
