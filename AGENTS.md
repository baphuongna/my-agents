# AGENTS.md — see .learned/AGENT-SPEC.md (authoritative)

Stack: TS7 / Rust-stable via napi-rs / Node ≥20 ESM.
Rust gate (any one): trust boundary | hot inner loop (>100k files / AST) | determinism | platform parity.
Hard rules (§18): minimal core, no sandbox, single time helper (`core.time` / `natives.time`),
no `process::exit` in natives (`NativeResult<T>`), transports ↛ core, byte-faithful JSON,
no stub-then-replace.
Style: TS strict + `noUncheckedIndexedAccess` + ESM + discriminated unions; Rust `clippy::exit` denied.