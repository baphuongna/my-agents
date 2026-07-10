/**
 * Hook registry (§12) — extension lifecycle hooks (session_start, pre_tool, ...).
 * The agent emits hook events; registered listeners run; failures are isolated.
 *
 * Source: §12 Channels & Hook Registry, claw-code PluginLifecycle, openhuman hooks.
 */

export type HookName =
  | "session_start"
  | "session_end"
  | "pre_turn"
  | "post_turn"
  | "pre_tool"
  | "post_tool"
  | "approval_requested"
  | "approval_decided";

export type HookPayload = Record<string, unknown>;

export type HookHandler = (payload: HookPayload) => void | Promise<void>;

export interface HookRecord {
  name: HookName;
  source: string; // package name or "builtin"
  priority: number; // higher = runs first
  handler: HookHandler;
}

export class HookRegistry {
  private byName = new Map<HookName, HookRecord[]>();

  /** Register a hook. Higher priority runs first; default 0. */
  register(rec: HookRecord): void {
    const list = this.byName.get(rec.name) ?? [];
    list.push(rec);
    list.sort((a, b) => b.priority - a.priority);
    this.byName.set(rec.name, list);
  }

  /** Fire a hook; listeners run in priority order. A listener error is caught + logged. */
  async fire(name: HookName, payload: HookPayload): Promise<void> {
    const list = this.byName.get(name) ?? [];
    for (const r of list) {
      try {
        await r.handler(payload);
      } catch (e) {
        // Isolation: a failing hook MUST NOT break the agent (claw-code invariant).
        // eslint-disable-next-line no-console
        console.error(`[hook ${name}:${r.source}] failed:`, e);
      }
    }
  }

  /** Inspect registered hooks (for /debug, tests). */
  list(name?: HookName): HookRecord[] {
    if (name) return [...(this.byName.get(name) ?? [])];
    const all: HookRecord[] = [];
    for (const list of this.byName.values()) all.push(...list);
    return all;
  }
}