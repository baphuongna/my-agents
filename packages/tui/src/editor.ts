/**
 * Phase 23: advanced editor for the Ink TUI.
 *
 * Wraps `ink-text-input` to add Emacs-style editing commands on top:
 *   Enter          — submit
 *   ←/→            — move cursor 1 char
 *   Home/End       — jump to start/end
 *   Ctrl+U         — kill to start of line
 *   Ctrl+K         — kill to end of line
 *   Ctrl+W         — kill last word
 *   Ctrl+Y         — yank (paste last killed text)
 *   Ctrl+L         — clear screen
 *   Esc then Enter — submit (when set)
 *
 * Build on top of `useState` so re-renders are bounded. The actual value
 * editing is delegated to `ink-text-input`; this module provides the
 * kill-buffer + command surface.
 *
 * Source: bash readline + oh-my-pi tui/components/input.ts + pi editing.ts.
 */
import { useState, useRef, useCallback } from "react";

/** Kill-ring holds the last N killed snippets so Ctrl+Y can yank them. */
export class KillRing {
  private ring: string[] = [];
  constructor(private readonly capacity = 16) {}
  push(s: string): void {
    if (s.length === 0) return;
    this.ring.push(s);
    if (this.ring.length > this.capacity) this.ring.shift();
  }
  peek(): string | undefined {
    return this.ring[this.ring.length - 1];
  }
  clear(): void { this.ring.length = 0; }
  size(): number { return this.ring.length; }
}

/** The editor state. */
export interface EditorState {
  value: string;
  /** Cursor position (0..value.length). */
  cursor: number;
}

/** Editor ops — pure functions over the editor state + kill ring. */
export const EditorOps = {
  /** Move cursor to start. */
  home(s: EditorState): EditorState { return { ...s, cursor: 0 }; },
  /** Move cursor to end. */
  end(s: EditorState): EditorState { return { ...s, cursor: s.value.length }; },
  /** Move cursor one char left. */
  left(s: EditorState): EditorState { return { ...s, cursor: Math.max(0, s.cursor - 1) }; },
  /** Move cursor one char right. */
  right(s: EditorState): EditorState { return { ...s, cursor: Math.min(s.value.length, s.cursor + 1) }; },
  /** Kill from cursor to start of line (Emacs Ctrl+U). Returns updated state + killed text. */
  killToBOL(s: EditorState): { next: EditorState; killed: string } {
    const killed = s.value.slice(0, s.cursor);
    return { next: { value: s.value.slice(s.cursor), cursor: 0 }, killed };
  },
  /** Kill from cursor to end of line (Emacs Ctrl+K). */
  killToEOL(s: EditorState): { next: EditorState; killed: string } {
    const killed = s.value.slice(s.cursor);
    return { next: { value: s.value.slice(0, s.cursor), cursor: s.cursor }, killed };
  },
  /** Kill last word (Emacs Ctrl+W). Word = maximal run of [a-zA-Z0-9_]. */
  killWord(s: EditorState): { next: EditorState; killed: string } {
    const head = s.value.slice(0, s.cursor);
    const tail = s.value.slice(s.cursor);
    const m = head.match(/(.*?)(\b\w+\W*)$/);
    if (!m) return { next: s, killed: "" };
    const kept = m[1] ?? "";
    return { next: { value: kept + tail, cursor: kept.length }, killed: m[2]! };
  },
  /** Insert text at cursor (used for yank + autocomplete accept). */
  insert(s: EditorState, text: string): EditorState {
    return { value: s.value.slice(0, s.cursor) + text + s.value.slice(s.cursor), cursor: s.cursor + text.length };
  },
  /** Backspace: delete the char before the cursor. */
  backspace(s: EditorState): EditorState {
    if (s.cursor === 0) return s;
    return { value: s.value.slice(0, s.cursor - 1) + s.value.slice(s.cursor), cursor: s.cursor - 1 };
  },
};

/** React hook — wraps state + kill ring + dispatch. */
export function useEditor(initial = ""): {
  state: EditorState;
  setValue: (v: string) => void;
  /** The full kill ring (for tests + inspection). */
  killRing: KillRing;
  /** Run a Ctrl-key operation by name. */
  runOp: (op: keyof typeof EditorOps, args?: unknown) => void;
} {
  const [state, setState] = useState<EditorState>({ value: initial, cursor: initial.length });
  const ringRef = useRef(new KillRing());

  const setValue = useCallback((v: string) => {
    setState((prev) => {
      // Reset cursor to end when text is replaced wholesale by an external input.
      // (We don't track cursor precisely here — the input owns that. We trust
      //  the caller to send the cursor along with the value in a future refactor.)
      return { ...prev, value: v, cursor: Math.min(prev.cursor, v.length) };
    });
  }, []);

  const runOp = useCallback((op: keyof typeof EditorOps) => {
    setState((s) => {
      if (op === "home") return EditorOps.home(s);
      if (op === "end") return EditorOps.end(s);
      if (op === "left") return EditorOps.left(s);
      if (op === "right") return EditorOps.right(s);
      if (op === "backspace") return EditorOps.backspace(s);
      const r = (
        op === "killToBOL" ? EditorOps.killToBOL(s) :
        op === "killToEOL" ? EditorOps.killToEOL(s) :
        op === "killWord"  ? EditorOps.killWord(s)  :
        null
      );
      if (!r) return s;
      if (r.killed) ringRef.current.push(r.killed);
      return r.next;
    });
  }, []);

  return { state, setValue, killRing: ringRef.current, runOp };
}

/** Yanks (Ctrl+Y) the most recent killed text at the cursor. */
export function yank(state: EditorState, killed: string): EditorState {
  if (!killed) return state;
  return EditorOps.insert(state, killed);
}
