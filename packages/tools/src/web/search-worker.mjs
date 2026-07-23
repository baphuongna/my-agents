// search-worker.mjs — Disposable child process for web search.
//
// Reads ONE JSON request from stdin, writes ONE JSON response to stdout,
// then exits. The parent kills this process on timeout/interrupt — this
// worker installs NO signal handlers (disposable by design).
//
// Ported from Hermes `_search_worker.py` (#68096 — deep-dive-r3.md §4).
//
// Protocol:
//   Request  (stdin):  {"query": "...", "safeLimit": 5}
//   Response (stdout): {"ok": true, "results": [...]}
//                       {"ok": false, "error": "..."}
//
// The actual search implementation is injected by the parent via the
// MYA_SEARCH_MODULE env var (absolute path to an ESM module exporting
// `search(query, limit) → SearchResult[]`).

// Read ONE JSON request from stdin.
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

let request;
try {
  request = JSON.parse(input);
} catch (e) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: `Invalid JSON: ${e.message}` }),
  );
  process.exit(1);
}

const query = String(request.query || "");
const safeLimit = Math.max(1, parseInt(request.safeLimit || "5", 10));

try {
  const results = await runSearch(query, safeLimit);
  process.stdout.write(JSON.stringify({ ok: true, results }));
  process.exit(0);
} catch (e) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e) }),
  );
  process.exit(1);
}

/**
 * Delegate to the search module configured by the parent via env var.
 *
 * @param {string} query - search query
 * @param {number} limit - max results
 * @returns {Promise<Array>} search results
 */
async function runSearch(query, limit) {
  const modPath = process.env.MYA_SEARCH_MODULE;
  if (modPath) {
    const mod = await import(modPath);
    return mod.search(query, limit);
  }
  throw new Error("No search module configured (MYA_SEARCH_MODULE not set)");
}
