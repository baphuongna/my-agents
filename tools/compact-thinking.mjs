#!/usr/bin/env node
// tools/compact-thinking.mjs — strip <thinking> blocks from session JSONLs.
//
// Session JSONL grows ~1–2 KB/turn from assistant thinking. On long sessions
// this dominates context size. This tool rewrites session files in place,
// dropping (or compacting) thinking parts while keeping text + toolCall parts.
//
// Usage:
//   node tools/compact-thinking.mjs <file.jsonl> [more.jsonl ...]
//   node tools/compact-thinking.mjs --dry-run <file...>      # report only
//   node tools/compact-thinking.mjs --marker <file...>       # keep "[thinking stripped: N chars]" instead of dropping
//   node tools/compact-thinking.mjs --archive <file...>      # move original to <file>.pre-compact, write to <file>
//
// Atomic write: writes to <file>.tmp then renames.

import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const useMarker = args.includes('--marker');
const archive = args.includes('--archive');
const files = args.filter(a => !a.startsWith('--'));

function compactEntry(entry) {
	if (entry.type !== 'message') return { entry, removed: 0 };
	const msg = entry.message;
	if (!msg || msg.role !== 'assistant') return { entry, removed: 0 };
	const content = msg.content;
	if (!Array.isArray(content)) return { entry, removed: 0 };

	let removed = 0;
	const next = content.filter(part => {
		if (part && part.type === 'thinking') {
			removed += JSON.stringify(part).length;
			return false;
		}
		return true;
	});

	if (useMarker && removed > 0) {
		// insert a tiny placeholder at the original index of the first thinking block
		const firstIdx = content.findIndex(p => p && p.type === 'thinking');
		const marker = { type: 'text', text: `[thinking stripped: ${removed} chars]` };
		next.splice(Math.min(firstIdx, next.length), 0, marker);
	}

	if (removed > 0) {
		entry = { ...entry, message: { ...msg, content: next } };
	}
	return { entry, removed };
}

async function processFile(path) {
	if (!existsSync(path)) {
		console.error(`skip (not found): ${path}`);
		return;
	}
	const before = (await stat(path)).size;
	const text = await readFile(path, 'utf8');
	const lines = text.split('\n');

	let totalRemoved = 0;
	let entriesTouched = 0;
	const out = [];

	for (const line of lines) {
		if (!line.trim()) { out.push(line); continue; }
		let entry;
		try { entry = JSON.parse(line); }
		catch { out.push(line); continue; }

		const { entry: next, removed } = compactEntry(entry);
		if (removed > 0) {
			entriesTouched++;
			totalRemoved += removed;
		}
		out.push(JSON.stringify(next));
	}

	const after = Buffer.byteLength(out.join('\n'), 'utf8');
	const pct = before > 0 ? ((1 - after / before) * 100).toFixed(1) : '0.0';
	console.log(`${path}`);
	console.log(`  before:  ${before.toLocaleString()} B`);
	console.log(`  after:   ${after.toLocaleString()} B`);
	console.log(`  removed: ${totalRemoved.toLocaleString()} chars across ${entriesTouched} entries (${pct}% smaller)`);

	if (dryRun) return;

	const tmp = path + '.compact-tmp';
	await writeFile(tmp, out.join('\n'), 'utf8');
	if (archive) {
		await rename(path, path + '.pre-compact');
	}
	await rename(tmp, path);
}

if (files.length === 0) {
	console.error('usage: compact-thinking.mjs [--dry-run|--marker|--archive] <file.jsonl> [...]');
	process.exit(1);
}

for (const f of files) await processFile(f);