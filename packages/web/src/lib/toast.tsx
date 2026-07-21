/**
 * Toast notification system.
 * Port of Hermes useToast pattern — context-based, auto-dismiss.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";
import { cn } from "./utils";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let _id = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // Clear all timers on unmount
  useEffect(() => {
    return () => { timers.current.forEach((t) => clearTimeout(t)); };
  }, []);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++_id;
    setToasts((prev) => {
      const next = [...prev, { id, type, message }];
      // Cap at 5 visible toasts
      return next.length > 5 ? next.slice(-5) : next;
    });
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, 4000);
    timers.current.set(id, timer);
  }, []);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast viewport */}
      <div className="fixed inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-4 sm:right-4 z-[250] w-[calc(100vw-1.5rem)] sm:w-auto max-w-sm flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TOAST_CONFIG: Record<
  ToastType,
  { icon: typeof CheckCircle; color: string }
> = {
  success: { icon: CheckCircle, color: "text-success border-success/40" },
  error: { icon: AlertCircle, color: "text-danger border-danger/40" },
  info: { icon: Info, color: "text-accent border-accent/40" },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { icon: Icon, color } = TOAST_CONFIG[toast.type];
  return (
    <div
      className={cn(
        "flex items-start gap-2 bg-bg-surface border rounded-lg px-3 py-2.5 shadow-xl",
        "animate-[slideIn_0.2s_ease-out]",
        color,
      )}
    >
      <Icon size={15} className="mt-0.5 shrink-0" />
      <span className="text-sm text-fg flex-1">{toast.message}</span>
      <button onClick={onDismiss} className="text-fg-muted hover:text-fg shrink-0">
        <X size={14} />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
