//! Rhai script engine (§25 / Gap 4) — sandboxed script evaluation via Rust.
//!
//! Rust-gate justification (§2):
//!   Trust boundary (a): untrusted script sandbox — Rhai has no I/O by default.
//!   Determinism (c): same script → same AST → same output (no GC nondeterminism).

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rhai::{Dynamic, Engine, Scope};
use serde_json::Value;

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

/// Convert a Rhai Dynamic to a serde_json::Value.
/// Uses Rhai's serde Serialize impl (enabled via the `serde` feature).
fn dynamic_to_json(val: Dynamic) -> Value {
  match serde_json::to_value(&val) {
    Ok(v) => v,
    Err(_) => Value::String(val.to_string()),
  }
}

/// Evaluate a Rhai script with a sandboxed context.
///
/// Registered safe functions: `log(level, msg)`, `emit_event(kind, payload)`.
/// Collected events are returned alongside the script's value.
/// No file/network access — Rhai is sandboxed by default.
///
/// Limits: max_expr_depths(64,64), max_call_levels(64), max_string_size(1M),
///         max_array_size(10K), max_map_size(10K).
#[napi]
pub fn eval_rhai(script: String, context: serde_json::Value) -> Result<serde_json::Value> {
  let result = catch_unwind(AssertUnwindSafe(|| -> std::result::Result<Value, String> {
    let mut engine = Engine::new();

    // Set safety limits.
    engine.set_max_expr_depths(64, 64);
    engine.set_max_call_levels(64);
    engine.set_max_string_size(1_000_000);
    engine.set_max_array_size(10_000);
    engine.set_max_map_size(10_000);

    // Collect events via a shared vector.
    let events: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));

    let log_events = events.clone();
    engine.register_fn("log", move |level: String, msg: String| {
      let evt = serde_json::json!({ "kind": "log", "level": level, "message": msg });
      if let Ok(mut ev) = log_events.lock() {
        ev.push(evt);
      }
    });

    let emit_events = events.clone();
    engine.register_fn("emit_event", move |kind: String, payload: String| {
      let parsed: Value =
        serde_json::from_str(&payload).unwrap_or(Value::String(payload.clone()));
      let evt = serde_json::json!({ "kind": kind, "payload": parsed });
      if let Ok(mut ev) = emit_events.lock() {
        ev.push(evt);
      }
    });

    // Inject context variables into the scope.
    let mut scope = Scope::new();
    if let Some(obj) = context.as_object() {
      for (key, val) in obj {
        match val {
          Value::String(s) => {
            scope.push(key.as_str(), s.clone());
          }
          Value::Number(n) => {
            if let Some(i) = n.as_i64() {
              scope.push(key.as_str(), i);
            } else if let Some(f) = n.as_f64() {
              scope.push(key.as_str(), f);
            }
          }
          Value::Bool(b) => {
            scope.push(key.as_str(), *b);
          }
          _ => {}
        }
      }
    }

    // Evaluate.
    let result = engine
      .eval_with_scope::<Dynamic>(&mut scope, &script)
      .map_err(|e| format!("rhai eval error: {e}"))?;

    // Convert Dynamic → JSON value.
    let value = dynamic_to_json(result);

    // Build result object: { value, events }
    let ev_vec = events
      .lock()
      .map_err(|e| format!("lock error: {e}"))?;
    Ok(serde_json::json!({ "value": value, "events": ev_vec.clone() }))
  }));

  match result {
    Ok(r) => r.map_err(|e| Error::new(Status::GenericFailure, e)),
    Err(p) => Err(Error::new(
      Status::GenericFailure,
      format!("eval_rhai: {}", panic_msg(p)),
    )),
  }
}
