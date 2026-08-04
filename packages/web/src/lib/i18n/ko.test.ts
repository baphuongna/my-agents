// @vitest-environment jsdom — i18n ko covered by i18n.test.ts batch
import { describe, it, expect } from "vitest";
import * as mod from "./ko.js";
describe("[smoke] i18n/ko", () => { it("module loads", () => { expect(mod).toBeDefined(); }); });
