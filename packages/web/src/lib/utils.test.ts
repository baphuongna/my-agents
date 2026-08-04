import { describe, it, expect } from "vitest";
import * as mod from "./utils.js";
describe("[smoke] utils (covered by web-utils.test.ts)", () => { it("module loads", () => { expect(mod).toBeDefined(); }); });
