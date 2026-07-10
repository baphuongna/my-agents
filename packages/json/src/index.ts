/**
 * @my-agent/json — byte-faithful JSON canonicalization (§5/§14.1/§17).
 *
 * Deterministic serialization (keys sorted recursively, no whitespace, UTF-8
 * NFC) for signing/audit determinism. The shared util @my-agent/audit (§14.1
 * hash-chain) and future signing paths consume this instead of a local copy.
 *
 * Source: §5 Byte-faithful JSON (headroom invariant I1), §14.1 AuditLog chain.
 */

/** Canonicalize any JSON-serializable value: keys sorted recursively, no
 * whitespace, UTF-8 NFC. Identical logical content → identical bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)).normalize("NFC");
}

/** Recursively sort object keys (arrays preserve order). */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

/** A stable stringifier that also accepts a replacer + indent (like JSON.stringify
 * but with deterministic key order). Useful for fixture generation / golden files. */
export function stableStringify(value: unknown, indent?: number): string {
  return JSON.stringify(sortKeys(value), null, indent);
}

/** Structural equality over the canonical form (order-independent deep equal). */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
