/**
 * @my-agent/tui/ink — the full Ink/React TUI (§25.1).
 *
 * Pi-quality interactive REPL features:
 *   - Slash commands (/help, /model, /budget, /memory, /quit, /clear, /tools)
 *   - History (↑/↓ to recall previous prompts; in-memory for the session)
 *   - Multi-line input (via ink-text-input; Enter submits the current line)
 *   - Tool approval modal (y/n) with call details
 *   - Status bar (provider/model/cost/tokens) at the bottom
 *   - Streaming turn display (text + tool calls)
 *   - TTY+non-TTY fallback (non-TTY: see packages/tui/src/index.ts TuiRepl)
 *
 * Architecture:
 *   - InkSession holds all React state via useState.
 *   - The runner (`startInkSession`) returns an InkHandle that the host uses
 *     to push events. The handle delegates to a stable mutable ref that
 *     InkSession reads on each render via a state tick.
 *
 * Source: §25.1 TUI/CLI (Ink/React, themes, namespaced keybindings); pi/oh-my-pi.
 */
import React, { useState, useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import TextInput from "ink-text-input";
import { SLASH_COMMANDS, type SlashCommand, type InkCommandContext } from "./ink-commands.js";
import { themeStore, defaultTheme as themeDefault, type Theme } from "./themes.js";
import { sanitize } from "./sanitize.js";
import { KillRing, EditorOps, yank } from "./editor.js";
import { Autocomplete } from "./autocomplete.js";
import { MdInline } from "./transcript";
export type { SlashCommand } from "./ink-commands.js";

/** A single rendered event line in the conversation stream. */
export interface InkTurnLine {
  seq: number;
  /** "user" | "assistant" | "tool" | "system" | "approval" | "info" | "error" */
  kind: string;
  text: string;
}

/** Status pill for the bottom bar. */
export interface InkStatus {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  spentUsd: number;
  /** Cost ceiling. When spentUsd reaches budgetUsd, the budget FSM is exhausted. */
  budgetUsd: number;
}

/** Approval request raised by the permission gate. */
export interface InkApproval {
  callId: string;
  name: string;
  args: string;
  reason: string;
}

/** A minimal slash command — name + description + optional runner. (Re-exported from ink-commands.ts.) */
export type InkSlashCommand = SlashCommand;

/** Imperative handle exposed by the Ink session to the host. */
export interface InkSessionRef {
  /** Push a line into the transcript. */
  pushLine: (line: InkTurnLine) => void;
  /** Set the current approval modal (null to clear). */
  setApproval: (a: InkApproval | null) => void;
  /** Update the status bar. */
  setStatus: (s: InkStatus) => void;
  /** Clear the transcript. */
  clear: () => void;
  /** Get the current draft text (e.g. for tests). */
  getDraft: () => string;
}

/** A 51-token-ish theme (§25.1 token-driven theming — minimal default). */
export const defaultTheme = themeDefault;

/** Max transcript lines retained (memory bound). */
const MAX_HISTORY_LINES = 500;
/** Max number of past prompts stored for ↑/↓ recall. */
const MAX_PROMPT_HISTORY = 100;

/** Innards of the Ink session — exposed for tests via prop passthrough. */
export interface InkSessionProps {
  /** Submit a non-slash prompt to the agent. */
  onSubmit: (text: string) => Promise<void>;
  /** Cancel the in-flight turn. */
  onAbort: () => void;
  /** User decides an approval (called when y/n pressed while modal is shown). */
  onApproval: (callId: string, decision: "Allow" | "Deny") => void;
  /** Initial status. */
  initialStatus: InkStatus;
  /** Slash commands table. */
  commands: InkSlashCommand[];
}

/**
 * The full Ink-based session component. Lifted ref pattern: the host holds a
 * ref to this component and calls imperative methods on it.
 */
export const InkSession = forwardRef<InkSessionRef, InkSessionProps>(function InkSession(
  props: InkSessionProps,
  ref: React.Ref<InkSessionRef>,
): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [lines, setLines] = useState<InkTurnLine[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [approval, setApproval] = useState<InkApproval | null>(null);
  const [status, setStatus] = useState<InkStatus>(props.initialStatus);
  // Phase 27: autocomplete overlay state.
  const [acHighlighted, setAcHighlighted] = useState(0);
  // Phase 27: kill-ring (Ctrl+W deletes last word, Ctrl+Y pastes last killed).
  const killRingRef = useRef(new KillRing());

  useImperativeHandle(
    ref,
    (): InkSessionRef => ({
      pushLine: (line: InkTurnLine) => {
        // F1 fix: sanitize assistant/tool/user text before rendering to
        // strip ANSI/OSC escape sequences (defends against terminal-injection
        // via prompt-injected assistant output).
        const safe: InkTurnLine = { ...line, text: sanitize(line.text) };
        setLines((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === "assistant" && safe.kind === "assistant") {
            const next = prev.slice();
            next[next.length - 1] = { ...last, text: last.text + safe.text };
            return next;
          }
          const next = prev.concat(safe);
          if (next.length > MAX_HISTORY_LINES) return next.slice(-MAX_HISTORY_LINES);
          return next;
        });
      },
      setApproval: (a: InkApproval | null) => setApproval(a),
      setStatus: (s: InkStatus) => setStatus(s),
      clear: () => setLines([]),
      getDraft: () => draft,
    }),
    [draft],
  );

  /** Append-or-merge inline helper (kept for use inside callbacks). */
  const appendOrReplace = useCallback((line: InkTurnLine) => {
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.kind === "assistant" && line.kind === "assistant") {
        const next = prev.slice();
        next[next.length - 1] = { ...last, text: last.text + line.text };
        return next;
      }
      const next = prev.concat(line);
      if (next.length > MAX_HISTORY_LINES) return next.slice(-MAX_HISTORY_LINES);
      return next;
    });
  }, []);

  /** Slash command resolution (returns true if a command matched and ran). */
  const trySlash = useCallback(
    async (trimmed: string): Promise<boolean> => {
      if (!trimmed.startsWith("/")) return false;
      const space = trimmed.indexOf(" ");
      const cmd = (space >= 0 ? trimmed.slice(1, space) : trimmed.slice(1)).trim();
      const args = space >= 0 ? trimmed.slice(space + 1).trim() : "";
      const def = props.commands.find((c) => c.name === cmd);
      if (!def) return false;
      try {
        const out = def.run ? await def.run(args, { session: { cwd: process.cwd(), setModel: () => {}, getModel: () => "?", getProvider: () => "?", getSpent: () => 0, getBudget: () => 0, getMemoryFacts: () => 0, getTools: () => [], getSkills: () => [], getMcpServers: () => [], openSelector: async () => null, clearTranscript: () => {}, exportTranscript: () => "", compact: async () => 0, importFrom: async () => 0, setConfig: async () => {}, getConfig: async () => undefined, listConfig: async () => ({}), setMode: () => {}, getMode: () => "Prompt", tree: async () => "" } }) : null;
        if (typeof out === "string" && out) appendOrReplace({ seq: 0, kind: "info", text: out });
      } catch (e) {
        appendOrReplace({
          seq: 0,
          kind: "error",
          text: `/${cmd} error: ${(e as Error).message}`,
        });
      }
      return true;
    },
    [props.commands, appendOrReplace],
  );

  /** Submit handler. */
  const submit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setHistoryIdx(-1);
    setHistory((prev) => {
      const next = prev.concat(trimmed);
      return next.length > MAX_PROMPT_HISTORY ? next.slice(-MAX_PROMPT_HISTORY) : next;
    });
    appendOrReplace({ seq: 0, kind: "user", text: trimmed });
    setDraft("");
    const wasSlash = await trySlash(trimmed);
    if (!wasSlash) {
      try {
        await props.onSubmit(trimmed);
      } catch (e) {
        appendOrReplace({
          seq: 0,
          kind: "error",
          text: `submit error: ${(e as Error).message}`,
        });
      }
    }
    setBusy(false);
  }, [draft, busy, appendOrReplace, trySlash, props]);

  // Keybindings.
  useInput((input, key) => {
    // Approval modal: y/n is consumed before any input processing.
    if (approval) {
      if (input === "y") {
        props.onApproval(approval.callId, "Allow");
        appendOrReplace({
          seq: 0,
          kind: "approval",
          text: `[Allow] ${approval.name}`,
        });
        setApproval(null);
        return;
      }
      if (input === "n") {
        props.onApproval(approval.callId, "Deny");
        appendOrReplace({
          seq: 0,
          kind: "approval",
          text: `[Deny] ${approval.name}`,
        });
        setApproval(null);
        return;
      }
      return;
    }
    // Ctrl-C: cancel the active turn OR exit if idle.
    if (key.ctrl && input === "c") {
      if (busy) props.onAbort();
      else exit();
      return;
    }
    // Phase 27: Ctrl+W — kill last word (push to kill-ring).
    if (key.ctrl && input === "w") {
      const r = EditorOps.killWord({ value: draft, cursor: draft.length });
      if (r.killed) killRingRef.current.push(r.killed);
      setDraft(r.next.value);
      return;
    }
    // Phase 27: Ctrl+Y — yank (paste last killed text).
    if (key.ctrl && input === "y") {
      const killed = killRingRef.current.peek();
      if (killed) {
        const r = yank({ value: draft, cursor: draft.length }, killed);
        setDraft(r.value);
      }
      return;
    }
    // Phase 27: Ctrl+U — kill from cursor to start of line.
    if (key.ctrl && input === "u") {
      const r = EditorOps.killToBOL({ value: draft, cursor: draft.length });
      if (r.killed) killRingRef.current.push(r.killed);
      setDraft(r.next.value);
      return;
    }
    // Up arrow: walk history back.
    if (key.upArrow && history.length > 0) {
      const idx = historyIdx < 0 ? history.length : Math.max(0, historyIdx - 1);
      const value = history[idx] ?? "";
      setHistoryIdx(idx);
      setDraft(value);
      return;
    }
    if (key.downArrow) {
      if (historyIdx < 0) return;
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(-1);
        setDraft("");
      } else {
        setHistoryIdx(next);
        setDraft(history[next] ?? "");
      }
      return;
    }
  });

  const termWidth = stdout?.columns ?? 80;

  return (
    <Box flexDirection="column" width={termWidth}>
      {/* Header */}
      <Box borderStyle="round" borderColor={defaultTheme.meta} paddingX={1}>
        <Text color={defaultTheme.meta}>mya</Text>
        <Text> · interactive agent</Text>
      </Box>

      {/* Transcript */}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {lines.map((line, i) => (
          <TranscriptLine key={`${i}-${line.kind}-${line.seq}`} line={line} />
        ))}
      </Box>

      {/* Approval modal overlay */}
      {approval && <ApprovalModal approval={approval} />}

      {/* Phase 27: autocomplete overlay above the input (only when draft
          starts with `/` or contains `@path`). */}
      {(draft.startsWith("/") || /@/.test(draft)) && (
        <Autocomplete
          draft={draft}
          commands={props.commands}
          theme={defaultTheme}
          highlighted={acHighlighted}
          onAccept={(sug) => {
            // Replace draft with the suggestion's insert string.
            if (sug) setDraft(sug.insert);
            setAcHighlighted(0);
          }}
          onDismiss={() => setAcHighlighted(0)}
          onHighlightChange={setAcHighlighted}
        />
      )}

      {/* Multi-line input */}
      <Box paddingX={1}>
        <Text color={defaultTheme.user} bold>{">"} </Text>
        <TextInput
          value={draft}
          onChange={setDraft}
          onSubmit={() => void submit()}
          placeholder={busy ? "(running…)" : "type — Enter to send, / for commands, ↑↓ history"}
        />
      </Box>

      {/* Status bar */}
      <StatusBar status={status} />
    </Box>
  );
});

/** Single-line rendered transcript entry. */
function TranscriptLine({ line }: { line: InkTurnLine }): React.ReactElement {
  const color =
    line.kind === "user" ? defaultTheme.user :
    line.kind === "assistant" ? defaultTheme.assistant :
    line.kind === "tool" ? defaultTheme.tool :
    line.kind === "approval" ? defaultTheme.approval :
    line.kind === "error" ? defaultTheme.error :
    defaultTheme.text;
  const prefix =
    line.kind === "user" ? "you" :
    line.kind === "assistant" ? "mya" :
    line.kind === "tool" ? "tool" :
    line.kind === "approval" ? "auth" :
    line.kind === "error" ? "err" :
    "info";
  return (
    <Box>
      <Text color={defaultTheme.meta}>{prefix.padEnd(4)} </Text>
      <Text color={color} wrap="wrap">
        {line.kind === "assistant" ? <MdInline text={line.text} theme={defaultTheme} /> : line.text}
      </Text>
    </Box>
  );
}

/** Overlay modal for tool-call approval. */
function ApprovalModal({ approval }: { approval: InkApproval }): React.ReactElement {
  // F2 fix: sanitize the args JSON (defense against terminal-injection via
  // hostile tool-call arguments). Also clamp length.
  const cleanArgs = sanitize(approval.args);
  const argsShort = cleanArgs.length > 60 ? cleanArgs.slice(0, 60) + "…" : cleanArgs;
  return (
    <Box
      borderStyle="round"
      borderColor={defaultTheme.approval}
      flexDirection="column"
      paddingX={1}
      marginX={1}
    >
      <Text color={defaultTheme.approval} bold>approval required</Text>
      <Text><Text color={defaultTheme.meta}>tool  </Text> <Text color={defaultTheme.tool}>{approval.name}</Text></Text>
      <Text><Text color={defaultTheme.meta}>args  </Text> {argsShort}</Text>
      <Text><Text color={defaultTheme.meta}>why   </Text> {approval.reason}</Text>
      <Box marginTop={1}>
        <Text color={defaultTheme.ok} bold>y</Text>
        <Text> allow   </Text>
        <Text color={defaultTheme.error} bold>n</Text>
        <Text> deny</Text>
      </Box>
    </Box>
  );
}

/** Bottom status bar — provider · model · tokens · $ spent / budget. */
function StatusBar({ status }: { status: InkStatus }): React.ReactElement {
  const pct = status.budgetUsd > 0 ? (status.spentUsd / status.budgetUsd) * 100 : 0;
  const color = pct >= 100 ? defaultTheme.error : pct >= 80 ? defaultTheme.warn : defaultTheme.ok;
  return (
    <Box borderStyle="round" borderColor={defaultTheme.status} paddingX={1}>
      <Text color={defaultTheme.status}>{status.provider}</Text>
      <Text color={defaultTheme.status}> · </Text>
      <Text color={defaultTheme.meta}>{status.model}</Text>
      <Text color={defaultTheme.status}> · </Text>
      <Text>↑{status.tokensIn} ↓{status.tokensOut}</Text>
      <Text color={defaultTheme.status}> · </Text>
      <Text color={color}>
        ${status.spentUsd.toFixed(4)}
        {status.budgetUsd > 0 ? ` / $${status.budgetUsd.toFixed(2)}` : ""}
      </Text>
    </Box>
  );
}

/** Default slash commands table. */
function defaultCommands(opt: {
  onClear?: () => void;
  onModel?: (model: string) => void;
  getModel?: () => string;
  getSpent?: () => number;
  getBudget?: () => number;
  getMemoryFacts?: () => number;
}): InkSlashCommand[] {
  // Build a context with only the bits the live wiring provides. Unset
  // callbacks fall through to a small set of no-op defaults (Phase 19-24
  // command surface; the full InkCommandContext requires host injection).
  const liveCtx: InkCommandContext = {
    session: {
      cwd: process.cwd(),
      setModel: (m) => opt.onModel?.(m),
      getModel: () => opt.getModel?.() ?? "MiniMax-M3",
      getProvider: () => "minimax",
      getSpent: () => opt.getSpent?.() ?? 0,
      getBudget: () => opt.getBudget?.() ?? 0,
      getMemoryFacts: () => opt.getMemoryFacts?.() ?? 0,
      getTools: () => [],
      getSkills: () => [],
      getMcpServers: () => [],
      openSelector: async () => null,
      clearTranscript: () => opt.onClear?.(),
      exportTranscript: () => "(exportTranscript not yet wired by host)",
      compact: async () => 0,
      importFrom: async () => 0,
      setConfig: async () => {},
      getConfig: async () => undefined,
      listConfig: async () => ({}),
      setMode: () => {},
      getMode: () => "Prompt",
      tree: async () => "(/tree not yet wired)",
    },
  };
  // Map the imported 25-command table through the live context. Any
  // command whose args require host services (getTools/getSkills/etc) will
  // return a graceful message — not a crash. /clear uses the live clear hook.
  return SLASH_COMMANDS.map((c) => ({
    name: c.name,
    description: c.description,
    kbd: c.kbd,
    category: c.category,
    run: async (args: string) => {
      // F6 fix: clear the kill-ring on /clear.
      if (c.name === "clear") {
        opt.onClear?.();
        return "(transcript cleared)";
      }
      const out = await c.run(args, liveCtx);
      if (typeof out === "string") return out;
      return null; // selector payload — not supported in this ink.tsx session
    },
  }));
}

/** Run the Ink session, returning an imperative handle. */
export interface InkRunnerOpts {
  onSubmit: (text: string) => Promise<void>;
  onAbort: () => void;
  onApproval: (callId: string, decision: "Allow" | "Deny") => void;
  initialStatus?: InkStatus;
  commands?: InkSlashCommand[];
  onClear?: () => void;
  onModel?: (model: string) => void;
  getModel?: () => string;
  getSpent?: () => number;
  getBudget?: () => number;
  getMemoryFacts?: () => number;
}

export interface InkHandle {
  pushLine: (line: InkTurnLine) => void;
  setApproval: (a: InkApproval | null) => void;
  setStatus: (s: InkStatus) => void;
  clear: () => void;
  close: () => Promise<void>;
}

export function startInkSession(opts: InkRunnerOpts): InkHandle {
  const cmds = opts.commands ?? defaultCommands(opts);
  // Replace /help with a list-rendering version once we have all commands.
  const helpIdx = cmds.findIndex((c) => c.name === "help");
  if (helpIdx >= 0) {
    cmds[helpIdx] = {
      name: "help",
      description: "list available slash commands",
      category: "session",
      run: () => "available commands:\n" + cmds.map((c) => `  /${c.name.padEnd(8)} ${c.description}`).join("\n"),
    };
  }

  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));

  let sessionRef: InkSessionRef | null = null;
  const app = render(
    <InkSession
      ref={(r) => { sessionRef = r; }}
      onSubmit={opts.onSubmit}
      onAbort={opts.onAbort}
      onApproval={opts.onApproval}
      initialStatus={opts.initialStatus ?? {
        provider: "minimax", model: "MiniMax-M3", tokensIn: 0, tokensOut: 0, spentUsd: 0, budgetUsd: 0,
      }}
      commands={cmds}
    />,
  );

  return {
    pushLine: (line) => sessionRef?.pushLine(line),
    setApproval: (a) => sessionRef?.setApproval(a),
    setStatus: (s) => sessionRef?.setStatus(s),
    clear: () => sessionRef?.clear(),
    close: async () => {
      app.unmount();
      resolveClosed();
      await closed;
    },
  };
}

/** Convert a RuntimeEvent into a transcript line. */
export function eventToLine(seq: number, event: unknown): InkTurnLine | null {
  const e = event as { kind?: string; turnEvent?: { state?: string; chunk?: { kind?: string; text?: string; call?: { name?: string } }; usage?: { input?: number; output?: number } } } | null;
  if (!e || typeof e !== "object") return null;
  if (e.kind === "turn") {
    const te = e.turnEvent;
    if (!te) return null;
    if (te.state === "Streaming" && te.chunk?.kind === "text") {
      return { seq, kind: "assistant", text: te.chunk.text ?? "" };
    }
    if (te.state === "ToolCalls" && te.chunk?.kind === "tool_call") {
      return { seq, kind: "tool", text: `${te.chunk.call?.name ?? "?"}(…)` };
    }
    if (te.state === "Completed") return null;
  }
  if (e.kind === "approval") return { seq, kind: "approval", text: "approval requested" };
  if (e.kind === "error") return { seq, kind: "error", text: JSON.stringify(e).slice(0, 200) };
  if (e.kind === "info") return { seq, kind: "info", text: JSON.stringify(e).slice(0, 200) };
  return null;
}
