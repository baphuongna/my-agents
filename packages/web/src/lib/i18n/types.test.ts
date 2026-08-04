// @vitest-environment jsdom — i18n types covered by i18n.test.ts batch
import { describe, it, expect } from "vitest";
import * as mod from "./types.js";
describe("[smoke] i18n/types", () => { it("module loads", () => { expect(mod).toBeDefined(); }); });
