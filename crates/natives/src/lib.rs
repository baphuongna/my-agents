//! my-agent-natives — Rust engine exposed to TS via napi-rs.
//!
//! Tier 4: real implementations of the four gate-justified native surfaces.
//! Panics NEVER kill the process — every entry is wrapped in `catch_unwind`
//! and mapped to a typed error (invariant #14, R27-12). No shell/sandbox (R30).
//!
//! Rust-gate justification (§2 / AGENTS.md):
//!   hash_content / blake3_mac — trust boundary (a): memory-safe crypto, no GC
//!   glob / grep                — hot inner loop (b): walk + match over 100k+ files
//!   now_*                      — determinism (c): the sole monotonic source (#10)

#![deny(clippy::exit)]

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Convert a panic payload into a readable error string.
fn panic_msg(p: Box<dyn std::any::Any + Send>) -> String {
  if let Some(s) = p.downcast_ref::<&'static str>() {
    format!("native panic: {s}")
  } else if let Some(s) = p.downcast_ref::<String>() {
    format!("native panic: {s}")
  } else {
    "native panic: (unknown payload)".to_string()
  }
}

/// Run a closure, turning any panic into a napi Error (never kills the process).
fn guarded<T>(label: &str, f: impl FnOnce() -> Result<T>) -> Result<T> {
  match catch_unwind(AssertUnwindSafe(f)) {
    Ok(r) => r,
    Err(p) => Err(Error::new(Status::GenericFailure, format!("{label}: {}", panic_msg(p)))),
  }
}

/// Directories to skip when walking a repo tree (perf + avoids noise).
const SKIP_DIRS: &[&str] = &[
  ".git",
  "node_modules",
  "target",
  "dist",
  ".next",
  ".crew",
  ".DS_Store",
];

fn should_skip(name: &str) -> bool {
  SKIP_DIRS.contains(&name)
}

// ─── crypto (trust boundary) ────────────────────────────────────────────────

/// Byte-faithful content hash (BLAKE3) → 32-byte hex string.
/// Used by hashline line-anchoring + audit integrity.
#[napi]
pub fn hash_content(input: Buffer) -> Result<String> {
  guarded("hash_content", || {
    let hash = blake3::hash(input.as_ref());
    Ok(hash.to_hex().to_string())
  })
}

/// Keyed BLAKE3 MAC (32-byte hex). Used by x402 to sign payment challenges
/// deterministically (same key + message → same MAC; verifiable).
/// The input key (any length) is hashed to a 32-byte BLAKE3 key first.
/// Empty key → unkeyed hash (degenerate but safe).
#[napi]
pub fn blake3_mac(key: Buffer, message: Buffer) -> Result<String> {
  guarded("blake3_mac", || {
    if key.is_empty() {
      let hash = blake3::hash(message.as_ref());
      return Ok(hash.to_hex().to_string());
    }
    // Derive a 32-byte key from the arbitrary-length input (blake3 keyed mode
    // requires exactly 32 bytes). Hashing the key first is the standard recipe.
    let mut key_hasher = blake3::Hasher::new();
    key_hasher.update(key.as_ref());
    let key_bytes: [u8; 32] = *key_hasher.finalize().as_bytes();
    let mut hasher = blake3::Hasher::new_keyed(&key_bytes);
    hasher.update(message.as_ref());
    Ok(hasher.finalize().to_hex().to_string())
  })
}

// ─── glob (hot inner loop) ──────────────────────────────────────────────────

#[napi(object)]
pub struct GlobOptions {
  /// Max files to return (perf bound). Default 10000.
  pub max_results: Option<u32>,
  /// Include hidden files (dotfiles). Default false.
  pub include_hidden: Option<bool>,
}

/// Glob match files in `root` against a glob pattern (gitignore-style via globset).
/// Returns matching file paths (relative to root, forward slashes).
/// Skips .git/node_modules/target/dist/.next/.crew by default.
#[napi]
pub fn glob(pattern: String, root: String, options: Option<GlobOptions>) -> Result<Vec<String>> {
  guarded("glob", || {
    let matcher = globset::GlobBuilder::new(&pattern)
      .literal_separator(true)
      .build()
      .map_err(|e| Error::new(Status::GenericFailure, format!("glob compile: {e}")))?
      .compile_matcher();
    let max = options.as_ref().and_then(|o| o.max_results).unwrap_or(10_000) as usize;
    let include_hidden = options.as_ref().and_then(|o| o.include_hidden).unwrap_or(false);
    let root_path = Path::new(&root);
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(root_path)
      .follow_links(false)
      .into_iter()
      .filter_entry(|e| {
        if e.file_type().is_dir() {
          let name = e.file_name().to_string_lossy();
          if should_skip(&name) {
            return false;
          }
          if !include_hidden && name.starts_with('.') && name != "." && name != ".." {
            return false;
          }
        }
        true
      })
    {
      let entry = match entry {
        Ok(e) => e,
        Err(_) => continue,
      };
      if !entry.file_type().is_file() {
        continue;
      }
      let rel = match entry.path().strip_prefix(root_path) {
        Ok(r) => r,
        Err(_) => continue,
      };
      let rel_str = rel.to_string_lossy().replace('\\', "/");
      if !include_hidden
        && rel_str
          .split('/')
          .any(|seg| seg.starts_with('.') && !seg.is_empty())
      {
        continue;
      }
      if matcher.is_match(&rel_str) {
        out.push(rel_str);
        if out.len() >= max {
          break;
        }
      }
    }
    out.sort();
    Ok(out)
  })
}

// ─── grep (hot inner loop) ──────────────────────────────────────────────────

#[napi(object)]
pub struct GrepHit {
  /// File path relative to root (forward slashes).
  pub path: String,
  /// 1-based line number.
  pub line: u32,
  /// The matching line text (without trailing newline).
  pub text: String,
}

#[napi(object)]
pub struct GrepOptions {
  /// Max hits to return. Default 1000.
  pub max_results: Option<u32>,
  /// Case-insensitive. Default false.
  pub case_insensitive: Option<bool>,
  /// Include hidden files. Default false.
  pub include_hidden: Option<bool>,
}

/// Grep file contents in `root` for a regex pattern. Returns matching lines.
/// Skips binary files (NUL byte heuristic) + the usual dirs.
#[napi]
pub fn grep(
  pattern: String,
  root: String,
  options: Option<GrepOptions>,
) -> Result<Vec<GrepHit>> {
  guarded("grep", || {
    let case_insensitive = options.as_ref().and_then(|o| o.case_insensitive).unwrap_or(false);
    let re = regex::RegexBuilder::new(&pattern)
      .case_insensitive(case_insensitive)
      .build()
      .map_err(|e| Error::new(Status::GenericFailure, format!("grep regex: {e}")))?;
    let max = options.as_ref().and_then(|o| o.max_results).unwrap_or(1000) as usize;
    let include_hidden = options.as_ref().and_then(|o| o.include_hidden).unwrap_or(false);
    let root_path = Path::new(&root);
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(root_path)
      .follow_links(false)
      .into_iter()
      .filter_entry(|e| {
        if e.file_type().is_dir() {
          let name = e.file_name().to_string_lossy();
          if should_skip(&name) {
            return false;
          }
          if !include_hidden && name.starts_with('.') && name != "." && name != ".." {
            return false;
          }
        }
        true
      })
    {
      if out.len() >= max {
        break;
      }
      let entry = match entry {
        Ok(e) => e,
        Err(_) => continue,
      };
      if !entry.file_type().is_file() {
        continue;
      }
      let rel = match entry.path().strip_prefix(root_path) {
        Ok(r) => r,
        Err(_) => continue,
      };
      let rel_str = rel.to_string_lossy().replace('\\', "/");
      if !include_hidden
        && rel_str
          .split('/')
          .any(|seg| seg.starts_with('.') && !seg.is_empty())
      {
        continue;
      }
      // Read + skip binary files (NUL-byte heuristic).
      let bytes = match std::fs::read(entry.path()) {
        Ok(b) => b,
        Err(_) => continue,
      };
      if bytes.contains(&0u8) {
        continue;
      }
      let text = String::from_utf8_lossy(&bytes);
      for (i, line) in text.lines().enumerate() {
        if re.is_match(line) {
          out.push(GrepHit {
            path: rel_str.clone(),
            line: (i + 1) as u32,
            text: line.to_string(),
          });
          if out.len() >= max {
            break;
          }
        }
      }
    }
    Ok(out)
  })
}

// ─── compression (hot loop + determinism gate, §2/§5) ───────────────────────
// Spec §2 lists compression as a Rust-gate concern (perf + byte-determinism).
// Pragmatic choice: folded into `natives` rather than a separate `crates/compress`
// (AGENTS.md "no speculative abstraction" — one napi crate suffices; noted as a
// §3 deviation). A full headroom-style per-type compressor is Tier-1+; this ships
// the gate-justified primitives the TS compressors call into.

#[napi(object)]
pub struct CompressLogOptions {
  /// Truncate any line longer than this (default 200 chars).
  pub max_line_len: Option<u32>,
  /// Collapse runs of ≥ this many identical consecutive lines into a "... (N repeated)" marker (default 3).
  pub collapse_run: Option<u32>,
}

#[napi(object)]
pub struct CompressLogResult {
  /// The compressed text.
  pub text: String,
  /// Original line count.
  pub original_lines: u32,
  /// Compressed line count.
  pub compressed_lines: u32,
}

/// Content-aware log/tool-output compactor (headroom "Log" style).
/// - truncates long lines (keeps a head + ellipsis)
/// - collapses runs of identical consecutive lines into one + a count marker
/// Deterministic: identical input → identical output (byte-faithful, no RNG, no time).
#[napi]
pub fn compress_log(input: String, options: Option<CompressLogOptions>) -> Result<CompressLogResult> {
  guarded("compress_log", || {
    let max_line_len = options.as_ref().and_then(|o| o.max_line_len).unwrap_or(200) as usize;
    let collapse_run = options.as_ref().and_then(|o| o.collapse_run).unwrap_or(3) as usize;
    let lines: Vec<&str> = input.split('\n').collect();
    let original_lines = lines.len() as u32;
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
      let cur = lines[i];
      // measure run length of identical consecutive lines
      let mut run = 1;
      while i + run < lines.len() && lines[i + run] == cur {
        run += 1;
      }
      // truncate the line itself
      let truncated = if cur.len() > max_line_len {
        format!("{}…", &cur[..cur.floor_char_boundary(max_line_len)])
      } else {
        cur.to_string()
      };
      if run >= collapse_run {
        out.push(truncated);
        out.push(format!("… ({run} repeated)"));
      } else {
        for _ in 0..run {
          out.push(truncated.clone());
        }
      }
      i += run;
    }
    let text = out.join("\n");
    Ok(CompressLogResult {
      text,
      original_lines,
      compressed_lines: out.len() as u32,
    })
  })
}

/// Approximate token count (chars/4 heuristic — the standard rough estimate).
/// Deterministic. Used by the budget/prompt layers to estimate cost without a tokenizer dep.
#[napi]
pub fn approx_tokens(input: String) -> Result<u32> {
  guarded("approx_tokens", || {
    // char_indices counts Unicode scalar values; /4 is the common heuristic.
    Ok((input.chars().count() / 4) as u32)
  })
}

// ─── CoW overlay isolation (§10.1 IsoBackend) ───────────────────────────────
// Best-effort reflink (Linux FICLONE ioctl on btrfs/xfs-with-reflink, macOS
// clonefile via libc) with a byte-faithful copy fallback. This is a perf /
// disk-savings optimization — the CoW *isolation* guarantee is the file_copy
// semantics (a child writes never reach the parent's base until merge-back).
// Source: §10.1 worktree/CoW isolation lifecycle.

#[napi(object)]
pub struct ReflinkResult {
  /// "reflink" if the kernel did CoW; "copy" if it fell back to a full copy.
  pub method: String,
  /// Bytes cloned/copied (i64 — napi doesn't support u64 in objects).
  pub bytes: i64,
}

/// Linux FICLONE ioctl: clone a file's data extents CoW (btrfs/xfs-with-reflink).
const FICLONE: u64 = 0x40049409;

/// Attempt a copy-on-write clone of `src` → `dst`; fall back to a byte-faithful
/// copy when the filesystem doesn't support reflinks (ext4, tmpfs). Returns the
/// method used ("reflink" | "copy") + bytes. Never aborts (guarded).
#[napi]
pub fn reflink_or_copy(src: String, dst: String) -> Result<ReflinkResult> {
  guarded("reflink_or_copy", || {
    let meta = std::fs::metadata(&src)
      .map_err(|e| Error::new(Status::GenericFailure, format!("reflink: src stat: {e}")))?;
    let bytes = meta.len() as i64;
    // Try reflink on Linux first.
    let reflinked = try_ficlone(&src, &dst);
    if reflinked {
      return Ok(ReflinkResult { method: "reflink".to_string(), bytes });
    }
    // Fallback: byte-faithful copy.
    std::fs::copy(&src, &dst)
      .map_err(|e| Error::new(Status::GenericFailure, format!("reflink: copy fallback: {e}")))?;
    Ok(ReflinkResult { method: "copy".to_string(), bytes })
  })
}

/// Issue the FICLONE ioctl (Linux only). Returns false on any error / non-Linux.
fn try_ficlone(src: &str, dst: &str) -> bool {
  #[cfg(target_os = "linux")]
  {
    use std::os::unix::io::AsRawFd;
    let src_file = match std::fs::File::open(src) {
      Ok(f) => f,
      Err(_) => return false,
    };
    let dst_file = match std::fs::OpenOptions::new().write(true).create(true).truncate(true).open(dst) {
      Ok(f) => f,
      Err(_) => return false,
    };
    let src_fd = src_file.as_raw_fd() as i64;
    // SAFETY: FICLONE takes the source fd as the ioctl arg; dst is the ioctl target.
    // On any error we return false and fall back to a copy. napi guarded() wraps panics too.
    let rc = unsafe { libc::ioctl(dst_file.as_raw_fd(), FICLONE, src_fd) };
    rc == 0
  }
  #[cfg(not(target_os = "linux"))]
  {
    let _ = (src, dst);
    false
  }
}

// ─── time (determinism — sole monotonic source, invariant #10) ──────────────

static ANCHOR: OnceLock<Instant> = OnceLock::new();
/// Monotonic nanos since a process-local anchor (no epoch). The ONLY monotonic
/// source. TS core.time mirrors this; never call Instant elsewhere in Rust.
#[napi]
pub fn now_monotonic_nanos() -> u64 {
  let anchor = ANCHOR.get_or_init(Instant::now);
  anchor.elapsed().as_nanos() as u64
}

/// Wallclock nanos since UNIX_EPOCH — the ONLY wall source.
#[napi]
pub fn now_wallclock_nanos() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_nanos() as u64
}

// ─── ABI stamp ───────────────────────────────────────────────────────────────

/// ABI stamp — TS asserts this matches its expected natives semver before dlopen.
#[napi]
pub fn natives_version() -> String {
  env!("CARGO_PKG_VERSION").to_string()
}
