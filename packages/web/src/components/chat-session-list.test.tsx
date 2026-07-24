// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ChatSessionList } from "./ChatSessionList";
import type { SessionInfo } from "@/lib/api";

const { sessionsMock } = vi.hoisted(() => ({ sessionsMock: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { sessions: sessionsMock },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionsMock.mockReset();
});

function makeSession(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "s1",
    title: "Untitled",
    createdAt: new Date(Date.now() - 60000).toISOString(),
    updatedAt: new Date(Date.now() - 60000).toISOString(),
    messageCount: 3,
    ...over,
  };
}

/** Controllable promise so tests can order resolutions. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("[unit] ChatSessionList — rendering", () => {
  beforeEach(() => {
    sessionsMock.mockResolvedValue([makeSession({ id: "a", title: "Alpha chat" })]);
  });

  it("renders sessions fetched from api.sessions()", async () => {
    render(<ChatSessionList />);
    expect(await screen.findByText("Alpha chat")).toBeInTheDocument();
    expect(sessionsMock).toHaveBeenCalledTimes(1);
  });

  it("shows message count", async () => {
    render(<ChatSessionList />);
    expect(await screen.findByText(/3 msgs/)).toBeInTheDocument();
  });

  it("fires onPick when a row is clicked", async () => {
    const onPick = vi.fn();
    render(<ChatSessionList onPick={onPick} />);
    const row = await screen.findByText("Alpha chat");
    fireEvent.click(row.closest("button")!);
    expect(onPick).toHaveBeenCalledWith("a");
  });

  it("fires onNewChat when New chat is clicked", async () => {
    const onNewChat = vi.fn();
    render(<ChatSessionList onNewChat={onNewChat} />);
    fireEvent.click(screen.getByText("New chat"));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("highlights the active session", async () => {
    sessionsMock.mockResolvedValue([
      makeSession({ id: "a", title: "Alpha" }),
      makeSession({ id: "b", title: "Beta" }),
    ]);
    render(<ChatSessionList activeSessionId="b" />);
    const betaRow = (await screen.findByText("Beta")).closest("button")!;
    expect(betaRow.getAttribute("aria-current")).toBe("true");
    const alphaRow = screen.getByText("Alpha").closest("button")!;
    expect(alphaRow.getAttribute("aria-current")).toBeNull();
  });
});

describe("[unit] ChatSessionList — states", () => {
  it("shows an error message with retry when the fetch fails", async () => {
    sessionsMock.mockRejectedValueOnce(new Error("network down"));
    render(<ChatSessionList />);
    expect(await screen.findByText("network down")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows an empty state when there are no sessions", async () => {
    sessionsMock.mockResolvedValue([]);
    render(<ChatSessionList />);
    expect(await screen.findByText("No sessions yet")).toBeInTheDocument();
  });
});

describe("[unit] ChatSessionList — race prevention", () => {
  it("discards a stale response from an earlier fetch", async () => {
    const stale = deferred<SessionInfo[]>();
    const fresh = deferred<SessionInfo[]>();

    // First load (mount) → stale promise; second load (refresh) → fresh.
    sessionsMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

    render(<ChatSessionList />);

    // Trigger a second fetch (refresh) before the first resolves.
    fireEvent.click(screen.getByLabelText("Refresh"));

    // Fresh resolves first → its list is committed.
    fresh.resolve([makeSession({ id: "b", title: "Beta fresh" })]);
    expect(await screen.findByText("Beta fresh")).toBeInTheDocument();

    // Stale resolves later → must be discarded (newer token wins).
    stale.resolve([makeSession({ id: "a", title: "Alpha stale" })]);
    await waitFor(() => {
      expect(screen.queryByText("Alpha stale")).toBeNull();
    });
    expect(screen.getByText("Beta fresh")).toBeInTheDocument();
  });
});
