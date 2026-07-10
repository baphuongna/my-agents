/**
 * @my-agent/rpc — stdio JSON-RPC 2.0 transport (§20/§3 transport mode).
 *
 * Newline-delimited JSON-RPC 2.0 over stdio. Methods: prompt / cancel / status
 * / heartbeat. Responses are JSON-RPC 2.0 envelopes. Streaming turn events are
 * delivered as JSON-RPC notifications (no id). The transport is a CONSUMER of
 * the typed RuntimeEvent bus — it never scrapes stdout (invariant #11).
 *
 * Source: §20 transport-mode protocol sketch (rpc).
 */

/** A JSON-RPC 2.0 request. */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

/** A JSON-RPC 2.0 response (result OR error, never both). */
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string | null; result: unknown }
  | { jsonrpc: "2.0"; id: number | string | null; error: { code: number; message: string; data?: unknown } };

/** A JSON-RPC notification (no id → no response expected). */
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/** Methods the rpc transport dispatches (§20). */
export type RpcMethod = "prompt" | "cancel" | "status" | "heartbeat";

/** The handler interface the host implements (binds rpc → the agent core). */
export interface RpcHandler {
  /** Start a turn; `onEvent` receives each RuntimeEvent (streamed as a notification). */
  prompt(text: string, onEvent: (event: unknown) => void): Promise<unknown>;
  /** Cancel the in-flight turn (if any). */
  cancel(): void;
  /** Current status snapshot. */
  status(): unknown;
}

const PARSE_ERROR = -32700;
const METHOD_NOT_FOUND = -32601;
const INVALID_REQUEST = -32600;

function errorResponse(id: number | string | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}
function resultResponse(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

/**
 * An stdio JSON-RPC 2.0 server. Reads newline-delimited JSON from `input`,
 * writes responses/notifications to `output`. Dispatches to an RpcHandler.
 */
export class RpcServer {
  private inFlight = false; // R1: serialize prompts (a turn-based agent runs one at a time)
  constructor(
    private readonly handler: RpcHandler,
    private readonly input: NodeJS.ReadableStream = process.stdin,
    private readonly output: NodeJS.WritableStream = process.stdout,
  ) {}

  private buffer = "";

  /** Start reading + dispatching. Returns when input ends. */
  start(): void {
    this.input.setEncoding("utf8");
    this.input.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.handleLine(line);
      }
    });
    // R2: process a trailing partial line (no final \n) on EOF.
    this.input.on("end", () => {
      const trailing = this.buffer.trim();
      this.buffer = "";
      if (trailing) this.handleLine(trailing);
    });
  }

  private write(msg: JsonRpcResponse | JsonRpcNotification): void {
    this.output.write(JSON.stringify(msg) + "\n");
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private async handleLine(line: string): Promise<void> {
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line) as JsonRpcRequest;
    } catch {
      this.write(errorResponse(null, PARSE_ERROR, "parse error"));
      return;
    }
    if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      this.write(errorResponse(req?.id ?? null, INVALID_REQUEST, "invalid request"));
      return;
    }
    const id = req.id ?? null;
    switch (req.method as RpcMethod | string) {
      case "prompt": {
        // R1: reject a prompt while one is in-flight (event notifications would
        // interleave with no attribution). The caller must await/cancel first.
        if (this.inFlight) {
          this.write(errorResponse(id, -32001, "a prompt is already in-flight; cancel first"));
          return;
        }
        const text = (req.params as { text?: string } | undefined)?.text;
        if (typeof text !== "string") {
          this.write(errorResponse(id, INVALID_REQUEST, "params.text required"));
          return;
        }
        this.inFlight = true;
        try {
          const result = await this.handler.prompt(text, (event) => {
            this.notify("event", event);
          });
          this.write(resultResponse(id, { ok: true, result }));
        } catch (e) {
          this.write(errorResponse(id, -32000, `prompt failed: ${(e as Error).message}`));
        } finally {
          this.inFlight = false;
        }
        return;
      }
      case "cancel":
        this.handler.cancel();
        this.write(resultResponse(id, { cancelled: true }));
        return;
      case "status":
        this.write(resultResponse(id, this.handler.status()));
        return;
      case "heartbeat":
        this.write(resultResponse(id, { alive: true, ts: Date.now() }));
        return;
      default:
        this.write(errorResponse(id, METHOD_NOT_FOUND, `method not found: ${req.method}`));
    }
  }
}
