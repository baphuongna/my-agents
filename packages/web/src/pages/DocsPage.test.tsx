// @vitest-environment jsdom
/**
 * DocsPage — renders without crashing, embeds an iframe pointing at the docs URL.
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { DocsPage, MYA_DOCS_URL } from "@/pages/DocsPage";

afterEach(cleanup);

describe("DocsPage", () => {
  it("renders the page title", () => {
    renderWithProviders(<DocsPage />);
    expect(screen.getByText("Documentation")).toBeInTheDocument();
  });

  it("embeds an iframe pointing at the docs URL", () => {
    renderWithProviders(<DocsPage />);
    const frame = screen.getByTitle("mya documentation") as HTMLIFrameElement;
    expect(frame).toBeInTheDocument();
    expect(frame.src).toBe(MYA_DOCS_URL);
  });

  it("uses a sandboxed iframe", () => {
    renderWithProviders(<DocsPage />);
    const frame = screen.getByTitle("mya documentation") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).toContain("allow-same-origin");
  });

  it("links to open docs in a new tab", () => {
    renderWithProviders(<DocsPage />);
    const link = screen.getByText("Open in new tab").closest("a");
    expect(link).toHaveAttribute("href", MYA_DOCS_URL);
    expect(link).toHaveAttribute("target", "_blank");
  });
});
