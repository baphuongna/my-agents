//! my-agent-natives — Rust engine exposed to TS via napi-rs.
//!
//! Tier-0 scaffold: the four gate-justified native surfaces (search, fs, ast,
//! crypto) declared as `NativeResult<T>`-returning stubs. Panics NEVER kill the
//! process — `catch_unwind` + NativeResult::Panic (R27-12, invariant #14).
//! No shell/sandbox (R30 pi model).
//!
//! Rust-gate justification (§2 / AGENTS.md):
//!   search  — hot inner loop (b)
//!   ast     — hot inner loop (b) + determinism (c)
//!   crypto  — trust boundary (a)
//!   fs      — hot inner loop (b) on large repos

#![deny(clippy::exit)]

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Canonical napi result envelope — panics become a typed value, never a crash.
/// Mirrors `NativeResult<T>` in @my-agent/core (R27-12).
#[napi(object)]
pub struct NativePanic {
  pub backtrace: String,
}

/// Byte-faithful content hash (xxHash3 or blake3) for edit-line + audit.
/// Tier-0 stub: returns a placeholder. Concrete impl lands with the ast/crypto crates.
#[napi]
pub fn hash_content(_input: Buffer) -> Result<String> {
  // TODO(Tier-1): blake3(_input) → hex. Placeholder for scaffold.
  Ok(String::from("00000000000000000000000000000000"))
}

/// Glob match (ripgrep-class). Tier-0 stub: returns empty.
/// Real impl lives in crates/search (Tier 1).
#[napi]
pub fn glob(_pattern: String, _root: String) -> Result<Vec<String>> {
  Ok(Vec::new())
}

/// Grep (content search). Tier-0 stub: returns empty.
/// Real impl lives in crates/search (Tier 1).
#[napi(object)]
pub struct GrepHit {
  pub path: String,
  pub line: u32,
  pub text: String,
}

#[napi]
pub fn grep(_pattern: String, _root: String) -> Result<Vec<GrepHit>> {
  Ok(Vec::new())
}

/// Single monotonic clock — the ONLY monotonic source (invariant #10).
/// Monotonic has no epoch; returns nanos since a process-local anchor.
/// TS core.time mirrors this; never call Instant elsewhere in Rust.
#[napi]
pub fn now_monotonic_nanos() -> Result<u64> {
  use std::sync::OnceLock;
  use std::time::Instant;
  static ANCHOR: OnceLock<Instant> = OnceLock::new();
  let anchor = ANCHOR.get_or_init(Instant::now);
  Ok(anchor.elapsed().as_nanos() as u64)
}

/// Wallclock nanos since UNIX_EPOCH — the ONLY wall source (invariant #10).
#[napi]
pub fn now_wallclock_nanos() -> Result<u64> {
  use std::time::{SystemTime, UNIX_EPOCH};
  Ok(
    SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_nanos() as u64,
  )
}

/// ABI stamp — refuses mismatched-release binaries (R25-23).
/// TS asserts this matches its expected natives semver before dlopen.
#[napi]
pub fn natives_version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}
