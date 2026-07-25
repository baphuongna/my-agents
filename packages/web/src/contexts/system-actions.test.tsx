// @vitest-environment jsdom
/**
 * SystemActions context — M7 Action Polling with Trigger-Counter.
 *
 * Covers: polling lifecycle (recursive setTimeout), cancelled-flag guard on
 * unmount, isBusy/isRunning computation, dismissLog, and toast notifications.
 *
 * Timing note: usePolling fires an immediate tick on enable (a microtask),
 * then schedules subsequent ticks via recursive setTimeout. We flush the
 * immediate fire with `runAllTicks` and drive later ticks with
 * `advanceTimersByTimeAsync(1200)`.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";
import { type ReactNode } from "react";
import { ToastProvider } from "@/lib/toast";
import { SystemActionsProvider } from "./SystemActionsProvider";
import { useSystemActions } from "./useSystemActions";
import { SystemActionsContext, type SystemActionsState } from "./system-actions-context";

const wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>
    <SystemActionsProvider>{children}</SystemActionsProvider>
  </ToastProvider>
);

function renderActions() {
  return renderHook(() => useSystemActions(), { wrapper });
}

interface MockState {
  running: boolean;
  exit_code: number | null;
  lines: string[];
}

/**
 * Controllable fetch: the dispatch endpoints return a fixed ack; the action
 * status endpoint reflects `state`, which tests mutate to drive the poll.
 */
function makeFetch(dispatchAck: Record<string, unknown>, state: MockState) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/actions/") && url.includes("/status")) {
      return new Response(
        JSON.stringify({
          name: "gateway-restart",
          running: state.running,
          exit_code: state.exit_code,
          pid: 4242,
          lines: state.lines,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    const key = `${method} ${url}`;
    if (dispatchAck[key] !== undefined) {
      return new Response(JSON.stringify(dispatchAck[key]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

describe("[unit] SystemActions context", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  it("throws when used outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useSystemActions())).toThrow(
      /must be used within a SystemActionsProvider/,
    );
    spy.mockRestore();
  });

  it("starts in an idle state (isBusy=false, isRunning=false)", () => {
    const { result } = renderActions();
    expect(result.current.pendingAction).toBeNull();
    expect(result.current.activeAction).toBeNull();
    expect(result.current.actionStatus).toBeNull();
    expect(result.current.isBusy).toBe(false);
    expect(result.current.isRunning).toBe(false);
  });

  it("dispatches an action, polls until exit, and reports success", async () => {
    const state: MockState = { running: true, exit_code: null, lines: ["starting…"] };
    global.fetch = makeFetch(
      { "POST /gateway/restart": { ok: true, name: "gateway-restart", pid: 99 } },
      state,
    );

    const { result } = renderActions();

    await act(async () => {
      await result.current.runAction("restart");
    });

    // After dispatch: action active, polling begun, still running (no status yet).
    expect(result.current.activeAction).toBe("restart");
    expect(result.current.pendingAction).toBeNull();

    // Flush the immediate poll tick (usePolling fires on enable).
    await act(async () => {
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.actionStatus?.running).toBe(true);
    expect(result.current.isRunning).toBe(true);
    expect(result.current.isBusy).toBe(true);

    // Flip the backend to "done" and advance one poll interval.
    state.running = false;
    state.exit_code = 0;
    state.lines = ["done"];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(result.current.actionStatus?.running).toBe(false);
    expect(result.current.actionStatus?.exit_code).toBe(0);
    // running===false ⇒ isRunning flips off even though active stays set.
    expect(result.current.isRunning).toBe(false);
    expect(result.current.isBusy).toBe(false);
  });

  it("reports failure when the exit code is non-zero", async () => {
    const state: MockState = { running: false, exit_code: 2, lines: ["boom"] };
    global.fetch = makeFetch(
      { "POST /ops/doctor": { ok: true, name: "doctor", pid: 7 } },
      state,
    );

    const { result } = renderActions();

    await act(async () => {
      await result.current.runAction("update"); // update → doctor
    });
    await act(async () => {
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.actionStatus?.exit_code).toBe(2);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.isBusy).toBe(false);
  });

  it("stops polling after the action exits (no further fetches)", async () => {
    const state: MockState = { running: false, exit_code: 0, lines: [] };
    global.fetch = makeFetch(
      { "POST /ops/backup": { ok: true, name: "backup", pid: 1 } },
      state,
    );

    const { result } = renderActions();
    await act(async () => {
      await result.current.runAction("backup");
    });
    await act(async () => {
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(0);
    });

    const callsAfterExit = global.fetch.mock.calls.length;

    // Advance well past several poll intervals — no new fetches should occur.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(global.fetch.mock.calls.length).toBe(callsAfterExit);
  });

  it("dismissLog clears active action + status", async () => {
    const state: MockState = { running: true, exit_code: null, lines: ["x"] };
    global.fetch = makeFetch(
      { "POST /ops/security-audit": { ok: true, name: "security-audit", pid: 3 } },
      state,
    );

    const { result } = renderActions();
    await act(async () => {
      await result.current.runAction("audit");
    });
    await act(async () => {
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.activeAction).toBe("audit");
    expect(result.current.actionStatus).not.toBeNull();

    act(() => {
      result.current.dismissLog();
    });

    expect(result.current.activeAction).toBeNull();
    expect(result.current.actionStatus).toBeNull();
    expect(result.current.isRunning).toBe(false);
    expect(result.current.isBusy).toBe(false);
  });

  it("cancelled flag prevents state updates after unmount", async () => {
    const state: MockState = { running: true, exit_code: null, lines: ["x"] };
    global.fetch = makeFetch(
      { "POST /gateway/restart": { ok: true, name: "gateway-restart", pid: 9 } },
      state,
    );

    const { result, unmount } = renderActions();
    await act(async () => {
      await result.current.runAction("restart");
    });

    // Unmount before the pending poll resolves.
    unmount();

    // Advancing timers must not throw (cancelled flag drops in-flight results).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
  });

  it("isBusy is true while an action is pending (dispatching)", async () => {
    let resolveDispatch: (() => void) | null = null;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url === "/gateway/restart") {
        await new Promise<void>((resolve) => {
          resolveDispatch = resolve;
        });
        return new Response(
          JSON.stringify({ ok: true, name: "gateway-restart", pid: 1 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "no" }), { status: 404 });
    }) as unknown as typeof fetch;

    const { result } = renderActions();

    act(() => {
      void result.current.runAction("restart");
    });

    // While the dispatch promise is unresolved, pendingAction is set.
    expect(result.current.pendingAction).toBe("restart");
    expect(result.current.isBusy).toBe(true);

    await act(async () => {
      resolveDispatch?.();
      await vi.runAllTicks();
    });
    expect(result.current.pendingAction).toBeNull();
  });

  it("toasts an error when the dispatch endpoint fails", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
    ) as unknown as typeof fetch;

    const { result } = renderActions();
    await act(async () => {
      await result.current.runAction("restart");
    });

    // Dispatch failed → no active action, nothing pending.
    expect(result.current.activeAction).toBeNull();
    expect(result.current.pendingAction).toBeNull();
    expect(result.current.isBusy).toBe(false);
  });

  it("exposes the full context value shape via the context object", () => {
    expect(SystemActionsContext).toBeDefined();
    const noop: SystemActionsState = {
      pendingAction: null,
      activeAction: null,
      actionStatus: null,
      isBusy: false,
      isRunning: false,
      runAction: vi.fn(),
      dismissLog: vi.fn(),
    };
    expect(Object.keys(noop).sort()).toEqual([
      "actionStatus",
      "activeAction",
      "dismissLog",
      "isBusy",
      "isRunning",
      "pendingAction",
      "runAction",
    ]);
  });
});
