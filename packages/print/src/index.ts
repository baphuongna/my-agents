/**
 * @my-agent/print — print transport (§20 Tier-0).
 *
 * print: one JSON RuntimeEvent per stdout line (`--json`) or a human
 * transcript (default). The simplest transport — no TTY, no interactivity.
 */
import type { RuntimeEvent } from "@my-agent/core";

/** Format: --json emits one RuntimeEvent per line; default emits a transcript. */
export function makeSink(opts: { json: boolean }): {
  write: (e: RuntimeEvent) => void;
} {
  if (opts.json) {
    return {
      write: (e) => {
        process.stdout.write(JSON.stringify(e) + "\n");
      },
    };
  }
  return {
    write: (e) => {
      const line = humanize(e);
      if (line) process.stdout.write(line + "\n");
    },
  };
}

function humanize(e: RuntimeEvent): string | null {
  switch (e.kind) {
    case "turn":
      if (e.stage === "start") return "▸ turn start";
      if (e.stage === "end") return "◂ turn end";
      if (e.turnEvent?.state === "Streaming")
        return (e.turnEvent.chunk.kind === "text" && e.turnEvent.chunk.text) || null;
      if (e.turnEvent?.state === "Completed")
        return `\n[done · ${(e.turnEvent.usage.input ?? 0) + (e.turnEvent.usage.output ?? 0)} tokens · $${e.turnEvent.cost.usd.toFixed(6)}]`;
      if (e.turnEvent?.state === "Failed")
        return `[failed · ${e.turnEvent.error.phase}: ${e.turnEvent.error.context["reason"] ?? ""}]`;
      return null;
    default:
      return null;
  }
}
