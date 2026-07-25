/**
 * Page-header context — toolbar-injection seam (Hermes pattern).
 *
 * A page can push three slots into the shared page-header bar rendered by
 * `PageHeaderProvider`:
 *  - `setTitle`     overrides the route-derived page title
 *  - `setAfterTitle` injects content immediately after the title (e.g. a count)
 *  - `setEnd`       injects content at the trailing edge (e.g. a "New Job" button)
 *
 * The context defaults to `null` so a consumer that forgets the provider fails
 * loudly (see `usePageHeader`). Setter identities are stable (React's `useState`
 * dispatchers never change), letting pages key effects on them without loops.
 */
import { createContext } from "react";
import type { ReactNode } from "react";

export interface PageHeaderContextValue {
  /** The currently displayed page title (override ?? route-derived default). */
  title: string;
  /** Override the page title. Pass `null` to revert to the route default. */
  setTitle: (title: string | null) => void;
  /** Inject content next to the title (cleared on route change). */
  setAfterTitle: (node: ReactNode) => void;
  /** Inject trailing toolbar content (cleared on route change). */
  setEnd: (node: ReactNode) => void;
}

export const PageHeaderContext = createContext<PageHeaderContextValue | null>(
  null,
);
