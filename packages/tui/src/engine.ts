/**
 * mya TUI engine — port of pi-tui's rendering architecture.
 *
 * Core concept (from @earendil-works/pi-tui/dist/tui.js):
 *   1. Raw mode stdin (NOT readline)
 *   2. Frame buffer: string[] — one element per terminal line (with ANSI)
 *   3. Diff rendering: only redraw CHANGED lines (cursor move + clear + write)
 *   4. Synchronized output: \x1b[?2026h ... \x1b[?2026l around each paint
 *   5. NO alt screen — content scrolls naturally in main buffer
 *   6. Component tree: each component renders to string[] via render(width)
 *   7. Throttle: 16ms minimum between renders (≈60fps)
 *
 * This is the SAME architecture as pi, just simplified.
 */

// ─── Terminal abstraction (from terminal.js) ──────────────────────────
export class Terminal {
  write(data: string): void { process.stdout.write(data); }
  get columns(): number { return process.stdout.columns || 80; }
  get rows(): number { return process.stdout.rows || 24; }

  start(onInput: (data: string) => void, onResize: () => void): void {
    // Enter raw mode
    const stdin = process.stdin as unknown as { setRawMode?: (mode: boolean) => void; isRaw?: boolean; setEncoding: (e: string) => void; resume: () => void; pause: () => void; on: (e: string, cb: (d: string) => void) => void; };
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    // Enable bracketed paste
    this.write("\x1b[?2004h");
    // Hide cursor
    this.write("\x1b[?25l");
    stdin.on("data", onInput);
    process.stdout.on("resize", onResize);
  }

  stop(): void {
    this.write("\x1b[?2004l"); // Disable bracketed paste
    this.write("\x1b[?25h");   // Show cursor
    const stdin = process.stdin as unknown as { setRawMode?: (mode: boolean) => void; isRaw?: boolean; pause: () => void; };
    if (stdin.setRawMode) stdin.setRawMode(false);
    stdin.pause();
  }
}

// ─── Component base (from tui.js Component interface) ─────────────────
export interface Component {
  render(width: number): string[];
  invalidate(): void;
}

/** Container — composes children by concatenating their render output. */
export class Container implements Component {
  protected children: Component[] = [];
  private _dirty = true;

  addChild(child: Component): void { this.children.push(child); this.invalidate(); }
  removeChild(child: Component): void { this.children = this.children.filter(c => c !== child); this.invalidate(); }
  clear(): void { this.children = []; this.invalidate(); }
  invalidate(): void { this._dirty = true; this.children.forEach(c => c.invalidate()); }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      lines.push(...child.render(width));
    }
    return lines;
  }
}

/** Text — renders a single styled line. */
export class Text implements Component {
  constructor(private text: string = "", private padX = 0) {}
  setText(t: string): void { this.text = t; this.invalidate(); }
  invalidate(): void {}
  render(width: number): string[] {
    const pad = " ".repeat(this.padX);
    return [pad + this.text];
  }
}

/** Spacer — renders N empty lines. */
export class Spacer implements Component {
  constructor(private n = 1) {}
  invalidate(): void {}
  render(_width: number): string[] { return Array(this.n).fill(""); }
}

// ─── TUI — the core diff renderer (from tui.js doRender) ──────────────
export class TUI extends Container {
  private previousLines: string[] = [];
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorRow = 0;
  private readonly minIntervalMs = 16;
  private lastRenderHr: bigint = 0n;
  private started = false;
  private hasRendered = false; // first render clears screen
  private prevWidth = 0;
  private prevHeight = 0;

  constructor(private terminal: Terminal) { super(); }

  start(onInput: (data: string) => void): void {
    this.started = true;
    this.terminal.start(onInput, () => this.requestRender(true));
    this.requestRender(true);
  }

  stop(): void { this.terminal.stop(); }

  /** Schedule a render (throttled to 60fps). */
  requestRender(force = false): void {
    if (!this.started) return;
    if (force) { this.doRender(); return; }
    if (this.renderTimer) return;
    const elapsed = Number((process.hrtime.bigint() - this.lastRenderHr) / 1000000n);
    const delay = Math.max(0, this.minIntervalMs - elapsed);
    this.renderTimer = setTimeout(() => { this.renderTimer = null; this.doRender(); }, delay);
  }

  /** The core: compose frame → diff → write only changed lines. */
  private doRender(): void {
    this.lastRenderHr = process.hrtime.bigint();
    const width = this.terminal.columns;
    const height = this.terminal.rows;

    // 1. Render all components
    let newLines = this.render(width);

    // 2. PAD to terminal height — fill every row so the TUI "takes over"
    //    the entire terminal (no leftover old content visible).
    while (newLines.length < height) {
      newLines.push("");
    }
    // Trim if somehow longer than height
    if (newLines.length > height) {
      newLines = newLines.slice(newLines.length - height);
    }

    // 3. Check for full redraw triggers
    const needFullRedraw =
      !this.hasRendered ||            // First render
      width !== this.prevWidth ||     // Width changed
      height !== this.prevHeight;     // Height changed

    if (needFullRedraw) {
      // Clear screen + scrollback + cursor home
      let buf = "\x1b[?2026h";
      buf += "\x1b[2J\x1b[3J\x1b[H";
      // Write all lines from top
      for (let i = 0; i < newLines.length; i++) {
        if (i > 0) buf += "\r\n";
        buf += "\x1b[2K" + newLines[i] + "\x1b[0m\x1b]8;;\x07";
      }
      buf += "\x1b[?2026l";
      this.terminal.write(buf);
      this.previousLines = [...newLines];
      this.cursorRow = newLines.length - 1;
      this.hasRendered = true;
      this.prevWidth = width;
      this.prevHeight = height;
      return;
    }

    // 4. Diff rendering — find changed lines
    let firstChanged = -1;
    let lastChanged = -1;
    const maxLines = Math.max(newLines.length, this.previousLines.length);
    for (let i = 0; i < maxLines; i++) {
      const old = i < this.previousLines.length ? this.previousLines[i] : "";
      const neu = i < newLines.length ? newLines[i] : "";
      if (old !== neu) {
        if (firstChanged === -1) firstChanged = i;
        lastChanged = i;
      }
    }

    // 5. No changes → skip
    if (firstChanged === -1) {
      this.previousLines = newLines;
      return;
    }

    // 5. Build diff output (synchronized output wrapper)
    let buf = "\x1b[?2026h";

    // Move cursor to first changed line (relative)
    const targetRow = firstChanged;
    const rowDelta = targetRow - this.cursorRow;
    if (rowDelta > 0) buf += `\x1b[${rowDelta}B`;
    else if (rowDelta < 0) buf += `\x1b[${-rowDelta}A`;
    buf += "\r"; // Column 0

    // Write changed lines
    for (let i = firstChanged; i <= lastChanged; i++) {
      if (i > firstChanged) buf += "\r\n";
      buf += "\x1b[2K"; // Clear entire line
      const line = i < newLines.length ? newLines[i] : "";
      buf += line + "\x1b[0m\x1b]8;;\x07"; // SGR reset + OSC 8 close
    }

    // If content shrank, clear extra lines
    if (this.previousLines.length > newLines.length) {
      const extra = this.previousLines.length - newLines.length;
      for (let i = 0; i < extra; i++) buf += "\r\n\x1b[2K";
      buf += `\x1b[${extra}A`; // Move back up
    }

    buf += "\x1b[?2026l"; // End synchronized output
    this.terminal.write(buf);

    // 6. Update state
    this.cursorRow = lastChanged >= 0 ? Math.min(lastChanged, newLines.length - 1) : 0;
    this.previousLines = newLines;
  }
}
