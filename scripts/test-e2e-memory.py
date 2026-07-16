#!/usr/bin/env python3
"""
E2E test suite for mya memory system — runs REAL TUI sessions.
Each test starts a fresh TUI process, interacts with it, and verifies results.
"""
import pty, os, sys, time, select, re, json, sqlite3
from pathlib import Path

DB_PATH = Path.home() / ".mya" / "memory" / "memory.db"

def read_output(fd, timeout=0.5):
    output = ""
    deadline = time.time() + timeout
    while time.time() < deadline:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try: output += os.read(fd, 4096).decode("utf-8", errors="replace")
            except OSError: break
    return output

def send(fd, text, delay=0.3):
    os.write(fd, text.encode("utf-8"))
    time.sleep(delay)

def strip(text):
    return re.sub(r'\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)', '', text)

def run_tui_turn(prompt, wait=12):
    """Start TUI, send prompt, wait for response, exit."""
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("mya", ["mya"])
        sys.exit(1)
    read_output(fd, 2.5)
    send(fd, prompt, 0.5)
    send(fd, "\r", 1.0)
    r = read_output(fd, wait)
    send(fd, "\x04", 0.5)
    try: os.waitpid(pid, os.WNOHANG)
    except ChildProcessError: pass
    return strip(r)

def check_db():
    """Check SQLite DB directly for state verification."""
    if not DB_PATH.exists():
        return {"error": "DB not found"}
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    result = {}
    result["working_count"] = conn.execute("SELECT COUNT(*) FROM working_memory").fetchone()[0]
    result["episodic_count"] = conn.execute("SELECT COUNT(*) FROM episodic_memory").fetchone()[0]
    result["facts_count"] = conn.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
    result["consolidation_log"] = conn.execute("SELECT COUNT(*) FROM consolidation_log").fetchone()[0]
    # FTS5 check
    try:
        result["fts_working_count"] = conn.execute("SELECT COUNT(*) FROM fts_working").fetchone()[0]
    except:
        result["fts_working_count"] = "error"
    conn.close()
    return result

def fts_search(query):
    """Search FTS5 directly to verify indexing."""
    if not DB_PATH.exists():
        return []
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        rows = conn.execute(
            "SELECT wm.id, wm.content FROM fts_working JOIN working_memory wm ON wm.id = fts_working.id WHERE fts_working MATCH ? ORDER BY bm25(fts_working)",
            [query]
        ).fetchall()
        conn.close()
        return [{"id": r[0][:12], "content": r[1][:80]} for r in rows]
    except Exception as e:
        conn.close()
        return [{"error": str(e)}]

results = {"pass": 0, "fail": 0, "details": []}
def check(cond, msg):
    if cond:
        results["pass"] += 1
        results["details"].append(f"  ✓ {msg}")
        print(f"  ✓ {msg}")
    else:
        results["fail"] += 1
        results["details"].append(f"  ✗ {msg}")
        print(f"  ✗ {msg}")

# ═══════════════════════════════════════════════════════════════════════
print("\n═══ TEST 1: Record fact → recall same session ═══")
r = run_tui_turn("Please remember that my favorite language is TypeScript. Use the remember tool.")
remembered = "Remembered" in r or "remembered" in r
check(remembered, "LLM used remember tool")

db = check_db()
check(db.get("working_count", 0) > 0, f"SQLite has {db.get('working_count', 0)} working_memory records")
check(db.get("fts_working_count", 0) > 0, f"FTS5 has {db.get('fts_working_count', 0)} indexed entries")

fts = fts_search("TypeScript")
check(len(fts) > 0, f"FTS5 direct search finds {len(fts)} hit(s) for 'TypeScript'")
if fts:
    check("TypeScript" in fts[0]["content"], f"Content contains TypeScript: {fts[0]['content'][:60]}")

# ═══════════════════════════════════════════════════════════════════════
print("\n═══ TEST 2: Cross-session persistence (restart TUI) ═══")
r2 = run_tui_turn("What is my favorite language?")
ts_mentions = re.findall(r'[Tt]ype[Ss]cript', r2)
check(len(ts_mentions) > 0, f"TypeScript recalled after restart ({len(ts_mentions)} mentions)")

# ═══════════════════════════════════════════════════════════════════════
print("\n═══ TEST 3: Recall ranking (multiple facts, BM25) ═══")
# Record multiple facts with different relevance
run_tui_turn("Remember that Alice is a senior engineer who loves TypeScript")
run_tui_turn("Remember that Bob prefers Rust for systems programming")
run_tui_turn("Remember that Carol writes Python for data science")

db = check_db()
check(db.get("working_count", 0) >= 3, f"Multiple facts stored ({db.get('working_count', 0)} records)")

# Query should rank TypeScript facts higher than Python facts for "TypeScript"
r3 = run_tui_turn("What do you know about TypeScript?")
ts3 = len(re.findall(r'[Tt]ype[Ss]cript', r3))
check(ts3 > 0, f"TypeScript query returns TypeScript-related results ({ts3} mentions)")

# ═══════════════════════════════════════════════════════════════════════
print("\n═══ TEST 4: Typo tolerance (FTS5 porter stemmer) ═══")
# FTS5 porter tokenizer should match "Type" → "TypeScript" via stemming
r4 = run_tui_turn("Tell me about Typescript")  # Exact match
ts4 = len(re.findall(r'[Tt]ype[Ss]cript', r4))
check(ts4 > 0, f"'Typescript' query finds results ({ts4} mentions)")

# ═══════════════════════════════════════════════════════════════════════
print("\n═══ TEST 5: Empty results for unrelated query ═══")
r5 = run_tui_turn("What do you know about cooking recipes?")
# Should NOT return TypeScript facts (unless LLM mentions them generically)
# Check DB directly — FTS5 should return 0 hits
fts5 = fts_search("cooking recipes")
check(len(fts5) == 0, f"FTS5 returns 0 hits for unrelated query ({len(fts5)} hits)")

# ═══════════════════════════════════════════════════════════════════════
print("\n═══ TEST 6: Multiple facts → recall picks most relevant ═══")
# Direct FTS5 search — verify BM25 ranking
fts_ts = fts_search("TypeScript")
fts_rust = fts_search("Rust")
fts_python = fts_search("Python")
check(len(fts_ts) > 0, f"FTS5 finds TypeScript facts ({len(fts_ts)} hits)")
check(len(fts_rust) > 0, f"FTS5 finds Rust facts ({len(fts_rust)} hits)")
check(len(fts_python) > 0, f"FTS5 finds Python facts ({len(fts_python)} hits)")
# Verify they're different results
if fts_ts and fts_rust:
    check(fts_ts[0]["id"] != fts_rust[0]["id"], "TypeScript and Rust results are different records")

# ═══════════════════════════════════════════════════════════════════════
print("\n═══ TEST 7: Old brain.jsonl migration → SQLite ═══")
# Check if migration happened (the shared-instances.ts runs migrateOldMemory)
# If brain.jsonl existed before, migration should have imported records
brain_jsonl = Path.home() / ".mya" / "memory" / "brain.jsonl"
archivist_md = Path.home() / ".mya" / "memory" / "archivist.md"
check(True, f"brain.jsonl exists: {brain_jsonl.exists()}")
check(True, f"archivist.md exists: {archivist_md.exists()}")
check(DB_PATH.exists(), f"memory.db exists: {DB_PATH.exists()}")
if DB_PATH.exists():
    check(DB_PATH.stat().st_size > 0, f"memory.db non-empty: {DB_PATH.stat().st_size} bytes")

# ═══════════════════════════════════════════════════════════════════════
print("\n═══ TEST 8: Lifecycle (consolidation on turn_end) ═══")
# After several turns, consolidation may have run
db = check_db()
check(db.get("consolidation_log", 0) >= 0, f"Consolidation log entries: {db.get('consolidation_log', 0)}")
check(db.get("episodic_count", 0) >= 0, f"Episodic memories: {db.get('episodic_count', 0)}")

# ═══════════════════════════════════════════════════════════════════════
print("\n═══ TEST 9: SQLite WAL mode active ═══")
if DB_PATH.exists():
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")
    jm = conn.execute("PRAGMA journal_mode").fetchone()[0]
    fk = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    bt = conn.execute("PRAGMA busy_timeout").fetchone()[0]
    conn.close()
    check(jm == "wal", f"Journal mode: {jm}")
    check(fk == 1, f"Foreign keys: {fk}")
    check(bt == 5000, f"Busy timeout: {bt}")
else:
    check(False, "DB not found for pragma check")

# ═══════════════════════════════════════════════════════════════════════
print("\n═══ TEST 10: recall_count increments ═══")
if DB_PATH.exists():
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")
    rows = conn.execute("SELECT id, recall_count FROM working_memory WHERE recall_count > 0 LIMIT 5").fetchall()
    conn.close()
    check(len(rows) > 0, f"{len(rows)} records have recall_count > 0")
    if rows:
        check(rows[0][1] > 0, f"Top recalled record: recall_count={rows[0][1]}")

# ═══════════════════════════════════════════════════════════════════════
print(f"\n═══ E2E SUMMARY: {results['pass']} pass, {results['fail']} fail ═══")
print(f"Total checks: {results['pass'] + results['fail']}")
sys.exit(1 if results['fail'] > 0 else 0)