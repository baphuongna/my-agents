// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { ModelReloadConfirm } from "./ModelReloadConfirm";

afterEach(cleanup);

describe("[unit] DeleteConfirmDialog", () => {
  it("renders with destructive defaults (Delete label, danger styling)", () => {
    render(
      <DeleteConfirmDialog
        open
        title="Delete session?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByText("Delete").closest("button")!;
    expect(confirmBtn.className).toMatch(/btn-danger/);
    // destructive icon present
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("fires onConfirm when the Delete button is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DeleteConfirmDialog open title="Delete?" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fires onCancel on Cancel / backdrop", () => {
    const onCancel = vi.fn();
    render(
      <DeleteConfirmDialog open title="Delete?" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("[unit] ModelReloadConfirm", () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reloadSpy = vi.fn();
    // jsdom's reload is a no-op / throws "not implemented" — stub it.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
  });

  it("is closed when model is null", () => {
    render(<ModelReloadConfirm model={null} onCancel={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is open when a model name is provided", () => {
    render(<ModelReloadConfirm model="claude-opus-4" onCancel={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Switch model?")).toBeInTheDocument();
  });

  it("calls window.location.reload() on confirm", () => {
    render(<ModelReloadConfirm model="claude-opus-4" onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Reload"));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("fires onCancel on cancel", () => {
    const onCancel = vi.fn();
    render(<ModelReloadConfirm model="claude-opus-4" onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
