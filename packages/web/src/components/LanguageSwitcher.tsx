/**
 * LanguageSwitcher — dropdown picker for the 8 supported locales.
 *
 * Shows the current locale's endonym (native name) on the trigger; clicking
 * opens a list of all locales with a check mark on the active one. Dismisses
 * on Escape and on click-outside. When `dropUp` is set (sidebar footer), the
 * list is portaled to document.body and anchored above the trigger so it is
 * never clipped by the viewport or an overflow ancestor.
 *
 * No country flags by design — languages aren't countries, and flag pairings
 * inevitably create political mismappings. Endonyms are unambiguous.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Globe } from "lucide-react";
import { LOCALE_META, LOCALES, useI18n, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface LanguageSwitcherProps {
  /** Compact mode: render only the globe icon (collapsed sidebar). */
  collapsed?: boolean;
  /** Open the list upward — use near the bottom of the viewport. */
  dropUp?: boolean;
}

export function LanguageSwitcher({ collapsed = false, dropUp = false }: LanguageSwitcherProps) {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; bottom: number } | null>(null);

  // Dismiss on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Dismiss on click / pointer outside the trigger and the list.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Position the portaled dropdown above the trigger whenever it opens.
  useLayoutEffect(() => {
    if (!open || !dropUp) {
      setCoords(null);
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ left: rect.left, bottom: window.innerHeight - rect.top + 4 });
  }, [open, dropUp]);

  const current = LOCALE_META[lang];
  const triggerLabel = current.endonym;

  const dropdown = (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label="Select language"
      className={cn(
        "min-w-[10rem] py-1 max-h-80 overflow-y-auto",
        "glass border border-border/50 rounded-xl shadow-2xl z-[100] animate-scale-in",
        dropUp
          ? "fixed"
          : "absolute right-0 top-full mt-1",
      )}
      style={
        dropUp && coords
          ? { left: coords.left, bottom: coords.bottom }
          : undefined
      }
    >
      {LOCALES.map((code) => {
        const meta = LOCALE_META[code];
        const selected = code === lang;
        return (
          <button
            key={code}
            type="button"
            role="option"
            aria-selected={selected}
            lang={code}
            onClick={() => {
              setLang(code);
              setOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
              "hover:bg-fg/5",
              selected ? "text-fg font-medium" : "text-fg-muted",
            )}
          >
            <span className="truncate flex-1">{meta.endonym}</span>
            {selected && <Check size={13} className="shrink-0 text-accent" />}
          </button>
        );
      })}
    </div>
  );

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        className="btn-ghost gap-1 text-[11px]"
        onClick={() => setOpen((v) => !v)}
        title={triggerLabel}
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="language-switcher-trigger"
      >
        <Globe size={13} />
        {!collapsed && <span>{triggerLabel}</span>}
      </button>

      {open && !dropUp && dropdown}
      {open && dropUp && createPortal(dropdown, document.body)}
    </div>
  );
}

export type { Lang };
