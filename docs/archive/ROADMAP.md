# ROADMAP.md — Kế hoạch hoàn thiện mya

> Cập nhật: 2026-07-14 (sau khi hoàn thành tất cả phases P0-P3 + close gaps)
> Trạng thái: Build ✅ | Tests 454 ✅ | Bundle ✅ 15MB | 29 packages
> Production-ready ✅ cho core use case (CLI/TUI/RPC/gateway)

## Tổng quan

```
Hoàn thành:  ~90%  (core production-grade, frontier optional)
Goal:        ✅ Đạt (production-ready cho personal coding agent)
Tests:       454 passing (từ 337 ban đầu, +117)
```

---

## P0 — Critical Wiring ✅ DONE

### P0-1: Wire hooks/council/extensionHost ✅
### P0-2: Port ls/find tools ✅

---

## P1 — Functional Gaps ✅ DONE

### P1-1: pi-ai 30+ provider bridge ✅
### P1-2: Test gaps ✅ (council/tts/web/desktop/dap-server/prompts — all have tests now)
### P1-3: Eval tiers ✅
### P1-4: Sync convergence ✅

---

## P2 — Feature Completion ✅ DONE

### P2-1: Desktop Tauri wiring ✅ (IPC commands + session list)
### P2-2: ACP external transport ✅ (real stdio JSON-RPC)
### P2-3: Web build pipeline ✅ (Vite + staticDir wired)
### P2-4: Invariant CI gates ✅ (core-size lint + cargo-deny + PR template)

---

## P3 — Frontier (partial)

### P3-4: Dream cycle ✅ DONE
### P3-5: Council multi-model ✅ DONE

### Remaining (optional frontier)
- [ ] P3-1: x402 real ECDSA (currently HMAC stub, documented Tier-3)
- [ ] P3-2: TTS MLX backend (hook registered, not implemented)
- [ ] P3-3: More channels (WhatsApp/Signal/Matrix/Line)

---

## Verification Gates

- [x] `npm run build` — 0 errors
- [x] `npx vitest run` — 454/454 pass
- [x] `node scripts/bundle.mjs` — bundle works
- [x] `mya "hello"` — real LLM responds
- [x] `npm run lint:core-size` — 1820/1870 lines OK
- [x] `npm run lint` — invariant #10 enforced
- [x] `npm run lint:deps` — invariant #19 enforced
- [x] CI: cargo deny check enforced
