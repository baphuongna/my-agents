// @vitest-environment jsdom — i18n fr covered by i18n.test.ts batch
import { describe, it, expect } from "vitest";
import * as mod from "./fr.js";
describe("[smoke] i18n/fr", () => { it("module loads", () => { expect(mod).toBeDefined(); }); });
