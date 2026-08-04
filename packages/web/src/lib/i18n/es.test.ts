// @vitest-environment jsdom — i18n es covered by i18n.test.ts batch
import { describe, it, expect } from "vitest";
import * as mod from "./es.js";
describe("[smoke] i18n/es", () => { it("module loads", () => { expect(mod).toBeDefined(); }); });
