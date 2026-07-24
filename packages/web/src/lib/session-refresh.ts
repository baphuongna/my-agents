/**
 * Decide whether the paginated sessions list should be silently
 * re-fetched after an overview poll — port of Hermes
 * `lib/session-refresh.ts`.
 *
 * The dashboard's server and a terminal CLI are separate processes that share
 * the same session store. There is no inter-process push channel, so the
 * Sessions page polls the newest sessions every few seconds (the "overview"
 * poll). When that poll surfaces a session id at the head of the list that we
 * have not seen before, a new session was created in another process and the
 * paginated list is stale — refresh it.
 *
 * Returns false on the very first poll (no baseline yet) and when either id is
 * null (empty store / transient empty response), so we never trigger a
 * spurious reload on mount or while the store is empty.
 */
export function shouldRefreshSessions(
  prevNewestId: string | null,
  currentNewestId: string | null,
): boolean {
  return (
    prevNewestId !== null &&
    currentNewestId !== null &&
    prevNewestId !== currentNewestId
  );
}
