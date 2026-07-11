import { describe, it, expect } from "vitest";
import { AuditLog } from "@my-agent/audit";

describe("AuditLog — Merkle hash-chain (§14.1, C1)", () => {
  it("append produces monotonically increasing seq + recomputable chain", () => {
    const log = new AuditLog();
    const r1 = log.append({ ts: 1, kind: "tool", actor: "a", payload: { x: 1 } });
    const r2 = log.append({ ts: 2, kind: "tool", actor: "a", payload: { x: 2 } });
    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(2);
    expect(log.length).toBe(2);
    // C1: verify recomputes from the stored records, not trusted hashes.
    expect(log.verify().ok).toBe(true);
  });

  it("C1 fix: verify is NOT a no-op — detects tampered record content", () => {
    const log = new AuditLog();
    log.append({ ts: 1, kind: "tool", actor: "a", payload: { amount: 5 } });
    log.append({ ts: 2, kind: "tool", actor: "a", payload: { amount: 10 } });
    // Mutate an in-memory record (simulates tampering). verify MUST catch it.
    (log as unknown as { records: { payload: Record<string, unknown> }[] }).records[0]!.payload.amount = 999;
    const v = log.verify();
    expect(v.ok).toBe(false);
  });

  it("detects a fork: reports the seq where the chain diverges", () => {
    const log = new AuditLog();
    for (let i = 0; i < 5; i++) log.append({ ts: i, kind: "tool", actor: "a", payload: { i } });
    // Corrupt the stored hash for record 3 → verify should fork at seq 3.
    const hashes = (log as unknown as { hashes: string[] }).hashes;
    hashes[2] = "0".repeat(64);
    const v = log.verify();
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.forksAt).toBe(3);
  });

  it("redacts the payload BEFORE hashing (redactor runs in append)", () => {
    const seen: string[] = [];
    const redactor = (_kind: string, p: Record<string, unknown>) => {
      seen.push(JSON.stringify(p));
      return { ...p, secret: "<redacted>" };
    };
    const log = new AuditLog(redactor);
    log.append({ ts: 1, kind: "tool", actor: "a", payload: { secret: "sk-live", ok: true } });
    // the redacted view was hashed, not the raw payload
    expect(seen[0]).toContain("sk-live");
    const records = (log as unknown as { records: { payload: { secret: string } }[] }).records;
    expect(records[0]!.payload.secret).toBe("<redacted>");
    expect(log.verify().ok).toBe(true);
  });
});
