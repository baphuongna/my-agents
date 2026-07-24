// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

function makeProps(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  return {
    open: true,
    title: "Are you sure?",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("[unit] ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(<ConfirmDialog {...makeProps({ open: false })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders title and description when open", () => {
    render(
      <ConfirmDialog
        {...makeProps({ title: "Delete item", description: "This cannot be undone." })}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete item")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("fires onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...makeProps({ onConfirm, onCancel })} />);
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("fires onCancel when the cancel button is clicked", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...makeProps({ onConfirm, onCancel })} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fires onCancel when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...makeProps({ onCancel })} />);
    const dialog = screen.getByRole("dialog");
    // Click the overlay (the dialog element itself is the backdrop).
    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does NOT cancel when clicking inside the panel", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...makeProps({ onCancel })} />);
    fireEvent.click(screen.getByText("Confirm"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("fires onCancel on Escape key", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...makeProps({ onCancel })} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("applies destructive (danger) styling to the confirm button", () => {
    render(<ConfirmDialog {...makeProps({ destructive: true, confirmLabel: "Delete" })} />);
    const confirmBtn = screen.getByText("Delete").closest("button")!;
    expect(confirmBtn.className).toMatch(/btn-danger/);
  });

  it("uses primary styling when not destructive", () => {
    render(<ConfirmDialog {...makeProps({ confirmLabel: "Save" })} />);
    const confirmBtn = screen.getByText("Save").closest("button")!;
    expect(confirmBtn.className).toMatch(/btn-primary/);
    expect(confirmBtn.className).not.toMatch(/btn-danger/);
  });

  it("shows loading state and disables buttons", () => {
    render(
      <ConfirmDialog
        {...makeProps({ loading: true, confirmLabel: "Delete", cancelLabel: "Cancel" })}
      />,
    );
    // Confirm button shows the loading glyph instead of the label.
    const confirmBtn = screen.getByText("…").closest("button")!;
    expect(confirmBtn).toBeDisabled();
    // Cancel button is disabled during loading.
    const cancelBtn = screen.getByText("Cancel").closest("button")!;
    expect(cancelBtn).toBeDisabled();
    // Original label is not rendered while loading.
    expect(screen.queryByText("Delete")).toBeNull();
  });

  it("honours custom confirm/cancel labels", () => {
    render(
      <ConfirmDialog
        {...makeProps({ confirmLabel: "Yes, do it", cancelLabel: "Nope" })}
      />,
    );
    expect(screen.getByText("Yes, do it")).toBeInTheDocument();
    expect(screen.getByText("Nope")).toBeInTheDocument();
  });
});
