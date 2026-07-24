// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { ModelPickerDialog } from "./ModelPickerDialog";

const { modelsMock } = vi.hoisted(() => ({ modelsMock: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { models: modelsMock },
}));

// Mock useToast to avoid provider requirements.
vi.mock("@/lib/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  modelsMock.mockReset();
});

/** Controllable promise so we can resolve after unmount. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("[unit] ModelPickerDialog — cancelled-flag async safety", () => {
  it("does not throw or update state when unmounted before fetch resolves", async () => {
    const { promise, resolve } = deferred<unknown[]>([]);
    modelsMock.mockReturnValue(promise);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<ModelPickerDialog open={true} onClose={vi.fn()} />);

    // Unmount before the fetch resolves — must not cause "state on unmounted
    // component" warnings.
    unmount();

    // Resolve the promise after unmount.
    resolve([{ id: "m1", name: "Model 1", provider: "openai" }]);
    await waitFor(() => expect(modelsMock).toHaveBeenCalledTimes(1));

    // No React state-update warnings should be logged.
    const calls = spy.mock.calls.flat().join(" ");
    expect(calls).not.toMatch(/unmounted|setState|state on/i);

    spy.mockRestore();
  });

  it("renders models after the fetch resolves while mounted", async () => {
    modelsMock.mockResolvedValue([
      { id: "gpt-4", name: "GPT-4", provider: "openai" },
    ]);

    render(<ModelPickerDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("GPT-4")).toBeInTheDocument();
    });
  });
});
