# tools/

CLI utilities. Run with `node tools/<name>.mjs ...` or via `npm run`.

| script | purpose | usage |
|---|---|---|
| `compact-thinking.mjs` | strip `<thinking>` blocks from session JSONLs | `--dry-run` / `--archive` / `--marker` |
| `skill-loader.mjs` | lazy SKILL.md loader (≤80-char desc, full on demand) | `list` / `read <name>` / `cache-clear` |
| `fs-cache.mjs` | memoize `ls` / `rg` / `find` / `stat` by `(cwd, argv) + mtime` | `exec -- <cmd> [args]` / `ls|rg|find|stat [...]` |

Caches live in `.prompts/*.jsonl` (append-only).