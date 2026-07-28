/**
 * @my-agent/memory/brain-migrate-jsonl — One-way JSONL→SQLite migration (Dig 3 Phase D).
 *
 * Closes wiring-review Finding 2: a user who had MYA_MEMORY_BACKEND=sqlite set
 * while the config field was dead gets an EMPTY Brain on first sqlite run
 * because SqliteBrainStore hydrates from an empty brain_facts table and the
 * JSONL load is gated off. This migration copies any existing JSONL Brain
 * snapshot into the durable store on first use.
 *
 * Idempotency is MANDATORY: if the durable brain already has data (factCount > 0),
 * the migration is a no-op — brain.loadFromSnapshot() clears first, so migrating
 * into a non-empty durable Brain would DESTROY existing data.
 */
import { Brain } from "./brain.js";
import { BrainStore } from "./brain-store.js";

/**
 * Migrate a legacy brain.jsonl snapshot into a durable SQLite-backed Brain.
 *
 * @param brain   A Brain whose storage is durable (SqliteBrainStore).
 * @param jsonlDir Directory containing the legacy brain.jsonl file.
 * @returns `{ migrated: number }` — the fact count after migration (0 if skipped).
 */
export async function migrateBrainJsonlToSqlite(
  brain: Brain,
  jsonlDir: string,
): Promise<{ migrated: number }> {
  // (a) Idempotency guard (MANDATORY) — loadFromSnapshot clears first,
  // so this guard prevents data destruction into a non-empty durable Brain.
  if (brain.factCount > 0) return { migrated: 0 };

  // (b) Best-effort JSONL load — try/catch, graceful no-op on any error
  // (no file, corrupt JSON, etc.). BrainStore.load() also catches file-read
  // errors internally and returns an empty snapshot, so this outer catch
  // handles truly unexpected failures.
  let snapshot;
  try {
    snapshot = await new BrainStore(jsonlDir).load();
  } catch {
    return { migrated: 0 };
  }

  // (c) Write to the durable store via loadFromSnapshot. The snapshot's Map
  // .values() / .entries() produce the iterables that BrainStorage expects.
  brain.loadFromSnapshot({
    facts: snapshot.facts.values(),
    takes: snapshot.takes.values(),
    pages: snapshot.pages.values(),
    tombstones: snapshot.tombstones.entries(),
  });

  // (d) Return the count of migrated facts (factCount reflects what was loaded).
  return { migrated: brain.factCount };
}
