/**
 * Phase 7: Migration script — reads old brain.jsonl + archivist.md → SQLite.
 *
 * Run once on first boot with the new SQLite store. If ~/.mya/memory/memory.db
 * already has data, migration is skipped.
 */
import type { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface OldFact {
  id: string;
  kind: string;
  entity: string;
  content: string;
  visibility: string;
  notability: number;
  source: string;
  createdAt: number;
  validUntil?: number;
  consolidatedAt?: number;
}

/**
 * Migrate old memory data to the new SQLite store.
 * Checks for brain.jsonl and archivist.md, imports if found.
 * Idempotent: skips if SQLite already has working_memory records.
 */
export function migrateOldMemory(db: DatabaseSync, memoryDir: string): { migrated: number; skipped: boolean } {
  // Check if SQLite already has data
  const count = db.prepare("SELECT COUNT(*) as n FROM working_memory").get() as { n: number };
  if (count.n > 0) {
    return { migrated: 0, skipped: true };
  }

  let migrated = 0;
  const now = new Date().toISOString();

  // 1. Migrate brain.jsonl (if exists)
  const brainJsonl = join(memoryDir, "brain.jsonl");
  if (existsSync(brainJsonl)) {
    try {
      const content = readFileSync(brainJsonl, "utf8");
      const lines = content.split("\n").filter((l) => l.trim());
      const seen = new Set<string>(); // dedup by id (last-wins in JSONL)

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as { type: string; data: OldFact; tier?: string };
          if (record.type === "fact" && record.data?.id) {
            seen.add(record.data.id);
          }
        } catch { /* skip corrupt lines */ }
      }

      // Insert unique facts
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO working_memory
          (id, content, source, timestamp, session_id, importance, veracity, memory_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as { type: string; data: OldFact; tier?: string };
          if (record.type !== "fact" || !record.data?.id) continue;
          const f = record.data;
          insertStmt.run(
            f.id,
            f.content ?? "",
            f.source ?? "migrated",
            f.createdAt ? new Date(f.createdAt).toISOString() : now,
            "default",
            (f.notability ?? 3) / 10, // normalize 0-10 → 0-1
            "unknown",
            f.kind ?? "general",
          );
          migrated++;
        } catch { /* skip */ }
      }
    } catch { /* read error — skip */ }
  }

  // 2. Migrate archivist.md (if exists)
  const archivistMd = join(memoryDir, "archivist.md");
  if (existsSync(archivistMd)) {
    try {
      const content = readFileSync(archivistMd, "utf8");
      const lines = content.split("\n").filter((l) => l.startsWith("- ["));
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO working_memory
          (id, content, source, timestamp, session_id, importance, memory_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const line of lines) {
        // Parse: "- [role] [kind|entity] content"
        const match = line.match(/^-\s*\[([^\]]+)\]\s*(.*)$/);
        if (!match) continue;
        const text = match[2] ?? "";
        // Try to parse [kind|entity] prefix
        const factMatch = text.match(/^\[([^|]+)\|([^\]]+)\]\s*(.*)$/);
        const kind = factMatch?.[1] ?? "general";
        const entity = factMatch?.[2] ?? "unknown";
        const factContent = factMatch?.[3] ?? text;

        const id = `migrated-${migrated}`;
        insertStmt.run(id, factContent, "migrated-archivist", now, "default", 0.5, kind);
        migrated++;
      }
    } catch { /* read error — skip */ }
  }

  return { migrated, skipped: false };
}