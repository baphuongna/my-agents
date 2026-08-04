// @vitest-environment jsdom — i18n zh covered by i18n.test.ts batch
import { describe, it, expect } from "vitest";
import * as mod from "./zh.js";
describe("[smoke] i18n/zh", () => { it("module loads", () => { expect(mod).toBeDefined(); }); });
