import { describe, it, expect } from "vitest";
import * as mod from "./store.js";
describe("[smoke] domains/store", () => { it("loads", () => { expect(mod).toBeDefined(); }); });
