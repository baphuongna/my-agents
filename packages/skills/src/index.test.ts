import { describe, it, expect } from "vitest";
describe("[smoke] skills/index barrel", () => { it("loads", async () => { const m = await import("./index.js"); expect(m).toBeDefined(); }); });
