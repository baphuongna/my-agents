#!/usr/bin/env node
// tools/skill-loader.mjs — lazy SKILL.md loader with session cache.
//
// Usage:
//   node tools/skill-loader.mjs list              # name + ≤80-char desc per skill
//   node tools/skill-loader.mjs read <name>       # full SKILL.md (uses cache)
//   node tools/skill-loader.mjs cache-clear       # drop the cache
//
// Cache: .prompts/skill-cache.jsonl (append-only, one JSON per line).
// Entries: {name, loadedAt, body}. Full bodies are loaded on demand only.

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(ROOT, '.prompts', 'skill-cache.jsonl');

// Skill search roots (first one that contains a SKILL.md wins).
const SKILL_ROOTS = [
  join(process.env.HOME || '', '.agents', 'skills'),
  join(ROOT, '.agents', 'skills'),
  join(ROOT, 'packages', 'skills'), // if project-local skills exist
];

const DESC_MAX = 80;

async function findSkillDir(name) {
  for (const root of SKILL_ROOTS) {
    const dir = join(root, name);
    try {
      const s = await stat(dir);
      if (s.isDirectory() && existsSync(join(dir, 'SKILL.md'))) return dir;
    } catch {}
  }
  return null;
}

function parseFrontmatter(md) {
  if (!md.startsWith('---')) return { name: null, description: '' };
  const end = md.indexOf('\n---', 3);
  if (end < 0) return { name: null, description: '' };
  const fm = md.slice(3, end);
  const out = {};
  for (const line of fm.split('\n')) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return { name: out.name || null, description: out.description || '' };
}

function shortDesc(desc) {
  // First sentence, ≤80 chars. If truncated, append ellipsis.
  const first = desc.split(/[.\n]/)[0].trim();
  if (first.length <= DESC_MAX) return first;
  return first.slice(0, DESC_MAX - 1).trimEnd() + '…';
}

async function readCache() {
  if (!existsSync(CACHE)) return new Map();
  const map = new Map();
  const text = await readFile(CACHE, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      map.set(entry.name, entry);
    } catch {}
  }
  return map;
}

async function appendCache(entry) {
  mkdirSync(dirname(CACHE), { recursive: true });
  await readFile(CACHE, 'utf8').catch(() => '');
  const fs = await import('node:fs/promises');
  await fs.appendFile(CACHE, JSON.stringify(entry) + '\n');
}

async function listSkills() {
  const seen = new Set();
  const skills = [];
  for (const root of SKILL_ROOTS) {
    let entries = [];
    try { entries = await readdir(root); } catch { continue; }
    for (const name of entries) {
      if (seen.has(name)) continue;
      const dir = await findSkillDir(name);
      if (!dir) continue;
      seen.add(name);
      const md = await readFile(join(dir, 'SKILL.md'), 'utf8');
      const { description } = parseFrontmatter(md);
      skills.push({ name, description: shortDesc(description) });
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

async function readSkill(name) {
  const cache = await readCache();
  if (cache.has(name)) return cache.get(name).body;
  const dir = await findSkillDir(name);
  if (!dir) {
    console.error(`skill not found: ${name}`);
    process.exit(2);
  }
  const body = await readFile(join(dir, 'SKILL.md'), 'utf8');
  await appendCache({ name, loadedAt: Date.now(), body });
  return body;
}

const cmd = process.argv[2];
const arg = process.argv[3];

if (cmd === 'list') {
  for (const s of await listSkills()) {
    console.log(`${s.name}\t${s.description}`);
  }
} else if (cmd === 'read') {
  if (!arg) { console.error('usage: read <name>'); process.exit(1); }
  process.stdout.write(await readSkill(arg));
} else if (cmd === 'cache-clear') {
  if (existsSync(CACHE)) {
    const fs = await import('node:fs/promises');
    await fs.unlink(CACHE);
    console.log('cache cleared');
  } else {
    console.log('no cache');
  }
} else {
  console.error('usage: list | read <name> | cache-clear');
  process.exit(1);
}