/**
 * Markdown URL scheme allowlist tests — verifies that unsafe schemes
 * (javascript:, data:, vbscript:) are rendered as plain text, not links.
 */
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "@/components/Markdown";

describe("[unit] Markdown URL scheme allowlist", () => {
  it("renders http:// links as clickable anchors", () => {
    const { container } = render(<Markdown content="[click](http://example.com)" />);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("http://example.com");
  });

  it("renders https:// links as clickable anchors", () => {
    const { container } = render(<Markdown content="[secure](https://example.com)" />);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("https://example.com");
  });

  it("renders mailto: links as clickable anchors", () => {
    const { container } = render(<Markdown content="[email](mailto:test@example.com)" />);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("mailto:test@example.com");
  });

  it("renders javascript: links as plain text (no anchor)", () => {
    const { container } = render(<Markdown content={"[xss](javascript:alert(1))"} />);
    const anchor = container.querySelector("a");
    expect(anchor).toBeNull();
  });

  it("renders data: links as plain text (no anchor)", () => {
    const { container } = render(<Markdown content="[img](data:text/html,<script>)" />);
    const anchor = container.querySelector("a");
    expect(anchor).toBeNull();
  });

  it("renders vbscript: links as plain text (no anchor)", () => {
    const { container } = render(<Markdown content="[vb](vbscript:msgbox(1))" />);
    const anchor = container.querySelector("a");
    expect(anchor).toBeNull();
  });

  it("renders relative links (#anchor) as clickable anchors", () => {
    const { container } = render(<Markdown content="[section](#section)" />);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("#section");
  });

  it("renders slash-relative links as clickable anchors", () => {
    const { container } = render(<Markdown content="[page](/docs)" />);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/docs");
  });
});
