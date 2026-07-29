// [unit] Modal bodyClassName — verifies the bodyClassName prop override.
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Modal } from "@/lib/modal";

describe("[unit] Modal bodyClassName", () => {
  afterEach(cleanup);

  it("applies bodyClassName to the body wrapper (portal)", () => {
    render(
      <Modal open onClose={() => {}} title="Test" bodyClassName="p-0 terminal-body">
        <div>terminal content</div>
      </Modal>,
    );
    // Modal renders into a portal on document.body
    const body = document.body.querySelector(".terminal-body");
    expect(body).not.toBeNull();
    // The p-0 override should replace the default p-5
    expect(body?.className).toContain("p-0");
    expect(body?.className).not.toContain("p-5");
  });

  it("defaults to p-5 padding when no bodyClassName", () => {
    render(
      <Modal open onClose={() => {}} title="Test">
        <div>content</div>
      </Modal>,
    );
    const body = document.body.querySelector(".p-5");
    expect(body).not.toBeNull();
  });

  it("returns null when open=false (no portal rendered)", () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden" bodyClassName="custom">
        <div>hidden</div>
      </Modal>,
    );
    expect(document.body.querySelector(".custom")).toBeNull();
  });
});
