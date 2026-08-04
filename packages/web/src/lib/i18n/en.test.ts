// @vitest-environment jsdom — i18n en covered by i18n.test.ts batch
import { describe, it, expect } from "vitest";
import * as mod from "./en.js";
describe("[smoke] i18n/en", () => { it("module loads", () => { expect(mod).toBeDefined(); }); });
