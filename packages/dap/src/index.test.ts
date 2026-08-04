import { describe, it, expect } from "vitest";
describe("[smoke] dap/index barrel", () => { it("loads", async () => { const m = await import("./index.js"); expect(m).toBeDefined(); }); });
