// @vitest-environment jsdom — i18n de covered by i18n.test.ts batch
import { describe, it, expect } from "vitest";
import * as mod from "./de.js";
describe("[smoke] i18n/de", () => { it("module loads", () => { expect(mod).toBeDefined(); }); });
