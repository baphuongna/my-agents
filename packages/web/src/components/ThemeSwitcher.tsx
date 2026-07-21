/**
 * ThemeSwitcher — dropdown with live color preview.
 */
import { useState, useRef, useEffect } from "react";
import { Palette, Check } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemeSwitcher() {
  const { theme, themes, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button className="btn-ghost p-1.5" onClick={() => setOpen(!open)} title="Theme">
        <Palette size={14} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-52 glass border border-border/50 rounded-xl shadow-2xl z-50 overflow-hidden animate-scale-in py-1">
          {themes.map((t) => (
            <button
              key={t.name}
              onClick={() => { setTheme(t.name); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 hover:bg-fg/5 transition-colors text-left",
                t.name === theme.name && "bg-fg/5",
              )}
            >
              <div className="flex gap-0.5 shrink-0">
                <span className="w-3.5 h-3.5 rounded-md border border-border/50" style={{ background: t.vars["--bg"] }} />
                <span className="w-3.5 h-3.5 rounded-md" style={{ background: t.vars["--accent"] }} />
                <span className="w-3.5 h-3.5 rounded-md" style={{ background: t.vars["--fg"] }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] text-fg font-medium">{t.label}</span>
                  {t.name === theme.name && <Check size={11} className="text-accent" />}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
