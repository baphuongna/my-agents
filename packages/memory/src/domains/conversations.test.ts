import { describe, it, expect } from "vitest";
import * as mod from "./conversations.js";
describe("[smoke] domains/conversations (covered by domains.test.ts)", () => { it("loads", () => { expect(mod).toBeDefined(); }); });
