// @vitest-environment jsdom
/**
 * ActionLogViewer — live action-log polling (M7).
 *
 * Covers: poll start on mount, live log tail rendering in <pre>, onComplete
 * fired once with the exit code, and unmount cleanup (no further fetches /
 * no state updates after the cancelled flag trips).
 *
 * Timing note: usePolling fires an immediate tick on mount (a microtask) then
 * schedules subsequent ticks via recursive setTimeout. We flush the immediate
 * fire with `runAllTicks` and drive later ticks with `advanceTimersByTimeAsync`.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import { ActionLogViewer } from "./ActionLogViewer";

interface MockState {
  running: boolean;
  exit_code: number | null;
  lines: string[];
}

/** Controllable fetch whose /actions/.../status response reflects `state`. */
function makeFetch(state: MockState) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/actions/") && url.includes("/status")) {
      return new Response(
        JSON.stringify({
          name: "gateway-restart",
          running: state.running,
          exit_code: state.exit_code,
          pid: 111,
          lines: state.lines,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

/** Flush the immediate (microtask) poll tick without advancing the clock. */
function flushImmediate() {
  return act(async () => {
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("[unit] ActionLogViewer", () => {
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

  it("polls immediately on mount and renders the log tail", async () => {
    const state: MockState = { running: true, exit_code: null, lines: ["line one", "line two"] };
    global.fetch = makeFetch(state);

    render(<ActionLogViewer actionName="gateway-restart" />);
    await flushImmediate();

    expect(screen.getByText(/line one/)).toBeInTheDocument();
    expect(screen.getByText(/line two/)).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("shows the 'Starting…' placeholder before the first poll resolves", () => {
    const state: MockState = { running: true, exit_code: null, lines: ["x"] };
    global.fetch = makeFetch(state);
    render(<ActionLogViewer actionName="gateway-restart" />);
    expect(screen.getByText("Starting…")).toBeInTheDocument();
  });

  it("fires onComplete exactly once with the exit code when the action exits", async () => {
    const state: MockState = { running: true, exit_code: null, lines: ["working"] };
    global.fetch = makeFetch(state);
    const onComplete = vi.fn();

    render(<ActionLogViewer actionName="doctor" onComplete={onComplete} />);

    // Immediate tick — still running, onComplete not yet fired.
    await flushImmediate();
    expect(onComplete).not.toHaveBeenCalled();

    // Flip the backend to done and advance one poll interval.
    state.running = false;
    state.exit_code = 0;
    state.lines = ["finished"];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(0);

    // Advance further — onComplete must NOT fire again (deduped).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("displays a failure badge when the exit code is non-zero", async () => {
    const state: MockState = { running: false, exit_code: 3, lines: ["err"] };
    global.fetch = makeFetch(state);

    render(<ActionLogViewer actionName="backup" />);
    await flushImmediate();

    expect(screen.getByText("exit 3")).toBeInTheDocument();
  });

  it("displays a success badge when the exit code is zero", async () => {
    const state: MockState = { running: false, exit_code: 0, lines: ["ok"] };
    global.fetch = makeFetch(state);

    render(<ActionLogViewer actionName="backup" />);
    await flushImmediate();

    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("stops polling after the action exits (no leak)", async () => {
    const state: MockState = { running: false, exit_code: 0, lines: ["done"] };
    global.fetch = makeFetch(state);

    render(<ActionLogViewer actionName="gateway-restart" />);
    await flushImmediate();

    const callsAtExit = global.fetch.mock.calls.length;
    // Advance well beyond the poll interval — no further fetches.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(global.fetch.mock.calls.length).toBe(callsAtExit);
  });

  it("cancelled flag: no state updates / fetches after unmount mid-poll", async () => {
    const state: MockState = { running: true, exit_code: null, lines: ["running"] };
    global.fetch = makeFetch(state);

    const { unmount } = render(<ActionLogViewer actionName="gateway-restart" />);
    await flushImmediate();

    const callsAtUnmount = global.fetch.mock.calls.length;
    unmount();

    // Advancing timers after unmount must not schedule new fetches.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(global.fetch.mock.calls.length).toBe(callsAtUnmount);
  });

  it("renders a dismiss button only when onClose is provided", async () => {
    const state: MockState = { running: true, exit_code: null, lines: [] };
    global.fetch = makeFetch(state);

    const { rerender } = render(<ActionLogViewer actionName="x" />);
    await flushImmediate();
    expect(screen.queryByLabelText(/dismiss/i)).toBeNull();

    const onClose = vi.fn();
    rerender(<ActionLogViewer actionName="x" onClose={onClose} />);
    const btn = screen.getByLabelText(/dismiss/i);
    act(() => {
      btn.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("passes maxLines through to the status request URL", async () => {
    const state: MockState = { running: true, exit_code: null, lines: [] };
    global.fetch = makeFetch(state);

    render(<ActionLogViewer actionName="gateway-restart" maxLines={42} />);
    await flushImmediate();

    const url = String(global.fetch.mock.calls[0][0]);
    expect(url).toContain("lines=42");
  });
});
