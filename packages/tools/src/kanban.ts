/**
 * @my-agent/tools — Kanban board tool.
 *
 * C3: simple task board stored in ~/.mya/kanban.json.
 * All names sanitized (path-safety per §07 R31).
 * Source: §07 Tools, PLAN-FEATURES C3.
 */
import type { ToolImpl } from "./registry.js";
import type { ToolResult } from "@my-agent/core";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const KANBAN_PATH = join(homedir(), ".mya", "kanban.json");

interface KanbanTask { id: string; title: string; column: string; }
interface KanbanBoard { id: string; name: string; columns: Array<{ id: string; name: string; tasks: KanbanTask[] }>; }
interface KanbanStore { boards: KanbanBoard[]; }

function loadStore(): KanbanStore {
  if (!existsSync(KANBAN_PATH)) return { boards: [] };
  try { return JSON.parse(readFileSync(KANBAN_PATH, "utf8")) as KanbanStore; }
  catch { return { boards: [] }; }
}
function saveStore(store: KanbanStore): void {
  try {
    mkdirSync(join(homedir(), ".mya"), { recursive: true });
    writeFileSync(KANBAN_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
  } catch { /* best-effort */ }
}
/** Sanitize names — reject path traversal (§07 R31). */
function sanitize(name: string): string | null {
  if (!name || name.length > 200) return null;
  if (/[\/\\]|\.\./.test(name)) return null;
  if (/[\x00-\x1f]/.test(name)) return null;
  return name.trim();
}

export const kanbanTool: ToolImpl = {
  meta: {
    name: "kanban",
    description: "Manage a kanban task board. Actions: create_board, add_task, move_task, list. Stored in ~/.mya/kanban.json.",
    args: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create_board", "add_task", "move_task", "list"], description: "Action to perform" },
        board: { type: "string", description: "Board name" },
        task: { type: "string", description: "Task title (for add_task/move_task)" },
        column: { type: "string", description: "Column name (for add_task/move_task)" },
        to_column: { type: "string", description: "Target column (for move_task)" },
      },
      required: ["action"],
    },
    requiredMode: "WorkspaceWrite",
  },
  async run(args): Promise<ToolResult> {
    const a = args as { action?: string; board?: string; task?: string; column?: string; to_column?: string };
    if (!a.action) return { callId: "kanban", ok: false, output: null, error: "action required" };
    const store = loadStore();

    if (a.action === "create_board") {
      const name = sanitize(a.board ?? "");
      if (!name) return { callId: "kanban", ok: false, output: null, error: "valid board name required" };
      const board: KanbanBoard = {
        id: randomUUID(), name,
        columns: [
          { id: "todo", name: "To Do", tasks: [] },
          { id: "doing", name: "In Progress", tasks: [] },
          { id: "done", name: "Done", tasks: [] },
        ],
      };
      store.boards.push(board);
      saveStore(store);
      return { callId: "kanban", ok: true, output: { board_id: board.id, name } };
    }

    if (a.action === "add_task") {
      const boardName = sanitize(a.board ?? "");
      const title = sanitize(a.task ?? "");
      if (!boardName || !title) return { callId: "kanban", ok: false, output: null, error: "valid board + task required" };
      const board = store.boards.find((b) => b.name === boardName);
      if (!board) return { callId: "kanban", ok: false, output: null, error: `board '${boardName}' not found` };
      const col = board.columns.find((c) => c.id === (a.column ?? "todo") || c.name === a.column) ?? board.columns[0]!;
      const task: KanbanTask = { id: randomUUID(), title, column: col.id };
      col.tasks.push(task);
      saveStore(store);
      return { callId: "kanban", ok: true, output: { task_id: task.id, column: col.name } };
    }

    if (a.action === "move_task") {
      const boardName = sanitize(a.board ?? "");
      if (!boardName) return { callId: "kanban", ok: false, output: null, error: "board required" };
      const board = store.boards.find((b) => b.name === boardName);
      if (!board) return { callId: "kanban", ok: false, output: null, error: "board not found" };
      const targetCol = board.columns.find((c) => c.id === a.to_column || c.name === a.to_column);
      if (!targetCol) return { callId: "kanban", ok: false, output: null, error: "target column not found" };
      let moved = false;
      for (const col of board.columns) {
        const idx = col.tasks.findIndex((t) => t.id === a.task || t.title === a.task);
        if (idx >= 0) {
          const [task] = col.tasks.splice(idx, 1);
          if (!task) continue;
          task.column = targetCol.id;
          targetCol.tasks.push(task);
          moved = true;
          break;
        }
      }
      if (!moved) return { callId: "kanban", ok: false, output: null, error: "task not found" };
      saveStore(store);
      return { callId: "kanban", ok: true, output: { moved_to: targetCol.name } };
    }

    if (a.action === "list") {
      const boardName = a.board ? sanitize(a.board) : null;
      const boards = boardName ? store.boards.filter((b) => b.name === boardName) : store.boards;
      return {
        callId: "kanban", ok: true,
        output: { boards: boards.map((b) => ({ name: b.name, columns: b.columns.map((c) => ({ name: c.name, tasks: c.tasks.length })) })) },
      };
    }

    return { callId: "kanban", ok: false, output: null, error: `unknown action: ${a.action}` };
  },
};
