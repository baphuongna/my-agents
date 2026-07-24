// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ReasoningPicker } from "./ReasoningPicker";

const { configMock, postJSONMock } = vi.hoisted(() => ({
  configMock: vi.fn(),
  postJSONMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { config: configMock },
  postJSON: postJSONMock,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function selectEl(): HTMLSelectElement {
  return screen.getByTestId("reasoning-select") as unknown as HTMLSelectElement;
}

describe("[unit] ReasoningPicker — initial load", () => {
  beforeEach(() => {
    configMock.mockResolvedValue({ agent: { reasoning_effort: "low" } });
    postJSONMock.mockResolvedValue({});
  });

  it("reads the persisted effort and enables the control", async () => {
    render(<ReasoningPicker currentModel="m" />);
    const sel = selectEl();
    await waitFor(() => expect(sel).not.toBeDisabled());
    expect(sel).toHaveValue("low");
  });

  it("defaults to medium when the stored value is invalid", async () => {
    configMock.mockResolvedValue({ agent: { reasoning_effort: "banana" } });
    render(<ReasoningPicker currentModel="m" />);
    await waitFor(() => expect(selectEl()).not.toBeDisabled());
    expect(selectEl()).toHaveValue("medium");
  });
});

describe("[unit] ReasoningPicker — optimistic update", () => {
  beforeEach(() => {
    configMock.mockResolvedValue({ agent: { reasoning_effort: "low" } });
  });

  it("updates the UI immediately before the save resolves", async () => {
    const save = deferred<Record<string, unknown>>();
    postJSONMock.mockReturnValue(save.promise);

    render(<ReasoningPicker currentModel="m" />);
    await waitFor(() => expect(selectEl()).not.toBeDisabled());
    expect(selectEl()).toHaveValue("low");

    fireEvent.change(selectEl(), { target: { value: "high" } });

    // Optimistic: already shows the new value even though save hasn't resolved.
    await waitFor(() => expect(selectEl()).toHaveValue("high"));
    expect(configMock).toHaveBeenCalled(); // read-modify-write re-read
    expect(postJSONMock).toHaveBeenCalledTimes(1);
  });

  it("calls onChanged after a successful save", async () => {
    const onChanged = vi.fn();
    configMock.mockResolvedValue({ agent: { reasoning_effort: "low" } });
    postJSONMock.mockResolvedValue({});

    render(<ReasoningPicker currentModel="m" onChanged={onChanged} />);
    await waitFor(() => expect(selectEl()).not.toBeDisabled());

    fireEvent.change(selectEl(), { target: { value: "high" } });

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("high"));
  });

  it("writes the full config back (read-modify-write)", async () => {
    configMock.mockResolvedValue({
      agent: { reasoning_effort: "low", model: "keep-me" },
      other: "untouched",
    });
    postJSONMock.mockResolvedValue({});

    render(<ReasoningPicker currentModel="m" />);
    await waitFor(() => expect(selectEl()).not.toBeDisabled());

    fireEvent.change(selectEl(), { target: { value: "high" } });

    await waitFor(() => expect(postJSONMock).toHaveBeenCalled());
    const [, body] = postJSONMock.mock.calls[0]!;
    expect(body).toMatchObject({
      other: "untouched",
      agent: { reasoning_effort: "high", model: "keep-me" },
    });
  });
});

describe("[unit] ReasoningPicker — revert on failure", () => {
  it("reverts to the previous value when the save fails", async () => {
    configMock.mockResolvedValue({ agent: { reasoning_effort: "low" } });
    const save = deferred<Record<string, unknown>>();
    postJSONMock.mockReturnValue(save.promise);

    render(<ReasoningPicker currentModel="m" />);
    await waitFor(() => expect(selectEl()).not.toBeDisabled());

    fireEvent.change(selectEl(), { target: { value: "high" } });
    await waitFor(() => expect(selectEl()).toHaveValue("high")); // optimistic

    // Save fails → revert.
    save.reject(new Error("server error"));
    await waitFor(() => expect(selectEl()).toHaveValue("low"));
  });
});
