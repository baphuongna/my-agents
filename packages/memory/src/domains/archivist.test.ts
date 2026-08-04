import { describe, it, expect } from "vitest";
import * as mod from "./archivist.js";
describe("[smoke] domains/archivist (covered by domains.test.ts)", () => { it("loads", () => { expect(mod).toBeDefined(); }); });
