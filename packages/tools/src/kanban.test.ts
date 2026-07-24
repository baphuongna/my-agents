/**
 * kanban.ts tests — JSON-based kanban task board tool.
 *
 * The tool persists to a hardcoded `~/.mya/kanban.json`. To keep tests
 * hermetic and non-destructive, we snapshot the existing file before each
 * suite run and restore it afterwards.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { kanbanTool } from "./kanban.js";

const KANBAN_PATH = join(homedir(), ".mya", "kanban.json");
const BACKUP_PATH = KANBAN_PATH + ".test-backup";

/** Read raw file content (or null if absent). */
function readRaw(): string | null {
  if (!existsSync(KANBAN_PATH)) return null;
  return readFileSync(KANBAN_PATH, "utf8");
}

/** Restore the original file (removes the test-created file). */
function restoreOriginal(saved: string | null): void {
  if (saved !== null) {
    mkdirSync(join(homedir(), ".mya"), { recursive: true });
    writeFileSync(KANBAN_PATH, saved);
  } else if (existsSync(KANBAN_PATH)) {
    rmSync(KANBAN_PATH);
  }
}

// ── Snapshot / restore around the entire suite ────────────────────────────
let originalSnapshot: string | null;

beforeAll(() => {
  originalSnapshot = readRaw();
});

afterAll(() => {
  restoreOriginal(originalSnapshot);
});

/** Wipe the store before each test so cases are independent. */
beforeEach(() => {
  if (existsSync(KANBAN_PATH)) rmSync(KANBAN_PATH);
});

// Helper to call the tool (ctx is unused by kanban).
function run(args: unknown) {
  return kanbanTool.run(args, {} as never);
}

// ── create_board ──────────────────────────────────────────────────────────
describe("kanban: create_board", () => {
  it("creates a board with three default columns and returns an id", async () => {
    const res = await run({ action: "create_board", board: "Sprint 1" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output).toHaveProperty("board_id");
      expect((res.output as { name: string }).name).toBe("Sprint 1");
    }

    // Verify persistence on disk: three columns present.
    const store = JSON.parse(readFileSync(KANBAN_PATH, "utf8"));
    expect(store.boards).toHaveLength(1);
    const board = store.boards[0];
    expect(board.name).toBe("Sprint 1");
    expect(board.columns).toHaveLength(3);
    expect(board.columns.map((c: { name: string }) => c.name)).toEqual([
      "To Do",
      "In Progress",
      "Done",
    ]);
  });

  it("rejects an empty board name", async () => {
    const res = await run({ action: "create_board", board: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("valid board name");
  });

  it("rejects path-traversal characters (sanitize)", async () => {
    for (const bad of ["../escape", "a/b", "a\\b", "a..b"]) {
      const res = await run({ action: "create_board", board: bad });
      expect(res.ok).toBe(false);
    }
  });

  it("rejects control characters in the name", async () => {
    const res = await run({ action: "create_board", board: "bad\x00name" });
    expect(res.ok).toBe(false);
  });

  it("rejects a name longer than 200 chars", async () => {
    const res = await run({ action: "create_board", board: "x".repeat(201) });
    expect(res.ok).toBe(false);
  });

  it("trims whitespace from a valid name", async () => {
    const res = await run({ action: "create_board", board: "  Trimmed  " });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.output as { name: string }).name).toBe("Trimmed");
    }
  });
});

// ── add_task ──────────────────────────────────────────────────────────────
describe("kanban: add_task", () => {
  it("adds a task to the default (first) column when no column given", async () => {
    await run({ action: "create_board", board: "B" });
    const res = await run({ action: "add_task", board: "B", task: "Write docs" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output).toHaveProperty("task_id");
      // Default column is "To Do" (the first column).
      expect((res.output as { column: string }).column).toBe("To Do");
    }
  });

  it("adds a task to a column specified by column id", async () => {
    await run({ action: "create_board", board: "B" });
    const res = await run({ action: "add_task", board: "B", task: "Go", column: "done" });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.output as { column: string }).column).toBe("Done");
  });

  it("adds a task to a column specified by column name", async () => {
    await run({ action: "create_board", board: "B" });
    const res = await run({
      action: "add_task",
      board: "B",
      task: "Go",
      column: "In Progress",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.output as { column: string }).column).toBe("In Progress");
  });

  it("falls back to the first column for an unknown column id", async () => {
    await run({ action: "create_board", board: "B" });
    const res = await run({
      action: "add_task",
      board: "B",
      task: "T",
      column: "nonexistent",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.output as { column: string }).column).toBe("To Do");
  });

  it("rejects when the board does not exist", async () => {
    const res = await run({ action: "add_task", board: "ghost", task: "T" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not found");
  });

  it("rejects an empty task title", async () => {
    await run({ action: "create_board", board: "B" });
    const res = await run({ action: "add_task", board: "B", task: "" });
    expect(res.ok).toBe(false);
  });

  it("rejects a task title with path traversal", async () => {
    await run({ action: "create_board", board: "B" });
    const res = await run({ action: "add_task", board: "B", task: "../etc" });
    expect(res.ok).toBe(false);
  });
});

// ── move_task ─────────────────────────────────────────────────────────────
describe("kanban: move_task", () => {
  it("moves a task to the target column by to_column id", async () => {
    await run({ action: "create_board", board: "B" });
    const add = await run({ action: "add_task", board: "B", task: "Item" });
    const taskId = (add.output as { task_id: string }).task_id;

    const res = await run({
      action: "move_task",
      board: "B",
      task: taskId,
      to_column: "done",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.output as { moved_to: string }).moved_to).toBe("Done");
  });

  it("moves a task matched by title (not id)", async () => {
    await run({ action: "create_board", board: "B" });
    await run({ action: "add_task", board: "B", task: "FindMe" });

    const res = await run({
      action: "move_task",
      board: "B",
      task: "FindMe",
      to_column: "doing",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.output as { moved_to: string }).moved_to).toBe("In Progress");
  });

  it("rejects move when the task is not found", async () => {
    await run({ action: "create_board", board: "B" });
    const res = await run({
      action: "move_task",
      board: "B",
      task: "nope",
      to_column: "done",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("task not found");
  });

  it("rejects move when the target column does not exist", async () => {
    await run({ action: "create_board", board: "B" });
    await run({ action: "add_task", board: "B", task: "T" });
    const res = await run({
      action: "move_task",
      board: "B",
      task: "T",
      to_column: "nowhere",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("target column not found");
  });

  it("rejects move when the board does not exist", async () => {
    const res = await run({
      action: "move_task",
      board: "ghost",
      task: "T",
      to_column: "done",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("board not found");
  });

  it("rejects move with an invalid (path-traversal) board name", async () => {
    const res = await run({
      action: "move_task",
      board: "../x",
      task: "T",
      to_column: "done",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("board required");
  });
});

// ── list ──────────────────────────────────────────────────────────────────
describe("kanban: list", () => {
  it("lists all boards with column task counts", async () => {
    await run({ action: "create_board", board: "A" });
    await run({ action: "create_board", board: "C" });
    await run({ action: "add_task", board: "A", task: "T1" });
    await run({ action: "add_task", board: "A", task: "T2" });

    const res = await run({ action: "list" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const out = res.output as {
        boards: { name: string; columns: { name: string; tasks: number }[] }[];
      };
      expect(out.boards).toHaveLength(2);
      const boardA = out.boards.find((b) => b.name === "A");
      expect(boardA).toBeDefined();
      expect(boardA!.columns[0]!.tasks).toBe(2); // both in "To Do"
    }
  });

  it("filters to a single board when board is provided", async () => {
    await run({ action: "create_board", board: "A" });
    await run({ action: "create_board", board: "B" });

    const res = await run({ action: "list", board: "B" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const out = res.output as { boards: { name: string }[] };
      expect(out.boards).toHaveLength(1);
      expect(out.boards[0]!.name).toBe("B");
    }
  });

  it("returns an empty board list when the store has no boards", async () => {
    const res = await run({ action: "list" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.output as { boards: unknown[] }).boards).toEqual([]);
    }
  });
});

// ── persistence + edge cases ──────────────────────────────────────────────
describe("kanban: persistence & edge cases", () => {
  it("persists across separate tool invocations (JSON file round-trip)", async () => {
    await run({ action: "create_board", board: "Persist" });
    await run({ action: "add_task", board: "Persist", task: "One" });
    await run({ action: "add_task", board: "Persist", task: "Two" });

    // A fresh list reads from disk (no in-memory cache).
    const res = await run({ action: "list", board: "Persist" });
    if (res.ok) {
      const out = res.output as {
        boards: { columns: { tasks: number }[] }[];
      };
      expect(out.boards[0]!.columns[0]!.tasks).toBe(2);
    }
  });

  it("survives a corrupted JSON file (falls back to empty store)", async () => {
    mkdirSync(join(homedir(), ".mya"), { recursive: true });
    writeFileSync(KANBAN_PATH, "{ broken json", { mode: 0o600 });

    // list should not throw — loadStore catches parse errors.
    const res = await run({ action: "list" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.output as { boards: unknown[] }).boards).toEqual([]);
    }
  });

  it("returns an error for an unknown action", async () => {
    const res = await run({ action: "delete_everything" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("unknown action");
  });

  it("returns an error when action is missing entirely", async () => {
    const res = await run({ board: "B" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("action required");
  });

  it("supports multiple boards independently", async () => {
    await run({ action: "create_board", board: "Proj-Alpha" });
    await run({ action: "create_board", board: "Proj-Beta" });
    await run({ action: "add_task", board: "Proj-Alpha", task: "Alpha task" });
    await run({ action: "add_task", board: "Proj-Beta", task: "Beta task" });

    const alpha = await run({ action: "list", board: "Proj-Alpha" });
    const beta = await run({ action: "list", board: "Proj-Beta" });
    if (alpha.ok && beta.ok) {
      const a = alpha.output as { boards: { columns: { tasks: number }[] }[] };
      const b = beta.output as { boards: { columns: { tasks: number }[] }[] };
      expect(a.boards[0]!.columns[0]!.tasks).toBe(1);
      expect(b.boards[0]!.columns[0]!.tasks).toBe(1);
    }
  });
});

// ── meta / schema ─────────────────────────────────────────────────────────
describe("kanban: tool meta", () => {
  it("has name 'kanban' and WorkspaceWrite mode", () => {
    expect(kanbanTool.meta.name).toBe("kanban");
    expect(kanbanTool.meta.requiredMode).toBe("WorkspaceWrite");
  });

  it("declares action as required with the four valid actions", () => {
    const args = kanbanTool.meta.args as {
      required: string[];
      properties: { action: { enum: string[] } };
    };
    expect(args.required).toContain("action");
    expect(args.properties.action.enum).toEqual([
      "create_board",
      "add_task",
      "move_task",
      "list",
    ]);
  });
});
