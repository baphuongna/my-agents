import { describe, it, expect } from "vitest";
import * as mod from "./entities.js";
describe("[smoke] domains/entities (covered by domains.test.ts)", () => { it("loads", () => { expect(mod).toBeDefined(); }); });
