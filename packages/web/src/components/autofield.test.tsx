// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { AutoField, fieldLabel } from "./AutoField";

afterEach(cleanup);

function field(schemaKey: string, schema: Record<string, unknown>, value: unknown) {
  const onChange = vi.fn();
  const { container } = render(
    <AutoField schemaKey={schemaKey} schema={schema} value={value} onChange={onChange} />,
  );
  const el = container.querySelector<HTMLElement>(`[data-field="${schemaKey}"]`);
  return { onChange, el, container };
}

describe("[unit] AutoField — label derivation", () => {
  it("title-cases the last segment of a dotted path", () => {
    expect(fieldLabel("agent.max_tokens")).toBe("Max tokens");
  });

  it("handles a simple key", () => {
    expect(fieldLabel("name")).toBe("Name");
  });

  it("handles nested dotted paths", () => {
    expect(fieldLabel("provider.timeout_seconds")).toBe("Timeout seconds");
  });
});

describe("[unit] AutoField — boolean → checkbox", () => {
  it("renders a checkbox reflecting the value", () => {
    const { el } = field("verbose", { type: "boolean" }, true);
    expect(el).toHaveAttribute("type", "checkbox");
    expect(el as HTMLInputElement).toBeChecked();
  });

  it("fires onChange with the next boolean", () => {
    const { el, onChange } = field("verbose", { type: "boolean" }, false);
    fireEvent.click(el!);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("[unit] AutoField — select → dropdown", () => {
  it("renders options and the current value", () => {
    const { el, container } = field(
      "mode",
      { type: "select", options: ["fast", "slow"] },
      "slow",
    );
    expect(el).toHaveAttribute("data-field", "mode");
    expect(el as HTMLSelectElement).toHaveValue("slow");
    const opts = container.querySelectorAll("option");
    expect(opts).toHaveLength(2);
    expect(opts[0]!).toHaveValue("fast");
    expect(opts[1]!).toHaveValue("slow");
  });

  it("fires onChange with the selected value", () => {
    const { el, onChange } = field("mode", { type: "select", options: ["a", "b"] }, "a");
    fireEvent.change(el!, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("[unit] AutoField — number → numeric input", () => {
  it("renders a number input with the value", () => {
    const { el } = field("temperature", { type: "number" }, 42);
    expect(el).toHaveAttribute("type", "number");
    expect(el as HTMLInputElement).toHaveValue(42);
  });

  it("fires onChange with a number", () => {
    const { el, onChange } = field("temperature", { type: "number" }, 0);
    fireEvent.change(el!, { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("resets to 0 when cleared", () => {
    const { el, onChange } = field("temperature", { type: "number" }, 5);
    fireEvent.change(el!, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(0);
  });
});

describe("[unit] AutoField — text → textarea", () => {
  it("renders a textarea with the value", () => {
    const { el } = field("bio", { type: "text" }, "hello world");
    expect(el!.tagName).toBe("TEXTAREA");
    expect(el as HTMLTextAreaElement).toHaveValue("hello world");
  });

  it("fires onChange with the string", () => {
    const { el, onChange } = field("bio", { type: "text" }, "");
    fireEvent.change(el!, { target: { value: "updated" } });
    expect(onChange).toHaveBeenCalledWith("updated");
  });
});

describe("[unit] AutoField — list → comma-separated input", () => {
  it("renders the array joined by commas", () => {
    const { el } = field("tags", { type: "list" }, ["a", "b", "c"]);
    expect(el).toHaveAttribute("type", "text");
    expect(el as HTMLInputElement).toHaveValue("a, b, c");
  });

  it("fires onChange with a parsed array", () => {
    const { el, onChange } = field("tags", { type: "list" }, []);
    fireEvent.change(el!, { target: { value: "x, y , z" } });
    expect(onChange).toHaveBeenCalledWith(["x", "y", "z"]);
  });

  it("filters out empty segments", () => {
    const { el, onChange } = field("tags", { type: "list" }, []);
    fireEvent.change(el!, { target: { value: "x, , y" } });
    expect(onChange).toHaveBeenCalledWith(["x", "y"]);
  });
});

describe("[unit] AutoField — default → text input", () => {
  it("renders a text input for unknown types", () => {
    const { el } = field("name", { type: "string" }, "abc");
    expect(el).toHaveAttribute("type", "text");
    expect(el as HTMLInputElement).toHaveValue("abc");
  });

  it("renders a text input when no type is given", () => {
    const { el } = field("name", {}, "abc");
    expect(el).toHaveAttribute("type", "text");
  });
});
