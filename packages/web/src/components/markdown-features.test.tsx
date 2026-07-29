/**
 * Markdown highlightTerms + streaming caret tests (distilled from hermes-agent
 * Markdown.tsx Highlights + StreamingCaret). Pure data + rendering tests.
 */
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "@/components/Markdown";

describe("[unit] Markdown highlightTerms", () => {
  it("renders plain text when no terms provided", () => {
    const { container } = render(<Markdown content="hello world" />);
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("hello world");
  });

  it("wraps matching terms in <mark>", () => {
    const { container } = render(
      <Markdown content="hello WORLD" highlightTerms={["world"]} />,
    );
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe("WORLD");
  });

  it("is case-insensitive across multiple terms", () => {
    const { container } = render(
      <Markdown content="alpha BETA gamma Delta" highlightTerms={["beta", "DELTA"]} />,
    );
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBe(2);
    const texts = Array.from(marks).map((m) => m.textContent);
    expect(texts).toEqual(["BETA", "Delta"]);
  });

  it("escapes regex metacharacters in search terms", () => {
    const { container } = render(
      <Markdown content="price: $10.50 (USD)" highlightTerms={["$10.50"]} />,
    );
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe("$10.50");
  });

  it("highlights across multiple paragraph blocks", () => {
    const { container } = render(
      <Markdown content={"first hit\n\nsecond hit"} highlightTerms={["hit"]} />,
    );
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBe(2);
  });
});

describe("[unit] Markdown streaming caret", () => {
  it("does not render caret when streaming is false/undefined", () => {
    const { container } = render(<Markdown content="hello" />);
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("renders caret at tail of last block when streaming", () => {
    const { container } = render(<Markdown content="hello" streaming />);
    const caret = container.querySelector(".animate-pulse");
    expect(caret).not.toBeNull();
    expect(caret?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders caret only on last block (not first) when streaming", () => {
    const { container } = render(
      <Markdown content={"# Heading\n\nbody text"} streaming />,
    );
    const carets = container.querySelectorAll(".animate-pulse");
    expect(carets.length).toBe(1);
    // caret should be in the paragraph, not the heading
    expect(carets[0]?.closest("p")).not.toBeNull();
  });

  it("renders caret when content is empty and streaming", () => {
    const { container } = render(<Markdown content="" streaming />);
    const caret = container.querySelector(".animate-pulse");
    expect(caret).not.toBeNull();
  });
});
