/**
 * PageHeaderProvider — renders the shared page-header bar and exposes the
 * toolbar-injection setters via `PageHeaderContext`.
 *
 * Adapted from Hermes `contexts/PageHeaderProvider.tsx`:
 *  - `useLayoutEffect` clears all three slots when the route changes, so a
 *    toolbar injected by the previous page never flashes on the next page
 *    (children re-fill them on mount via `usePageHeader`).
 *  - The default title is derived from the route with `resolvePageTitle`;
 *    a page can override it with `setTitle`.
 *  - The context value's setters are stable (React `useState` dispatchers),
 *    so consumer effects keyed on them don't refire.
 *
 * Layout: a fixed page-title bar sits above the scrollable page content. This
 * is distinct from the app-level status `<Header>` rendered in `App.tsx`.
 */
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  PageHeaderContext,
  type PageHeaderContextValue,
} from "@/lib/page-header-context";
import { resolvePageTitle } from "@/lib/resolve-page-title";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { t } = useI18n();
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [afterTitle, setAfterTitle] = useState<ReactNode>(null);
  const [end, setEnd] = useState<ReactNode>(null);

  // Clear any per-page title / toolbar slots when the path changes so stale
  // content from the previous page never lingers. Child routes re-fill these
  // on mount via `usePageHeader`. `useLayoutEffect` runs before paint (no flash).
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    setTitleOverride(null);
    setAfterTitle(null);
    setEnd(null);
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const defaultTitle = useMemo(
    () => resolvePageTitle(pathname, t),
    [pathname, t],
  );
  const displayTitle = titleOverride ?? defaultTitle;

  // Setters (`setTitleOverride`, `setAfterTitle`, `setEnd`) are React `useState`
  // dispatchers — referentially stable across renders. Only `displayTitle`
  // changes the value identity, and only then when the shown title actually
  // changes, which is exactly when consumers should re-render.
  const value = useMemo<PageHeaderContextValue>(
    () => ({
      title: displayTitle,
      setTitle: setTitleOverride,
      setAfterTitle,
      setEnd,
    }),
    [displayTitle],
  );

  return (
    <PageHeaderContext.Provider value={value}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header
          role="banner"
          aria-label="Page header"
          className="flex h-11 shrink-0 items-center gap-3 border-b border-border/30 bg-bg-surface/60 px-4 backdrop-blur-sm"
        >
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-fg">
              {displayTitle}
            </h1>
            {afterTitle ? (
              <div className="flex min-w-0 items-center gap-2">
                {afterTitle}
              </div>
            ) : null}
          </div>
          <div className="flex-1" />
          {end ? (
            <div
              className={cn(
                "flex shrink-0 items-center gap-2",
                "min-w-0 overflow-x-auto [scrollbar-width:none]",
              )}
            >
              {end}
            </div>
          ) : null}
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </PageHeaderContext.Provider>
  );
}
