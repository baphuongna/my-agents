# headroom — Learnings for mya

> Studied 2026-07-06. Focused pass on a small, single-purpose workspace (4 crates). Source: `/home/bom/source/my-agent/source/headroom`.

## TL;DR
**Headroom** (chopratejas, Apache-2.0) is **not an agent runtime — it is a *context-compression layer for AI agents*.** It compresses everything an agent reads (tool outputs, logs, RAG chunks, files, conversation history) **before it reaches the LLM**, claiming **60–95% fewer tokens, same answers**, and also reduces *output* tokens. Ships as a **Rust workspace + Python (PyO3/maturin) + npm** library, an HTTP **proxy**, and an **MCP server**, backed by a trained compressor model (**Kompress-v2-base**). It is **complementary to mya**, not a competitor — and directly relevant to mya's **cost-tracking + history-pruning** concerns.

## Architecture overview
Cargo workspace (`resolver = 2`), 4 crates:
| Crate | Role |
|---|---|
| `headroom-core` | Compression engine + content-aware compressors |
| `headroom-proxy` | Transparent HTTP proxy: intercepts agent↔LLM traffic, compresses in flight |
| `headroom-py` | Python bindings (PyO3 cdylib, built via maturin) |
| `headroom-parity` | Parity tests ensuring the Rust port matches the Python reference output |

Top-level also has `agent-evals/`, `benchmarks/`, `REALIGNMENT/` (active refactor w/ architecture + phase docs), `sbom/`, `plugins/`, `sdk/`, `sql/`, `wiki/`. Compression model **Kompress-v2-base** on HuggingFace. Three deployment modes: **inline library**, **proxy**, **MCP**.

## Notable patterns & techniques

1. **Context compression as a first-class, content-aware layer.** Not naive truncation — content-aware compressors per type (tool output vs log vs RAG vs conversation), and **reversible**. → **mya does "history pruning" + context compaction, but ad-hoc.** A dedicated, typed compression stage (per-content-type strategies, reversible where needed) before the provider call would directly cut mya's token spend — which mya already *tracks* (`cost`) but doesn't *reduce* systematically. High ROI.

2. **Proxy mode (transparent LLM-side compression).** `headroom-proxy` sits between agent and LLM, compressing requests without the agent knowing. → **mya has provider wrappers (`compatible`, `reliable`)**; adding a **compression wrapper** (or a `compressing` provider decorator) in the same seam is a natural, low-risk integration point. mya could adopt headroom *as* a provider wrapper without forking.

3. **Output-token reduction, not just input.** Headroom also cuts what the model writes *back*. → mya's compression thinking should cover both directions (prompt-in and completion-out), especially for verbose tool/agent outputs stored in history.

4. **Custom trained compressor model (Kompress-v2).** A small specialized model does the compression (learned, not rule-only). `headroom learn` command suggests it can be fine-tuned/adapted. → If mya pursues serious compression, a small local compressor model (à la mya's existing local-LLM/Ollama support) is the state of the art.

5. **Byte-faithful JSON passthrough (Rust serde pattern) — directly reusable.** From `Cargo.toml` comments: headroom enables `serde_json` features **`preserve_order`** (Value::Object uses `IndexMap` → preserves insertion order, matching Python `str(dict)`) **and `arbitrary_precision`** (keeps the literal numeric token so `1.0` ≠ `1` and big ints don't lose f64 precision). This is required for **byte-faithful passthrough on unmutated bytes** ("Realignment invariant I1"). → **mya processes a lot of JSON (tool-call args, provider payloads, config). If mya ever needs deterministic/byte-stable JSON round-trips (reproducible evals, fixture replay, signature verification), enabling these two `serde_json` features is the proven pattern.** Concrete, adoptable today.

6. **MCP mode.** Compression exposed as an MCP server/tool — so *any* MCP-aware agent gets compression for free. → mirrors mya's MCP-first integration philosophy; exposing mya-internal capabilities as MCP tools is already a pattern mya uses.

7. **Rigorous parity testing (`headroom-parity`).** A whole crate dedicated to proving the Rust port matches the Python reference byte-for-byte. → When mya ports/reimplements reference algorithms (e.g., tool-call parser formats, memory processing), a dedicated **parity-test crate** (golden fixtures from the reference impl) is a strong correctness practice.

## Top ideas worth adopting (prioritized)
1. **A typed, content-aware compression stage** in mya's context pipeline (per-content-type, reversible) before provider calls — cuts the token cost mya already measures.
2. **`serde_json` `preserve_order` + `arbitrary_precision`** for byte-faithful JSON (helps eval/replay/signing correctness). Cheap, adoptable now.
3. **Compression as a provider wrapper** (mirror `reliable`/`compatible`) — optional, composable, no core rewrite.
4. **Parity-test crate pattern** for any reference algorithm mya reimplements.
5. Track **output-token** reduction alongside input — extend mya's cost metrics.

## Differences vs mya
| Axis | headroom | mya |
|---|---|---|
| Purpose | token-compression layer (tool) | full agent runtime (product) |
| Scope | one concern, deep | broad, 18 crates |
| LLM relationship | sits *between* agent & LLM | *is* the agent |
| Relevance | **integrable into mya** | — |

Headroom is a **candidate dependency / integration**, not a template. mya could vendor its approach (or call headroom via MCP/proxy) to gain token compression without building it.

## Gotchas / anti-patterns to avoid
- Compression that changes semantics = silent answer drift. Headroom invests heavily in `agent-evals/` + `benchmarks/` to prove "same answers." If mya compresses, it **must** carry eval gates (mya already has `mya-eval` — good foundation to reuse for compression-quality regression).
- Naive truncation (not content-aware) loses signal — avoid; copy headroom's per-type strategy.

## Key reference files
- `README.md` (demo: 10,144 → 1,260 tokens), `Cargo.toml` (the `serde_json` feature rationale)
- `crates/headroom-core/` (compressors), `crates/headroom-proxy/` (proxy mode), `crates/headroom-parity/` (parity tests)
- `REALIGNMENT/{02-architecture,03-phase-A-lockdown}.md` (byte-faithful passthrough invariant I1)
- `agent-evals/`, `benchmarks/` (compression-quality proof)

## Scope note (skipped)
Did not read compressor source or the Kompress model. A follow-up on `headroom-core` compressor strategies + the proxy interception logic would give concrete algorithms if mya adopts idea #1/#3.
