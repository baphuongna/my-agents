/**
 * @my-agent/tui — interactive transport (§20/§3/§25.1).
 *
 * Spec §25.1 calls for an Ink/React TUI (themes, keybindings, slash-commands,
 * OSC graphics). That full surface is a UI package; this ships the CORE
 * interactive transport: a REPL loop over the typed RuntimeEvent bus — read a
 * line, run a turn, render streaming events inline, Ctrl-C aborts. It is a
 * CONSUMER of the RuntimeEvent bus (invariant #11 — never scrapes stdout).
 *
 * The full Ink/React TUI layers ON TOP of this transport (a §25.1 package).
 *
 * Source: §20 transport-mode protocol sketch (interactive), §25.1.
 */
import { createInterface, type Interface } from "node:readline";

/** The handler the host implements (binds tui → the agent core). */
export interface TuiHandler {
  prompt(text: string, onEvent: (event: unknown) => void): Promise<unknown>;
  cancel(): void;
}

/** Render a RuntimeEvent to a human-readable line (transport-specific). */
export type EventRenderer = (event: unknown) => string | null;

/** Default renderer: turns text/tool/exec events into readable lines. */
export const defaultRenderer: EventRenderer = (event) => {
  const e = event as { kind?: string; e?: unknown };
  if (!e || typeof e !== "object") return null;
  if (e.kind === "turn") {
    const te = e.e as { state?: string; chunk?: { kind?: string; text?: string; call?: { name?: string } }; usage?: { input?: number; output?: number } };
    if (te.state === "Streaming" && te.chunk?.kind === "text") {
      return te.chunk.text ?? null;
    }
    if (te.state === "ToolCalls" && te.chunk?.kind === "tool_call") {
      return `  [tool: ${te.chunk.call?.name ?? "?"}]\n`;
    }
    if (te.state === "Completed") {
      return null; // newline already from streaming
    }
  }
  if (e.kind === "health") {
    return null; // suppress health noise
  }
  return null;
};

/** A minimal interactive REPL over the RuntimeEvent bus. */
export class TuiRepl {
  private rl: Interface | null = null;
  private activePrompt: string | null = null;

  constructor(
    private readonly handler: TuiHandler,
    private readonly renderer: EventRenderer = defaultRenderer,
    private readonly input: NodeJS.ReadableStream = process.stdin,
    private readonly output: NodeJS.WritableStream = process.stdout,
  ) {}

  /** Start the REPL loop. Returns when input closes (EOF). */
  start(greeting = "agent ready. Ctrl-C to abort a turn, Ctrl-D to exit."): void {
    this.output.write(greeting + "\n");
    this.rl = createInterface({ input: this.input, output: this.output as NodeJS.WriteStream });
    // Ctrl-C aborts the in-flight turn (§25.1) instead of killing the process.
    this.rl.on("SIGINT", () => {
      if (this.activePrompt !== null) {
        this.handler.cancel();
        this.output.write("\n^C — turn aborted\n");
      } else {
        this.output.write("\n");
        this.rl?.close();
      }
    });
    this.rl.on("line", (line) => {
      const text = line.trim();
      if (!text) {
        this.rl?.prompt();
        return;
      }
      this.activePrompt = text;
      void this.runTurn(text).finally(() => {
        this.activePrompt = null;
        this.rl?.prompt();
      });
    });
    this.rl.on("close", () => {
      this.output.write("\n");
    });
    this.rl.prompt();
  }

  private async runTurn(text: string): Promise<void> {
    try {
      await this.handler.prompt(text, (event) => {
        const line = this.renderer(event);
        if (line !== null) this.output.write(line);
      });
    } catch (e) {
      this.output.write(`[error] ${(e as Error).message}\n`);
    }
  }

  close(): void {
    this.rl?.close();
    this.rl = null;
  }
}
