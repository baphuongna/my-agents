/**
 * Tool registry (§7). Tools are named, schema-described, mode-gated functions.
 *
 * A ToolImpl is the executable: `run(args, ctx) => Promise<ToolResult>`.
 * The registry maps name → ToolImpl + the Tool metadata (schema, requiredMode).
 *
 * Source: §7 Tool System, pi/oh-my-pi tool model.
 */
import type { Mode, Tool, ToolCall, ToolResult, TurnContext } from "@my-agent/core";

export interface ToolImpl {
  /** Metadata: name, arg schema, required permission mode, idempotency. */
  readonly meta: Tool;
  /** Execute. Receives parsed args + the turn context (for approval/budget). */
  run(args: unknown, ctx: TurnContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private byName = new Map<string, ToolImpl>();

  register(impl: ToolImpl): void {
    if (this.byName.has(impl.meta.name)) {
      throw new Error(`tool already registered: ${impl.meta.name}`);
    }
    this.byName.set(impl.meta.name, impl);
  }

  get(name: string): ToolImpl | undefined {
    return this.byName.get(name);
  }

  list(): Tool[] {
    return [...this.byName.values()].map((t) => t.meta);
  }

  /** Resolve a raw tool name (handles aliases/config renames — Tier 1 stub). */
  resolve(rawName: string): string {
    return rawName; // resolveToolName mapping lands with §6 provider config
  }
}

/** Helper: build a successful ToolResult. */
export function ok(callId: string, output: unknown): ToolResult {
  return { callId, ok: true, output };
}
/** Helper: build a failed ToolResult. */
export function err(callId: string, message: string): ToolResult {
  return { callId, ok: false, output: null, error: message };
}

/** Check that args is a record (basic validation; full JSON-Schema via ajv later). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Mode helpers. */
export function modeSatisfies(active: Mode, required: Mode): boolean {
  // A simple rank check would over-grant (Allow > everything); use explicit rules.
  if (active === "Allow") return true;
  if (active === required) return true;
  if (active === "DangerFullAccess") return true;
  // WorkspaceWrite satisfies ReadOnly.
  if (active === "WorkspaceWrite" && required === "ReadOnly") return true;
  return false;
}

export type { ToolCall, ToolResult };
