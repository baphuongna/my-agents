import { describe, it, expect } from "vitest";
import {
  CRON_ROLE_ALLOWED_TOOLS,
  CRON_DENY_MODE_TOOLS,
  cronSessionToolConfig,
  setCronApprovalMode,
  getCronApprovalMode,
} from "./cron-role.js";

describe("cron role tool policy (Phase 0A/3C — allowlist)", () => {
  it("deny-mode (default): _cron: sessions get the read-only allowlist; bash/write excluded", () => {
    setCronApprovalMode("deny");
    const cfg = cronSessionToolConfig("_cron:daily-report");
    expect(cfg.tools).toEqual(CRON_DENY_MODE_TOOLS);
    expect(cfg.tools).toEqual(["read", "glob", "grep", "ls", "find"]);
    expect(cfg.tools).not.toContain("bash");
    expect(cfg.tools).not.toContain("write");
  });

  it("approve-mode: _cron: sessions get NO restriction (full tools)", () => {
    setCronApprovalMode("approve");
    expect(cronSessionToolConfig("_cron:x")).toEqual({});
    setCronApprovalMode("deny"); // restore default for other tests
  });

  it("non-cron sessions are never restricted", () => {
    setCronApprovalMode("deny");
    expect(cronSessionToolConfig("s-interactive")).toEqual({});
    expect(cronSessionToolConfig("")).toEqual({});
  });

  it("default mode is deny", () => {
    setCronApprovalMode("deny");
    expect(getCronApprovalMode()).toBe("deny");
  });
});
