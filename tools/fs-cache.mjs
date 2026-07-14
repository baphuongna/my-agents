#!/usr/bin/env node
// tools/fs-cache.mjs — memoize `ls` / `rg` (and friends) by (cwd, argv) + mtime.
//
// Usage:
//   node tools/fs-cache.mjs exec -- ls -la path/    # cacheable wrapper
//   node tools/fs-cache.mjs ls <path>               # convenience: ls + cache
//   node tools/fs-cache.mjs rg <args...>            # convenience: rg + cache
//   node tools/fs-cache.mjs cache-clear             # drop cache
//
// Cache: .prompts/fs-cache.jsonl (append-only).
// Invalidation: mtime of the first non-flag positional arg, or the cwd.
//
// Scope: only `ls` / `rg` / `find` / `stat` are cached. Anything else passes
// through and is NOT memoized (safety: don't cache side-effectful commands).
// Pass --no-cache or set FSCACHE=0 to bypass unconditionally.

import { readFile, writeFile, stat, mkdir, appendFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(ROOT, '.prompts', 'fs-cache.jsonl');
const TTL_MS = 60 * 60 * 1000; // 1h
const CACHEABLE = new Set(['ls', 'rg', 'find', 'stat']);
const BYPASS = process.env.FSCACHE === '0' || process.argv.includes('--no-cache');

async function loadCache() {
  if (!existsSync(CACHE)) return new Map();
  const map = new Map();
  const text = await readFile(CACHE, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      map.set(e.key, e);
    } catch {}
  }
  return map;
}

async function storeCache(entry) {
  mkdir(dirname(CACHE), { recursive: true }).catch(() => {});
  await appendFile(CACHE, JSON.stringify(entry) + '\n');
}

function keyOf(cwd, argv) {
  return `${cwd}\x1f${argv.join('\x1f')}`;
}

function firstPositional(argv) {
  for (const a of argv) if (!a.startsWith('-')) return a;
  return null;
}

async function mtimeOr0(p) {
  if (!p) return 0;
  try { return (await stat(p)).mtimeMs; } catch { return 0; }
}

async function cacheHit(entry, argv) {
  if (!entry) return false;
  if (Date.now() - entry.storedAt > TTL_MS) return false;
  const path = firstPositional(argv) || entry.cwd;
  const m = await mtimeOr0(path);
  return m === entry.mtimeAtRun;
}

function run(cmd, argv, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', reject);
    child.on('close', code => resolve({ code, out, err }));
  });
}

async function exec(argv) {
  if (argv.length === 0) {
    console.error('usage: exec -- <cmd> [args...]');
    process.exit(1);
  }
  const cmd = argv[0];
  const cmdArgs = argv.slice(1);
  const cwd = process.cwd();
  const isCacheable = CACHEABLE.has(cmd);

  if (isCacheable && !BYPASS) {
    const cache = await loadCache();
    const key = keyOf(cwd, [cmd, ...cmdArgs]);
    const entry = cache.get(key);
    if (await cacheHit(entry, cmdArgs)) {
      process.stdout.write(entry.out);
      if (entry.err) process.stderr.write(entry.err);
      process.exit(entry.code);
      return;
    }
  }

  const { code, out, err } = await run(cmd, cmdArgs, cwd);
  process.stdout.write(out);
  process.stderr.write(err);

  if (isCacheable && !BYPASS) {
    const path = firstPositional(cmdArgs) || cwd;
    const m = await mtimeOr0(path);
    await storeCache({
      key: keyOf(cwd, [cmd, ...cmdArgs]),
      cwd,
      argv: [cmd, ...cmdArgs],
      mtimeAtRun: m,
      storedAt: Date.now(),
      code, out, err,
    });
  }
  process.exit(code);
}

async function cacheClear() {
  if (existsSync(CACHE)) {
    await writeFile(CACHE, '');
    console.log('cache cleared');
  } else {
    console.log('no cache');
  }
}

const cmd = process.argv[2];
if (cmd === 'exec') {
  // exec -- <cmd> [args...]
  const sep = process.argv.indexOf('--');
  const argv = sep >= 0 ? process.argv.slice(sep + 1) : process.argv.slice(3);
  exec(argv);
} else if (cmd === 'cache-clear') {
  cacheClear();
} else if (cmd === 'ls' || cmd === 'rg' || cmd === 'find' || cmd === 'stat') {
  exec([cmd, ...process.argv.slice(3)]);
} else {
  console.error('usage: exec -- <cmd> [args...] | ls|rg|find|stat [...] | cache-clear');
  process.exit(1);
}