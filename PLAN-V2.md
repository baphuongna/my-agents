# PLAN-V2.md — Kế hoạch hoàn thiện mya (đợt 2)

> Cập nhật: 2026-07-12 (sau audit toàn diện)
> Trạng thái: Build ✅ | Tests 255 ✅ | Bundle ✅ | 29 packages wired
> PLAN-FULL.md (đợt 1, Phase 1-9) = ĐÃ HOÀN THÀNH

## Còn thiếu (từ audit tỉ mỉ)

### P0 — Sửa nhanh (S effort)

| # | Task | File | Effort |
|---|---|---|---|
| A1 | Sửa README — xóa packages không tồn tại, thêm slash commands | README.md | S |
| A2 | Council — wire với mock members (1 provider) | pi-main.ts | S |
| A3 | Collab snapshot ring buffer | collab/src/relay.ts | S |
| A4 | Move desktop-ui/index.html → desktop-shell/ui/ | crates/ | S |

### P1 — Thiết thực (M effort)

| # | Task | File | Effort |
|---|---|---|---|
| B1 | Tests: ai/openai.ts adapter | packages/ai/ | M |
| B2 | Tests: rpc JSON-RPC framing | packages/rpc/ | M |
| B3 | Tests: sync HLC convergence | packages/sync/ | M |
| B4 | Tests: acp permission relay | packages/acp/ | M |
| B5 | Tests: gateway mcp-client | packages/gateway/ | M |
| B6 | Tests: mya-bridge slash commands | packages/print/ | M |
| B7 | Tests: workflows runner | packages/workflows/ | M |

### P2 — Frontier (L effort)

| # | Task | File | Effort |
|---|---|---|---|
| C1 | ACP subagent transport (thay protocol-mismatch stub) | agent/subagents/ | L |
| C2 | TTS MLX backend wiring | packages/tts/ | L |
| C3 | Desktop contracts wired vào Tauri runtime | crates/desktop-shell/ | L |
| C4 | x402 real ECDSA crypto | packages/x402/ | L |

## Thực thi

### Batch A: P0 Quick fixes (tất cả S)
```
A1 (README) → A2 (council) → A3 (collab snapshot) → A4 (desktop-ui move)
```

### Batch B: P1 Tests (tất cả M, song song được)
```
B1 (ai) | B2 (rpc) | B3 (sync) | B4 (acp) | B5 (mcp) | B6 (bridge) | B7 (workflows)
```

### Batch C: P2 Frontier (tuần tự, mỗi cái L)
```
C1 (ACP transport) → C2 (TTS MLX) → C3 (desktop wire) → C4 (x402 crypto)
```
