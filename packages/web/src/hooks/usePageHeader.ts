/**
 * usePageHeader — read/modify the shared page-header slots.
 *
 * Returns `{ title, setTitle, setAfterTitle, setEnd }`:
 *  - `title`         the currently displayed page title (override ?? default)
 *  - `setTitle`      override the title (pass `null` to revert to the route default)
 *  - `setAfterTitle` inject content next to the title
 *  - `setEnd`        inject trailing toolbar content
 *
 * Throws if used outside a `PageHeaderProvider` — the context defaults to
 * `null` so a missing provider fails loudly rather than silently no-op'ing.
 *
 * Adapted from Hermes `contexts/usePageHeader.ts` (mya also surfaces `title`).
 */
import { useContext } from "react";
import {
  PageHeaderContext,
  type PageHeaderContextValue,
} from "@/lib/page-header-context";

export function usePageHeader(): PageHeaderContextValue {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) {
    throw new Error("usePageHeader must be used within a PageHeaderProvider");
  }
  return ctx;
}
