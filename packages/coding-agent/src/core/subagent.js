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
import { createAgentSession } from "./sdk.js";
import { nowWallclock } from "@my-agent/core";
/** Max recursion depth for subagent tree (parent → sub → sub). Default 3. */
export const MAX_SUBAGENT_DEPTH = 3;
let counter = 0;
function nextSubagentId() {
    counter = (counter + 1) & 0xffff;
    return `sub-${nowWallclock().toString(36)}-${counter.toString(36)}`;
}
/**
 * Spawn a subagent. Creates a new AgentSession with custom cwd + system overlay.
 * Returns handle for tracking.
 */
export async function spawnSubagent(parent, opts) {
    const depth = opts.parentDepth ?? 0;
    if (depth >= MAX_SUBAGENT_DEPTH) {
        throw new Error(`spawnSubagent: max recursion depth ${MAX_SUBAGENT_DEPTH} reached (current depth: ${depth})`);
    }
    const id = nextSubagentId();
    const cwd = opts.cwd ?? process.cwd();
    const parentSessionId = typeof parent === "string" ? parent : (parent.sessionId ?? "");
    const depthLine = depth > 0 ? `\nYou are a sub-subagent (depth ${depth + 1}).` : "";
    const toolLine = opts.allowedTools?.length
        ? `\nAllowed tools: ${opts.allowedTools.join(", ")}\nUse only these tools.`
        : "";
    // System overlay = replace agent identity. Pi AgentSession uses stableTier
    // via systemPrompt at turn-time, so we embed the goal into the user prompt.
    // The actual restriction is best-effort — subagent must comply.
    const sessionOpts = {
        cwd,
        // Strict tool restriction: if allowedTools specified, disable ALL builtins
        // and let subagent use only the allowed set (via extension custom tools).
        // If not specified, subagent gets no tools (must rely on its own prompt).
        noTools: "builtin",
        tools: opts.allowedTools, // empty array = no tools, ["read","grep"] = only those
    };
    if (opts.model)
        sessionOpts.model = opts.model;
    const created = await createAgentSession(sessionOpts);
    const session = created.session;
    const chunks = [];
    const streamWaiters = [];
    let streamDone = false;
    let streamError = null;
    function pushChunk(c) {
        if (streamWaiters.length > 0) {
            streamWaiters.shift()({ value: c, done: false });
        }
        else {
            chunks.push(c);
        }
    }
    function signalEnd(err) {
        streamDone = true;
        streamError = err ?? null;
        if (err) {
            while (streamWaiters.length > 0)
                streamWaiters.shift()(Promise.reject(err));
        }
        else {
            while (streamWaiters.length > 0)
                streamWaiters.shift()({ value: undefined, done: true });
        }
    }
    const handle = {
        id,
        goal: opts.goal,
        startedAt: nowWallclock(),
        allowedTools: opts.allowedTools,
        parentSessionId,
        depth,
        status: "running",
        output: "",
        session,
        abort: () => {
            if (handle.status === "running") {
                session.abort();
                handle.status = "aborted";
                handle.endedAt = nowWallclock();
            }
        },
        wait: () => completionPromise,
        stream: () => ({
            [Symbol.asyncIterator]() {
                return {
                    next() {
                        if (streamError)
                            return Promise.reject(streamError);
                        if (chunks.length > 0)
                            return Promise.resolve({ value: chunks.shift(), done: false });
                        if (streamDone)
                            return Promise.resolve({ value: undefined, done: true });
                        return new Promise((resolve) => streamWaiters.push(resolve));
                    },
                };
            },
        }),
    };
    const completionPromise = (async () => {
        try {
            // Inject subagent identity + tool restriction into the goal.
            const effectivePrompt = `[SUBAGENT — focused task${depth > 0 ? ` (depth ${depth + 1})` : ""}]${depthLine}${toolLine}\nGoal: ${opts.goal}\n\nWhen done, output the final answer prefixed with "<DONE>".`;
            const unsub = session.subscribe((event) => {
                const ev = event;
                if (ev.type === "message_update") {
                    const content = ev.message?.content;
                    if (Array.isArray(content)) {
                        for (const c of content) {
                            if (c?.type === "text" && c.text)
                                handle.output = c.text;
                        }
                    }
                }
                else if (ev.type === "message_end") {
                    if (handle.output)
                        pushChunk(handle.output);
                }
            });
            try {
                await session.prompt(effectivePrompt, { streamingBehavior: "followUp" });
            }
            finally {
                unsub();
            }
            signalEnd();
            if (handle.status === "running") {
                handle.status = "done";
                handle.endedAt = nowWallclock();
            }
            return handle.output;
        }
        catch (e) {
            const err = e;
            handle.error = err.message;
            signalEnd(err);
            if (handle.status === "running")
                handle.status = "failed";
            handle.endedAt = nowWallclock();
            return handle.output;
        }
    })();
    return handle;
}
/** Active subagents per parent session. */
const activeByParent = new Map();
/** Optional global hook to notify UI when subagent count changes (for footer). */
let subagentCountListener = null;
export function setSubagentCountListener(fn) {
    subagentCountListener = fn;
}
function totalActiveSubagents() {
    let n = 0;
    for (const set of activeByParent.values()) {
        for (const s of set)
            if (s.status === "running")
                n++;
    }
    return n;
}
/** Register a subagent under its parent (for /subagents listing). */
export function trackSubagent(parentId, sub) {
    let set = activeByParent.get(parentId);
    if (!set) {
        set = new Set();
        activeByParent.set(parentId, set);
    }
    set.add(sub);
    subagentCountListener?.(totalActiveSubagents());
    // Auto-untrack when finished (with 10min hard cap to prevent permanent leak)
    const startTime = nowWallclock();
    const interval = setInterval(() => {
        if (sub.status !== "running" || nowWallclock() - startTime > 600_000) {
            set?.delete(sub);
            clearInterval(interval);
            if (set && set.size === 0)
                activeByParent.delete(parentId);
            subagentCountListener?.(totalActiveSubagents());
        }
    }, 500);
    interval.unref?.();
}
/** List active subagents for a parent session. */
export function listSubagents(parentId) {
    const set = activeByParent.get(parentId);
    if (!set)
        return [];
    return [...set];
}
/** Kill all subagents for a parent. */
export function killAllSubagents(parentId) {
    const set = activeByParent.get(parentId);
    if (!set)
        return 0;
    let n = 0;
    for (const sub of set) {
        if (sub.status === "running") {
            sub.abort();
            n++;
        }
    }
    return n;
}
//# sourceMappingURL=subagent.js.map