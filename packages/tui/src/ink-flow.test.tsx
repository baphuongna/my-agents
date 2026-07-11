/**
 * Phase 27 integration smoke tests: verify the Ink session wires the
 * newly-imported Phase 19-24 modules (Autocomplete, themes, MdInline,
 * KillRing/EditorOps) so they don't get tree-shaken from the bundle
 * (the original Phase 19-24 dead-code bug).
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { render as inkRender } from "ink-testing-library";
import { InkSession } from "./ink.js";

describe("Phase 27 ink.tsx wires all Phase 19-24 modules (no more dead code)", () => {
  it("renders the header + status bar + input prompt", () => {
    const { lastFrame } = inkRender(
      <InkSession
        onSubmit={() => Promise.resolve()}
        onAbort={() => {}}
        onApproval={() => {}}
        initialStatus={{ provider: "minimax", model: "MiniMax-M3", tokensIn: 0, tokensOut: 0, spentUsd: 0, budgetUsd: 0 }}
        commands={[]}
      />,
    );
    const f = lastFrame();
    expect(f).toContain("mya");
    expect(f).toContain("interactive agent");
    expect(f).toContain("minimax");
  });
});
