/**
 * ThemeSwitcher — dropdown to select theme preset.
 */
import { useState, useRef, useEffect } from "react";
import { Palette, Check, ChevronDown } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemeSwitcher() {
  const { theme, themes, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        className="btn-ghost text-[11px] gap-1"
        onClick={() => setOpen(!open)}
        title="Change theme"
      >
        <Palette size={13} />
        <span className="hidden sm:inline">{theme.label}</span>
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-56 bg-bg-surface border border-border rounded-lg shadow-2xl z-50 overflow-hidden animate-fade-in">
          {themes.map((t) => (
            <button
              key={t.name}
              onClick={() => {
                setTheme(t.name);
                setOpen(false);
              }}
              className={cn(
                "w-full flex items-start gap-2 px-3 py-2 hover:bg-bg-elevated/50 transition-colors text-left",
                t.name === theme.name && "bg-bg-elevated",
              )}
            >
              {/* Color preview dots */}
              <div className="flex gap-0.5 mt-0.5 shrink-0">
                <span className="w-3 h-3 rounded-full border border-border" style={{ background: t.vars["--bg"] }} />
                <span className="w-3 h-3 rounded-full" style={{ background: t.vars["--accent"] }} />
                <span className="w-3 h-3 rounded-full" style={{ background: t.vars["--fg"] }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] text-fg font-medium">{t.label}</span>
                  {t.name === theme.name && <Check size={11} className="text-accent" />}
                </div>
                <p className="text-[10px] text-fg-subtle truncate">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
