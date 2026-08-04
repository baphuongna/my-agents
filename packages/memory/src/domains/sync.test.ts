import { describe, it, expect } from "vitest";
import * as mod from "./sync.js";
describe("[smoke] domains/sync", () => { it("loads", () => { expect(mod).toBeDefined(); }); });
