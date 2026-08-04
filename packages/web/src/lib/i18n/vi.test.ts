// @vitest-environment jsdom — i18n vi covered by i18n.test.ts batch
import { describe, it, expect } from "vitest";
import * as mod from "./vi.js";
describe("[smoke] i18n/vi", () => { it("module loads", () => { expect(mod).toBeDefined(); }); });
