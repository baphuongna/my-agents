/**
 * @my-agent/dap-server — a minimal DAP debug-adapter server (§11.2).
 *
 * vscode-js-debug (the real JS adapter) is distributed as a VS Code extension,
 * not a standalone npm binary, so it can't be `npx`'d here. This is a real
 * DAP-speaking server (Content-Length framed stdio JSON-RPC) with CANNED debug
 * state — its purpose is to prove the @my-agent/dap CLIENT works end-to-end
 * against a conformant peer (real framing, real request/response/events), not
 * to actually debug. A host swaps in vscode-js-debug for real debugging.
 *
 * Source: §11.2 DAP session protocol; DAP spec (microsoft/debug-adapter-protocol).
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** A minimal DAP server over stdio. Canned responses + a stopped event on launch. */
export class DapServerStub {
  private seq = 0;
  private stopped = false;

  /** Run the server as a child process speaking DAP over its stdio. Returns the
   * child so a test/client can drive it. */
  static spawn(scriptPath?: string): ChildProcessWithoutNullStreams {
    // Self-spawn: run this module's main() in a child.
    const args = [new URL("./main.js", import.meta.url).pathname];
    if (scriptPath) args.push(scriptPath);
    return spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });
  }

  /** Handle a single DAP request → response (+ any events). */
  handle(request: { seq: number; command: string; arguments?: unknown }): { response: unknown; events: unknown[] } {
    const events: unknown[] = [];
    const ok = (body: unknown) => ({
      seq: ++this.seq,
      type: "response",
      request_seq: request.seq,
      success: true,
      command: request.command,
      body,
    });
    switch (request.command) {
      case "initialize":
        return { response: ok({ supportsConfigurationDoneRequest: true, supportsEvaluateForHovers: true }), events: [] };
      case "launch":
        // emit a stopped event (the "program" hit its entry breakpoint)
        this.stopped = true;
        events.push({ seq: ++this.seq, type: "event", event: "stopped", body: { reason: "breakpoint", threadId: 1, allThreadsStopped: true } });
        return { response: ok({}), events };
      case "setBreakpoints":
        return {
          response: ok({ breakpoints: [{ verified: true, line: (request.arguments as { lines?: number[] })?.lines?.[0] ?? 1 }] }),
          events: [],
        };
      case "configurationDone":
        return { response: ok({}), events };
      case "threads":
        return { response: ok({ threads: [{ id: 1, name: "main" }] }), events };
      case "stackTrace":
        return {
          response: ok({
            stackFrames: [{ id: 1, name: "main", line: 1, column: 1, source: { path: (request.arguments as { source?: { path?: string } })?.source?.path ?? "anon.js" } }],
            totalFrames: 1,
          }),
          events: [],
        };
      case "scopes":
        return { response: ok({ scopes: [{ name: "Locals", variablesReference: 100, expensive: false }] }), events: [] };
      case "variables":
        return { response: ok({ variables: [{ name: "x", value: "42", variablesReference: 0 }] }), events: [] };
      case "evaluate":
        return { response: ok({ result: "42", variablesReference: 0 }), events: [] };
      case "continue":
        this.stopped = false;
        events.push({ seq: ++this.seq, type: "event", event: "terminated", body: {} });
        return { response: ok({}), events };
      case "disconnect":
        return { response: ok({}), events: [{ seq: ++this.seq, type: "event", event: "exited", body: { exitCode: 0 } }] };
      default:
        return {
          response: {
            seq: ++this.seq,
            type: "response",
            request_seq: request.seq,
            success: false,
            command: request.command,
            message: `unknown command: ${request.command}`,
          },
          events,
        };
    }
  }
}

// ─── stdio framing (Content-Length, same as the client/LSP) ──────────────────

export function writeFrame(proc: { stdout: NodeJS.WritableStream }, message: unknown): void {
  const json = JSON.stringify(message);
  proc.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

export async function readFrame(input: NodeJS.ReadableStream): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buf.slice(0, headerEnd);
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) return;
      const len = parseInt(m[1]!, 10);
      const bodyStart = headerEnd + 4;
      if (Buffer.byteLength(buf.slice(bodyStart)) < len) return;
      const body = buf.slice(bodyStart, bodyStart + len);
      input.off("data", onData);
      resolve(JSON.parse(body));
    };
    input.on("data", onData);
  });
}

/** main() — run as a child process: read requests, write responses/events. */
export async function main(): Promise<void> {
  const server = new DapServerStub();
  const stdin = process.stdin;
  const stdout = process.stdout;
  stdin.setEncoding("utf8");
  let buf = "";
  stdin.on("data", (chunk: string) => {
    buf += chunk;
    while (true) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const header = buf.slice(0, headerEnd);
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) break;
      const len = parseInt(m[1]!, 10);
      const bodyStart = headerEnd + 4;
      if (Buffer.byteLength(buf.slice(bodyStart)) < len) break;
      const body = buf.slice(bodyStart, bodyStart + len);
      buf = buf.slice(bodyStart + len);
      let request: { seq: number; command: string; arguments?: unknown };
      try {
        request = JSON.parse(body);
      } catch {
        continue;
      }
      const { response, events } = server.handle(request);
      for (const ev of events) writeFrame({ stdout }, ev);
      writeFrame({ stdout }, response);
      if (request.command === "disconnect") {
        setTimeout(() => process.exit(0), 50);
      }
    }
  });
}
