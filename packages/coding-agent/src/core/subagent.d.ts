/**
 * @my-agent/coding-agent — subagent spawning.
 *
 * Subagent = a separate AgentSession with isolated cwd + JSONL history,
 * created via createAgentSession(). Shares model registry + auth with parent.
 *
 * Pattern (parent calls from anywhere):
 *   const sub = await spawnSubagent(parentSession, {
 *     goal: "review the auth code",
 *     allowedTools: ["read", "grep"],
 *   });
 *   // ... later:
 *   sub.status   // "running" | "done" | "failed" | "aborted"
 *   sub.output   // collected assistant text
 *   sub.abort()  // cancel
 *   for await (const chunk of sub.stream()) { ... }
 *
 * Note: pi's AgentSession doesn't natively support per-tool restrictions
 * (that's a future enhancement). For now, the restriction is enforced via
 * the goal/prompt — the subagent's system identity tells it which tools
 * to use. (For strict enforcement, layer ToolPolicy.)
 */
import { type AgentSession } from "./sdk.js";
export type SubagentStatus = "running" | "done" | "failed" | "aborted";
/** Max recursion depth for subagent tree (parent → sub → sub). Default 3. */
export declare const MAX_SUBAGENT_DEPTH = 3;
export interface SubagentOptions {
    /** Working directory for the subagent (isolated from parent). */
    cwd?: string;
    /** Tool names the subagent is allowed to use (encoded into system identity). */
    allowedTools?: string[];
    /** Model override (defaults to parent's model). */
    model?: string;
    /** Depth in the subagent tree. 0 = top-level. Max 3. */
    parentDepth?: number;
}
export interface SubagentHandle {
    readonly id: string;
    readonly goal: string;
    readonly startedAt: number;
    readonly allowedTools?: string[];
    readonly parentSessionId: string;
    /** Depth in subagent tree (0 = top-level). */
    readonly depth: number;
    status: SubagentStatus;
    output: string;
    error?: string;
    endedAt?: number;
    abort(): void;
    wait(): Promise<string>;
    stream(): AsyncIterable<string>;
    /** Internal AgentSession (for extensions to wire in). */
    readonly session: AgentSession;
}
/**
 * Spawn a subagent. Creates a new AgentSession with custom cwd + system overlay.
 * Returns handle for tracking.
 */
export declare function spawnSubagent(parent: AgentSession, opts: {
    goal: string;
    cwd?: string;
    allowedTools?: string[];
    model?: string;
    parentDepth?: number;
}): Promise<SubagentHandle>;
export declare function setSubagentCountListener(fn: ((n: number) => void) | null): void;
/** Register a subagent under its parent (for /subagents listing). */
export declare function trackSubagent(parentId: string, sub: SubagentHandle): void;
/** List active subagents for a parent session. */
export declare function listSubagents(parentId: string): SubagentHandle[];
/** Kill all subagents for a parent. */
export declare function killAllSubagents(parentId: string): number;
//# sourceMappingURL=subagent.d.ts.map