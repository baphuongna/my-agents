import { describe, it, expect } from "vitest";
import * as mod from "./sources.js";
describe("[smoke] domains/sources", () => { it("loads", () => { expect(mod).toBeDefined(); }); });
