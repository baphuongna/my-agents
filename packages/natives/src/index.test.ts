/**
 * @my-agent/natives — comprehensive contract tests.
 *
 * The natives module is the trust boundary (BLAKE3 content hash) + hot inner
 * loop (glob/grep) with a graceful pure-JS fallback. Per the module's own
 * "pit of success" design, consumers should NOT branch on `isNativeAvailable`;
 * therefore these tests assert the **observable contract** that holds whether
 * the Rust `.node` is loaded or the JS fallback is active. This keeps the suite
 * green in both configurations and guards the trust boundary + determinism
 * invariants (AGENTS.md §18).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  nativeHash,
  nativeMac,
  nativeGlob,
  nativeGrep,
  nativeCompressLog,
  nativeApproxTokens,
  nativeReflinkOrCopy,
  nativeParseTsSymbols,
  nativesVersion,
  isNativeAvailable,
  nativeEvalRhai,
  verifyNativeDeclaration,
} from "./index.js";
import type { NativeDeclaration, NativeVerifyResult } from "./index.js";

const HEX64 = /^[0-9a-f]{64}$/;

// ─── shared fixture tree for glob/grep/reflink ───────────────────────────────
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "natives-test-"));
  // top-level files
  writeFileSync(join(root, "alpha.ts"), "export function alpha() {\n  return 1;\n}\n");
  writeFileSync(join(root, "beta.ts"), "const BETA = 'hi';\n// TODO: review beta\n");
  writeFileSync(join(root, "readme.md"), "# Project\n\nHELLO world\n");
  writeFileSync(join(root, "data.json"), '{"key": "value"}\n');
  // hidden file (excluded by default)
  writeFileSync(join(root, ".hidden.ts"), "// secret\n");
  // nested dir
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub", "gamma.ts"), "export const gamma = 42;\n");
  mkdirSync(join(root, "sub", "deep"));
  writeFileSync(join(root, "sub", "deep", "delta.ts"), "// deeply nested\n");
  // skip-dirs that must never be traversed
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "node_modules", "pkg.ts"), "// should be skipped\n");
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist", "bundle.js"), "// built\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ─── nativeHash (trust boundary: content hash) ───────────────────────────────
describe("nativeHash", () => {
  it("returns a 64-char lowercase hex string", () => {
    expect(nativeHash("hello")).toMatch(HEX64);
  });

  it("is deterministic for identical input", () => {
    expect(nativeHash("same-bytes")).toBe(nativeHash("same-bytes"));
  });

  it("differs for different input", () => {
    expect(nativeHash("a")).not.toBe(nativeHash("b"));
  });

  it("treats a string and its Buffer of the same bytes identically", () => {
    const s = "payload";
    expect(nativeHash(s)).toBe(nativeHash(Buffer.from(s, "utf8")));
  });

  it("returns a valid 64-hex hash for the empty string", () => {
    expect(nativeHash("")).toMatch(HEX64);
    expect(nativeHash("").length).toBe(64);
  });
});

// ─── nativeMac (keyed MAC) ───────────────────────────────────────────────────
describe("nativeMac", () => {
  it("returns a 64-char lowercase hex string", () => {
    expect(nativeMac("secret-key", "message")).toMatch(HEX64);
  });

  it("is deterministic for identical key + message", () => {
    expect(nativeMac("k", "m")).toBe(nativeMac("k", "m"));
  });

  it("differs when the key changes", () => {
    expect(nativeMac("key-one", "msg")).not.toBe(nativeMac("key-two", "msg"));
  });

  it("with an empty key falls back to the unkeyed hash of the message", () => {
    // Contract shared by native + JS fallback (see module source).
    expect(nativeMac("", "the-message")).toBe(nativeHash("the-message"));
  });

  it("accepts Buffer key/message and matches the equivalent strings", () => {
    const macStr = nativeMac("k", "m");
    const macBuf = nativeMac(Buffer.from("k"), Buffer.from("m"));
    expect(macBuf).toBe(macStr);
  });
});

// ─── nativeGlob (hot loop: file discovery) ───────────────────────────────────
describe("nativeGlob", () => {
  it("matches top-level *.ts files and returns relative paths", () => {
    const res = nativeGlob("*.ts", root);
    expect(res).toContain("alpha.ts");
    expect(res).toContain("beta.ts");
    // top-level glob must not pull in nested files or other extensions
    expect(res.some((p) => p.includes("/"))).toBe(false);
    expect(res).not.toContain("readme.md");
  });

  it("matches recursively with **/*.ts", () => {
    const res = nativeGlob("**/*.ts", root);
    expect(res.length).toBeGreaterThan(0);
    expect(res).toContain("sub/gamma.ts");
    expect(res).toContain("sub/deep/delta.ts");
  });

  it("returns [] (does not throw) for a missing directory", () => {
    expect(nativeGlob("*.ts", join(root, "does-not-exist"))).toEqual([]);
  });

  it("returns [] (does not throw) for an invalid pattern path", () => {
    // a syntactically-fine pattern over a missing root still yields []
    expect(() => nativeGlob("*.ts", "/no/such/root/here")).not.toThrow();
    expect(nativeGlob("*.ts", "/no/such/root/here")).toEqual([]);
  });

  it("honors maxResults to cap the result count", () => {
    const full = nativeGlob("**/*.ts", root);
    const capped = nativeGlob("**/*.ts", root, { maxResults: 1 });
    expect(capped.length).toBe(1);
    expect(full.length).toBeGreaterThanOrEqual(capped.length);
  });

  it("skips node_modules and dist directories", () => {
    const res = nativeGlob("**/*", root);
    expect(res.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(res.some((p) => p.startsWith("dist/"))).toBe(false);
  });

  it("excludes dotfiles by default and includes them with includeHidden", () => {
    expect(nativeGlob("*.ts", root)).not.toContain(".hidden.ts");
    const withHidden = nativeGlob("*.ts", root, { includeHidden: true });
    expect(withHidden).toContain(".hidden.ts");
  });
});

// ─── nativeGrep (hot loop: content search) ───────────────────────────────────
describe("nativeGrep", () => {
  it("returns GrepHit objects {path, line, text} for literal matches", () => {
    const hits = nativeGrep("TODO", root);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(typeof h.path).toBe("string");
      expect(typeof h.line).toBe("number");
      expect(typeof h.text).toBe("string");
      expect(h.line).toBeGreaterThan(0);
    }
    expect(hits.some((h) => h.path === "beta.ts")).toBe(true);
  });

  it("returns [] (does not throw) for an invalid regex", () => {
    expect(() => nativeGrep("(unclosed", root)).not.toThrow();
    expect(nativeGrep("(unclosed", root)).toEqual([]);
  });

  it("supports caseInsensitive matching", () => {
    const ci = nativeGrep("hello", root, { caseInsensitive: true });
    // should match both lowercase 'hello' and uppercase 'HELLO world'
    expect(ci.some((h) => h.path === "readme.md")).toBe(true);
  });

  it("is case-sensitive by default", () => {
    const cs = nativeGrep("hello", root);
    expect(cs.some((h) => h.path === "readme.md")).toBe(false);
  });

  it("honors maxResults", () => {
    const capped = nativeGrep(".*", root, { maxResults: 1 });
    expect(capped.length).toBeLessThanOrEqual(1);
  });
});

// ─── nativeCompressLog (content-aware compactor) ─────────────────────────────
describe("nativeCompressLog", () => {
  it("returns {text, originalLines, compressedLines}", () => {
    const out = nativeCompressLog("one\ntwo\nthree");
    expect(typeof out.text).toBe("string");
    expect(out.originalLines).toBe(3);
    expect(typeof out.compressedLines).toBe("number");
    expect(out.compressedLines).toBeGreaterThan(0);
  });

  it("reduces line count for repetitive content", () => {
    // 4 identical lines (>= collapseRun default of 3) collapse to 2 emitted lines
    const out = nativeCompressLog("dup\ndup\ndup\ndup");
    expect(out.originalLines).toBe(4);
    expect(out.compressedLines).toBeLessThan(out.originalLines);
    expect(out.compressedLines).toBe(2);
    expect(out.text).toContain("4 repeated");
  });

  it("preserves non-repetitive content unchanged", () => {
    const out = nativeCompressLog("only one unique line");
    expect(out.originalLines).toBe(1);
    expect(out.compressedLines).toBe(1);
    expect(out.text).toBe("only one unique line");
  });

  it("truncates long lines according to maxLineLen", () => {
    const long = "x".repeat(300);
    const out = nativeCompressLog(long, { maxLineLen: 50 });
    expect(out.text.length).toBeLessThan(long.length);
    expect(out.text.endsWith("…")).toBe(true);
  });
});

// ─── nativeApproxTokens ──────────────────────────────────────────────────────
describe("nativeApproxTokens", () => {
  it("returns 0 for the empty string", () => {
    expect(nativeApproxTokens("")).toBe(0);
  });

  it("returns a positive integer for non-empty input", () => {
    const n = nativeApproxTokens("abcdefgh");
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it("is roughly chars/4", () => {
    const s = "a".repeat(40);
    const n = nativeApproxTokens(s);
    // floor(chars/4) = 10; allow a small engine variance band
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(12);
  });
});

// ─── nativeReflinkOrCopy (CoW clone with copy fallback) ──────────────────────
describe("nativeReflinkOrCopy", () => {
  it("returns {method, bytes} with a recognized method", () => {
    const src = join(root, "blob.bin");
    const dst = join(root, "blob.copy");
    writeFileSync(src, Buffer.from([0, 1, 2, 3, 255]));
    const res = nativeReflinkOrCopy(src, dst);
    expect(res.method === "reflink" || res.method === "copy").toBe(true);
    expect(typeof res.bytes).toBe("number");
  });

  it("copies file content byte-for-byte to the destination", () => {
    const src = join(root, "src.bin");
    const dst = join(root, "dst.bin");
    const payload = Buffer.from([0, 127, 128, 255, 0, 1]);
    writeFileSync(src, payload);
    nativeReflinkOrCopy(src, dst);
    expect(readFileSync(dst).equals(payload)).toBe(true);
  });

  it("reports the source file size as bytes", () => {
    const src = join(root, "sized.bin");
    const dst = join(root, "sized.copy");
    const payload = Buffer.alloc(64, 7);
    writeFileSync(src, payload);
    const res = nativeReflinkOrCopy(src, dst);
    expect(res.bytes).toBe(payload.length);
  });

  it("works for empty files", () => {
    const src = join(root, "empty.bin");
    const dst = join(root, "empty.copy");
    writeFileSync(src, Buffer.alloc(0));
    const res = nativeReflinkOrCopy(src, dst);
    expect(res.bytes).toBe(0);
    expect(readFileSync(dst).length).toBe(0);
  });
});

// ─── nativeParseTsSymbols (symbol extraction) ────────────────────────────────
describe("nativeParseTsSymbols", () => {
  it("returns symbols with the {kind, name, startLine, endLine} shape", () => {
    const syms = nativeParseTsSymbols("function foo() {}\nclass Bar {}");
    expect(syms.length).toBeGreaterThan(0);
    for (const s of syms) {
      expect(["function", "method", "class", "arrow"]).toContain(s.kind);
      expect(typeof s.name).toBe("string");
      expect(typeof s.startLine).toBe("number");
      expect(typeof s.endLine).toBe("number");
      expect(s.startLine).toBeGreaterThanOrEqual(1);
    }
  });

  it("extracts function and class names", () => {
    const syms = nativeParseTsSymbols(
      "function myFunc() {}\nclass MyClass {}\nconst arrow = () => 1\n",
    );
    const names = syms.map((s) => s.name);
    expect(names).toContain("myFunc");
    expect(names).toContain("MyClass");
  });

  it("assigns startLine to the defining line", () => {
    const src = "\n\nfunction third() {}\n";
    const syms = nativeParseTsSymbols(src);
    const fn = syms.find((s) => s.name === "third");
    expect(fn).toBeDefined();
    expect(fn!.startLine).toBe(3);
  });

  it("returns [] for non-code / empty input", () => {
    expect(nativeParseTsSymbols("")).toEqual([]);
    expect(nativeParseTsSymbols("just some prose with no code")).toEqual([]);
  });
});

// ─── diagnostics + Rhai eval ─────────────────────────────────────────────────
describe("nativesVersion", () => {
  it("returns a non-empty version string", () => {
    const v = nativesVersion();
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });
});

describe("isNativeAvailable", () => {
  it("is a boolean diagnostic flag", () => {
    expect(typeof isNativeAvailable).toBe("boolean");
  });
});

describe("nativeEvalRhai", () => {
  it("returns null or {value, events}", () => {
    const r = nativeEvalRhai("1 + 1", {});
    // When the native is available + supports evalRhai → {value, events};
    // otherwise → null. Both are valid contract outcomes.
    if (r !== null) {
      expect(r).toHaveProperty("value");
      expect(Array.isArray(r.events)).toBe(true);
    } else {
      expect(r).toBeNull();
    }
  });

  it("accepts a context object without throwing", () => {
    expect(() => nativeEvalRhai("let x = 42;", { x: 0 })).not.toThrow();
  });
});

// ─── verifyNativeDeclaration (fail-closed security gate, §14b) ───────────────
describe("verifyNativeDeclaration", () => {
  it("rejects non-.node paths (path-traversal defense)", async () => {
    const decl: NativeDeclaration = {
      path: "../../../etc/passwd.txt",
      contentHash: "0".repeat(64),
      sigstoreBundle: { fake: true },
    };
    const res: NativeVerifyResult = await verifyNativeDeclaration(decl);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("path-traversal");
  });

  it("rejects a missing sigstore bundle (sigstore-required)", async () => {
    const decl: NativeDeclaration = {
      path: join(root, "third.node"),
      contentHash: "0".repeat(64),
      sigstoreBundle: null,
    };
    const res = await verifyNativeDeclaration(decl);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("sigstore-required");
  });

  it("rejects a missing file (file-missing)", async () => {
    const decl: NativeDeclaration = {
      path: join(root, "absent.node"),
      contentHash: "0".repeat(64),
      sigstoreBundle: { fake: true },
    };
    const res = await verifyNativeDeclaration(decl);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("file-missing");
  });

  it("rejects a content-hash mismatch (hash-mismatch)", async () => {
    // A real .node file whose bytes do not match the declared (wrong) hash.
    const file = join(root, "mismatch.node");
    writeFileSync(file, Buffer.from("not-the-expected-bytes"));
    const decl: NativeDeclaration = {
      path: file,
      contentHash: "f".repeat(64), // intentionally wrong
      sigstoreBundle: { fake: true },
    };
    const res = await verifyNativeDeclaration(decl);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("hash-mismatch");
  });
});
