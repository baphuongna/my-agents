// @vitest-environment jsdom — i18n ja covered by i18n.test.ts batch
import { describe, it, expect } from "vitest";
import * as mod from "./ja.js";
describe("[smoke] i18n/ja", () => { it("module loads", () => { expect(mod).toBeDefined(); }); });
