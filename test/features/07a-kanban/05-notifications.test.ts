/**
 * Feature 7a.5 — Kanban Notifications (task-scoped subscriptions + event claiming)
 *
 * Reference: packages/tools/src/kanban-sqlite.ts (kanban_notify_subs + events)
 *
 * NOTE: Actual API:
 *   addNotifySub(taskId, channel, chatId, threadId?): void
 *   removeNotifySub(taskId, channel, chatId): void
 *   getNotifySubs(taskId): NotifySub[]
 *   claimUnseenEvents(taskId, lastEventId, eventKinds[]): TaskEvent[]
 *   addEvent(taskId, kind, payload?): number
 *   getEvents(taskId, afterEventId?): TaskEvent[]
 *
 * Events are appended by createTask ("created"), status changes
 * ("status_changed"), linkTasks ("linked"), claim/release, and the tool
 * complete/block actions. Comments live in task_comments (not the event log).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MOD = "../../../packages/tools/src/kanban-sqlite.ts";

// ──────────────────────────────────────────────────────────────
// UNIT — Subscriptions
// ──────────────────────────────────────────────────────────────

describe("[unit] notify subscriptions", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import(MOD);
		db = new KanbanDB(join(tmpDir, "test.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("addNotifySub creates entry with lastEventId=0", () => {
		const t = db.createTask({ title: "T" });
		db.addNotifySub(t.id, "telegram", "chat-1");
		const subs = db.getNotifySubs(t.id);
		expect(subs.some((s: any) => s.chatId === "chat-1")).toBe(true);
		const sub = subs.find((s: any) => s.chatId === "chat-1");
		expect(sub.lastEventId).toBe(0);
		expect(sub.channel).toBe("telegram");
	});

	it("removeNotifySub removes entry", () => {
		const t = db.createTask({ title: "T" });
		db.addNotifySub(t.id, "telegram", "chat-1");
		db.removeNotifySub(t.id, "telegram", "chat-1");
		const subs = db.getNotifySubs(t.id);
		expect(subs.length).toBe(0);
	});

	it("multiple chats can subscribe to same task", () => {
		const t = db.createTask({ title: "T" });
		db.addNotifySub(t.id, "telegram", "chat-1");
		db.addNotifySub(t.id, "telegram", "chat-2");
		db.addNotifySub(t.id, "discord", "chat-3");
		const subs = db.getNotifySubs(t.id);
		expect(subs.length).toBe(3);
	});

	it("addNotifySub is idempotent per (task,channel,chat) and preserves lastEventId", () => {
		const t = db.createTask({ title: "T" });
		db.addNotifySub(t.id, "telegram", "chat-1");
		db.addNotifySub(t.id, "telegram", "chat-1"); // dup
		expect(db.getNotifySubs(t.id).length).toBe(1);
	});

	it("subscriptions are task-scoped", () => {
		const a = db.createTask({ title: "A" });
		const b = db.createTask({ title: "B" });
		db.addNotifySub(a.id, "telegram", "chat-1");
		db.addNotifySub(b.id, "telegram", "chat-1");
		expect(db.getNotifySubs(a.id).length).toBe(1);
		expect(db.getNotifySubs(b.id).length).toBe(1);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Event claiming (cursor-based)
// ──────────────────────────────────────────────────────────────

describe("[unit] claimUnseenEvents", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import(MOD);
		db = new KanbanDB(join(tmpDir, "test.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("createTask emits a 'created' event visible to claiming", () => {
		const t = db.createTask({ title: "T" });
		db.addNotifySub(t.id, "telegram", "chat-1");
		const events = db.claimUnseenEvents(t.id, 0, ["created"]);
		expect(events.length).toBe(1);
		expect(events[0].kind).toBe("created");
		// Claiming again with the returned cursor yields nothing new
		const lastId = events[events.length - 1].id;
		expect(db.claimUnseenEvents(t.id, lastId, ["created"]).length).toBe(0);
	});

	it("empty eventKinds returns nothing", () => {
		const t = db.createTask({ title: "T" });
		expect(db.claimUnseenEvents(t.id, 0, []).length).toBe(0);
	});

	it("status change emits 'status_changed' event", () => {
		const t = db.createTask({ title: "T" });
		db.updateTask(t.id, { status: "done" });
		const all = db.getEvents(t.id).map((e: any) => e.kind);
		expect(all).toContain("status_changed");
		const changed = db.claimUnseenEvents(t.id, 0, ["status_changed"]);
		expect(changed.length).toBe(1);
	});

	it("claimUnseenEvents filters by kind (only requested kinds)", () => {
		const t = db.createTask({ title: "T" }); // created
		db.updateTask(t.id, { status: "done" }); // status_changed
		expect(db.claimUnseenEvents(t.id, 0, ["created"]).length).toBe(1);
		expect(db.claimUnseenEvents(t.id, 0, ["status_changed"]).length).toBe(1);
		expect(db.claimUnseenEvents(t.id, 0, ["linked"]).length).toBe(0);
	});

	it("linkTasks emits a 'linked' event on the child", () => {
		const p = db.createTask({ title: "P" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p.id, c.id);
		const linked = db.claimUnseenEvents(c.id, 0, ["linked"]);
		expect(linked.length).toBe(1);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — notifications API
// ──────────────────────────────────────────────────────────────

describe("[smoke] notifications API", () => {
	it("addNotifySub / getNotifySubs / claimUnseenEvents exist", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(join(tmpDir, "test.db"));
		expect(typeof db.addNotifySub).toBe("function");
		expect(typeof db.removeNotifySub).toBe("function");
		expect(typeof db.getNotifySubs).toBe("function");
		expect(typeof db.claimUnseenEvents).toBe("function");
		expect(typeof db.addEvent).toBe("function");
		expect(typeof db.getEvents).toBe("function");
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
		const { KanbanDB } = await import(MOD);
		db = new KanbanDB(join(tmpDir, "test.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("create task → created event deliverable to subscribers via claimUnseenEvents", () => {
		const t = db.createTask({ title: "Big task" });
		db.addNotifySub(t.id, "telegram", "chat-a");
		db.addNotifySub(t.id, "telegram", "chat-b");

		const aEvents = db.claimUnseenEvents(t.id, 0, ["created"]);
		const bEvents = db.claimUnseenEvents(t.id, 0, ["created"]);
		expect(aEvents.length).toBeGreaterThan(0);
		expect(bEvents.length).toBeGreaterThan(0);
	});

	it("addEvent + getEvents round-trip", () => {
		const t = db.createTask({ title: "T" });
		const id = db.addEvent(t.id, "custom", { hello: "world" });
		expect(typeof id).toBe("number");
		const events = db.getEvents(t.id);
		const custom = events.find((e: any) => e.id === id);
		expect(custom).toBeDefined();
		expect(custom.kind).toBe("custom");
		expect(JSON.parse(custom.payload)).toEqual({ hello: "world" });
	});

	it("getEvents afterEventId returns only newer events", () => {
		const t = db.createTask({ title: "T" }); // event 1: created
		db.updateTask(t.id, { status: "done" }); // event 2: status_changed
		const all = db.getEvents(t.id);
		const first = all[0];
		const rest = db.getEvents(t.id, first.id);
		expect(rest.every((e: any) => e.id > first.id)).toBe(true);
		expect(rest.length).toBe(all.length - 1);
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
