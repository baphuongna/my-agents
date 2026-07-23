/**
 * Feature 7a.5 — Kanban Notifications (subscription-based event delivery with
 *              cursor + 3-strike dead chat detection)
 *
 * Reference: packages/tools/src/kanban-sqlite.ts (kanban_notify_subs)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — Subscription + cursor
// ──────────────────────────────────────────────────────────────

describe("[unit] subscription cursor", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		db = new KanbanDB(join(tmpDir, "test.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("subscribe creates entry with cursor=0", () => {
		const r = db.subscribe?.("chat-1", "all");
		expect(r?.subscribed).toBe(true);
	});

	it("unsubscribe removes entry", () => {
		db.subscribe?.("chat-1", "all");
		const r = db.unsubscribe?.("chat-1");
		expect(r?.unsubscribed).toBe(true);
	});

	it("multiple chats can subscribe to same filter", () => {
		db.subscribe?.("chat-1", "all");
		db.subscribe?.("chat-2", "all");
		db.subscribe?.("chat-3", "all");
		const subs = db.listSubscriptions?.();
		expect(subs.length).toBe(3);
	});

	it("events advance cursor", () => {
		db.subscribe?.("chat-1", "all");
		const t1 = db.createTask({ title: "T" });
		const events1 = db.fetchNotifications?.("chat-1", { limit: 10 });
		expect(events1.events.length).toBeGreaterThan(0);
		const lastEvent = events1.events[events1.events.length - 1];
		db.ackNotification?.("chat-1", lastEvent.id);
		const events2 = db.fetchNotifications?.("chat-1", { limit: 10 });
		expect(events2.events.length).toBe(0); // all acked
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Dead-chat detection (3-strike)
// ──────────────────────────────────────────────────────────────

describe("[unit] 3-strike dead chat detection", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		db = new KanbanDB(join(tmpDir, "test.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("consecutive failures tracked", () => {
		db.subscribe?.("chat-dead", "all");
		db.markNotifyFailure?.("chat-dead", new Error("send failed"));
		db.markNotifyFailure?.("chat-dead", new Error("send failed"));
		const sub = db.getSubscription?.("chat-dead");
		expect(sub.consecutive_failures).toBe(2);
	});

	it("3 failures → chat marked dead", () => {
		db.subscribe?.("chat-dead", "all");
		db.markNotifyFailure?.("chat-dead", new Error("1"));
		db.markNotifyFailure?.("chat-dead", new Error("2"));
		db.markNotifyFailure?.("chat-dead", new Error("3"));
		const sub = db.getSubscription?.("chat-dead");
		expect(sub.dead).toBe(true);
	});

	it("successful notification resets failure count", () => {
		db.subscribe?.("chat-resurrect", "all");
		db.markNotifyFailure?.("chat-resurrect", new Error("1"));
		db.markNotifyFailure?.("chat-resurrect", new Error("2"));
		db.markNotifySuccess?.("chat-resurrect");
		const sub = db.getSubscription?.("chat-resurrect");
		expect(sub.consecutive_failures).toBe(0);
		expect(sub.dead).toBe(false);
	});

	it("dead chats skipped during fetch", () => {
		db.subscribe?.("chat-a", "all");
		db.subscribe?.("chat-b", "all");
		for (let i = 0; i < 3; i++) db.markNotifyFailure?.("chat-b", new Error("x"));

		const liveSubs = db.listSubscriptions?.({ dead: false });
		expect(liveSubs.some((s) => s.chat_id === "chat-a")).toBe(true);
		expect(liveSubs.some((s) => s.chat_id === "chat-b")).toBe(false);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Event types / filters
// ──────────────────────────────────────────────────────────────

describe("[unit] event filters", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		db = new KanbanDB(join(tmpDir, "test.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("filter 'task' only shows task events", () => {
		db.subscribe?.("chat-1", "task");
		const t = db.createTask({ title: "T" });
		const events = db.fetchNotifications?.("chat-1", { limit: 10 });
		// Only task events, no chat events
		expect(events.events.every((e) => e.kind === "task_created" || e.kind === "task_updated")).toBe(true);
	});

	it("filter 'comment' only shows comment events", () => {
		db.subscribe?.("chat-1", "comment");
		const t = db.createTask({ title: "T" });
		db.addComment?.(t.id, "user1", "Test comment");
		const events = db.fetchNotifications?.("chat-1", { limit: 10 });
		expect(events.events.every((e) => e.kind === "comment_added")).toBe(true);
	});

	it("filter 'all' shows everything", () => {
		db.subscribe?.("chat-1", "all");
		const t = db.createTask({ title: "T" });
		db.addComment?.(t.id, "user1", "comment");
		db.completeTask?.(t.id, "ok");
		const events = db.fetchNotifications?.("chat-1", { limit: 10 });
		expect(events.events.length).toBeGreaterThanOrEqual(3);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — notifications API
// ──────────────────────────────────────────────────────────────

describe("[smoke] notifications API", () => {
	it("subscribe / fetch / ack exist", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db = new KanbanDB(join(tmpDir, "test.db"));
		expect(typeof db.subscribe).toBe("function");
		expect(typeof db.fetchNotifications).toBe("function");
		expect(typeof db.ackNotification).toBe("function");
		db.close?.();
		rmSync(tmpDir, { recursive: true });
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — realistic notification scenario
// ──────────────────────────────────────────────────────────────

describe("[real] notifications end-to-end", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		db = new KanbanDB(join(tmpDir, "test.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("create task → notification delivered to all subscribers", () => {
		db.subscribe?.("chat-a", "all");
		db.subscribe?.("chat-b", "all");
		db.createTask({ title: "Big task" });

		const aEvents = db.fetchNotifications?.("chat-a", { limit: 100 });
		const bEvents = db.fetchNotifications?.("chat-b", { limit: 100 });
		expect(aEvents.events.length).toBeGreaterThan(0);
		expect(bEvents.events.length).toBeGreaterThan(0);
	});

	it("comment on task → comment notification", () => {
		db.subscribe?.("chat-c", "comment");
		const t = db.createTask({ title: "T" });
		db.addComment?.(t.id, "user", "Hey!");
		const events = db.fetchNotifications?.("chat-c", { limit: 100 });
		expect(events.events.length).toBe(1);
		expect(events.events[0].kind).toBe("comment_added");
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — multi-process notifications (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. spawn 2 workers
//   2. both subscribe
//   3. one writes event, both notified

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────
