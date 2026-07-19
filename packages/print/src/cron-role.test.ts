import { describe, it, expect } from "vitest";
import { CRON_ROLE_DENIED_TOOLS, cronSessionExcludeTools } from "./cron-role.js";

describe("cron role tool policy (Phase 0A seam)", () => {
  it("returns the deny list for _cron:<id> sessions, undefined otherwise", () => {
    expect(cronSessionExcludeTools("_cron:job1")).toBe(CRON_ROLE_DENIED_TOOLS);
    expect(cronSessionExcludeTools("s-interactive")).toBeUndefined();
    expect(cronSessionExcludeTools("_cron")).toBeUndefined(); // needs the colon
    expect(cronSessionExcludeTools("")).toBeUndefined();
  });

  it("populating the deny list propagates to cron sessions (3C sets bash/write/edit)", () => {
    // Phase 3C (approval_mode: deny) will push the re-entry vectors here. This
    // test proves the seam propagates a populated list to _cron: sessions only.
    const before = CRON_ROLE_DENIED_TOOLS.length;
    CRON_ROLE_DENIED_TOOLS.push("bash", "write", "edit");
    try {
      const denied = cronSessionExcludeTools("_cron:daily-report");
      expect(denied).toContain("bash");
      expect(denied).toContain("write");
      expect(denied).toContain("edit");
      // non-cron session is unaffected (interactive keeps full tools)
      expect(cronSessionExcludeTools("s-normal")).toBeUndefined();
    } finally {
      // restore the module singleton (other tests expect empty default)
      CRON_ROLE_DENIED_TOOLS.splice(before, CRON_ROLE_DENIED_TOOLS.length - before);
    }
    expect(CRON_ROLE_DENIED_TOOLS).toHaveLength(0);
  });
});
