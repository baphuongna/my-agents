/**
 * Semantic code search — index workspace source files into embeddings and answer
 * meaning-based queries. Complements exact-text `grep`/`glob` and the regex
 * import-graph `codegraph` (which finds files by import relation, NOT meaning).
 *
 * Reuses the embeddings subsystem (embeddings.ts) — no second embedder/model.
 * Opt-in: degrades to "unavailable, use grep" when fastembed is absent or
 * MYA_NO_EMBEDDINGS is set (zero crash, zero regression — same posture as memory
 * recall's vector arm).
 *
 * Storage: a SEPARATE SQLite DB at ~/.mya/code-index.db (not memory.db), so the
 * code index never bloats the memory store and can be wiped independently.
 *
 * v1 chunks per-file by ~CHUNK_CHARS (line-tracked). Per-symbol chunking (via
 * symbol-extractor.ts) is a documented v2 follow-up.
 */
import {
  embedContent, cosine, vecToBuffer, bufferToVec, embeddingDim, embeddingsDisabled,
} from "./embeddings.js";
import { openDB, type SqliteDatabase } from "./sqlite-db.js";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";

const DEFAULT_DB_PATH = join(homedir(), ".mya", "code-index.db");
const CHUNK_CHARS = 2000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES = 50_000;
/** Safety valve on the brute-force cosine scan (mirrors memory recall's LIMIT). */
const COSINE_CANDIDATE_LIMIT = 5000;
const SUPPORTED_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java", ".rb", ".md",
]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target", ".next", ".crew", ".mya", "vendor", "coverage",
]);

export interface CodeSearchHit {
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
}
export type CodeSearchResult =
  | { ok: true; hits: CodeSearchHit[]; indexedChunks: number }
  | { ok: false; reason: string };
export interface IndexStats {
  filesIndexed: number;
  filesSkipped: number;
  chunksEmbedded: number;
}

let _db: SqliteDatabase | null = null;
let _dbPath: string = DEFAULT_DB_PATH;

/** Test seam: override the DB path (use a temp path in tests) + drop the open handle. */
export function _setCodeIndexDbPath(path: string): void {
  _dbPath = path;
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
}

function db(): SqliteDatabase {
  if (!_db) {
    _db = openDB(_dbPath);
    _db.exec(`CREATE TABLE IF NOT EXISTS code_chunks (
      chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      mtime INTEGER NOT NULL
    )`);
    _db.exec("CREATE INDEX IF NOT EXISTS idx_code_chunks_path ON code_chunks(file_path)");
  }
  return _db;
}

/** Split a file's content into ~CHUNK_CHARS chunks, tracking 1-based line ranges. */
function chunkFile(content: string): Array<{ startLine: number; endLine: number; text: string }> {
  const lines = content.split("\n");
  if (content.length <= CHUNK_CHARS) {
    return [{ startLine: 1, endLine: lines.length, text: content }];
  }
  const chunks: Array<{ startLine: number; endLine: number; text: string }> = [];
  let i = 0;
  while (i < lines.length) {
    let size = 0;
    const start = i;
    while (i < lines.length && size < CHUNK_CHARS) {
      size += lines[i]!.length + 1;
      i++;
    }
    chunks.push({ startLine: start + 1, endLine: i, text: lines.slice(start, i).join("\n") });
  }
  return chunks;
}

/** Walk the workspace root, yielding supported source files. Does NOT follow
 * symlinks (readdirSync Dirent.isDirectory() is false for symlinks) → no escape
 * outside the workspace. Skips hidden entries + generated/dependency dirs. */
function* walkSource(root: string): Generator<string> {
  let count = 0;
  const stack = [root];
  while (stack.length > 0 && count < MAX_FILES) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) stack.push(full);
      } else if (ent.isFile()) {
        if (SUPPORTED_EXT.has(extname(ent.name))) {
          yield full;
          count++;
        }
      }
    }
  }
}

/** Index (or refresh) the codebase at root. Incremental by mtime — unchanged
 * files are skipped (no re-embed). No-op when embeddings are disabled.
 * NOTE: the first call for a large workspace embeds every chunk and may take a
 * while; subsequent calls re-embed only changed files. */
export async function indexCodebase(root: string): Promise<IndexStats> {
  if (embeddingsDisabled()) return { filesIndexed: 0, filesSkipped: 0, chunksEmbedded: 0 };
  const d = db();
  const stats: IndexStats = { filesIndexed: 0, filesSkipped: 0, chunksEmbedded: 0 };
  const selMtime = d.prepare("SELECT mtime FROM code_chunks WHERE file_path = ? LIMIT 1");
  const del = d.prepare("DELETE FROM code_chunks WHERE file_path = ?");
  const ins = d.prepare(
    "INSERT INTO code_chunks (file_path, start_line, end_line, content, embedding, mtime) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const abs of walkSource(root)) {
    let st: { mtimeMs: number };
    try { st = statSync(abs); } catch { continue; }
    const mtime = Math.floor(st.mtimeMs);
    const existing = selMtime.get(abs) as { mtime: number } | undefined;
    if (existing && existing.mtime === mtime) { stats.filesSkipped++; continue; }
    del.run(abs);
    let content: string;
    try { content = readFileSync(abs, "utf8"); } catch { continue; }
    if (content.length > MAX_FILE_BYTES) { stats.filesSkipped++; continue; }
    for (const ch of chunkFile(content)) {
      const vec = await embedContent(ch.text);
      ins.run(abs, ch.startLine, ch.endLine, ch.text, vec ? vecToBuffer(vec) : null, mtime);
      if (vec) stats.chunksEmbedded++;
    }
    stats.filesIndexed++;
  }
  return stats;
}

/** Semantic search: find code chunks whose MEANING matches the query.
 * Returns ranked {file, line range, snippet, score} hits. Degrades to ok:false
 * (with a "use grep" reason) when embeddings are unavailable. */
export async function semanticSearch(
  query: string,
  root: string,
  topK = 8,
): Promise<CodeSearchResult> {
  if (embeddingsDisabled()) {
    return { ok: false, reason: "embeddings disabled (MYA_NO_EMBEDDINGS or fastembed absent) — use grep" };
  }
  // Refresh the index first (incremental; cheap when nothing changed).
  await indexCodebase(root);
  const qvec = await embedContent(query);
  if (!qvec) {
    return { ok: false, reason: "embeddings unavailable (fastembed not installed or model not downloaded) — use grep" };
  }
  const dim = embeddingDim();
  const d = db();
  // Scope to the workspace root (prefix-safe: the trailing '/' prevents
  // /proj-other matching /proj/...).
  const rootPrefix = root.replace(/\/+$/, "") + "/";
  const rows = d.prepare(
    "SELECT file_path, start_line, end_line, content, embedding FROM code_chunks WHERE embedding IS NOT NULL AND file_path LIKE ? LIMIT ?",
  ).all(rootPrefix + "%", COSINE_CANDIDATE_LIMIT) as Array<{
    file_path: string; start_line: number; end_line: number; content: string; embedding: Uint8Array;
  }>;
  const hits: CodeSearchHit[] = [];
  for (const r of rows) {
    const v = bufferToVec(r.embedding, dim);
    if (!v) continue;
    hits.push({
      filePath: r.file_path,
      startLine: r.start_line,
      endLine: r.end_line,
      snippet: r.content.slice(0, 200).replace(/\n/g, " "),
      score: cosine(qvec, v),
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return { ok: true, hits: hits.slice(0, topK), indexedChunks: rows.length };
}

/** Test seam: close + drop the open DB handle. */
export function _resetCodeIndex(): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
}
