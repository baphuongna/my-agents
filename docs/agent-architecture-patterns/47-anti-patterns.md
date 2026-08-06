# Hướng AU: Anti-Patterns — những cái KHÔNG nên làm

> **Nguồn gốc:** agentpatternscatalog category "anti-patterns" (Hero Agent, Unbounded Subagent Spawn, ...)
> **Coupling:** — tài liệu thuần (no code)
> **Agent-agnostic:** — áp cho mọi hướng khác
> **Code sẵn:** — checklist dùng khi review kiến trúc
> **Effort:** 3-5 ngày (viết + gắn checklist)

## Nguồn gốc

agentpatternscatalog (GoF/POSA-style, 214 patterns) dành hẳn một category **anti-patterns**: mỗi failure mode được đặt tên, mô tả và đưa ra alternative đúng. Giá trị: đặt tên cho vấn đề = dễ phát hiện + dễ cấm trong code review. Bộ 53 hướng của mya sẽ nguy hiểm nếu không kèm "điều cấm" — pattern tốt nhưng dùng sai chỗ, quá nhiều cùng lúc, là cách nhanh nhất phá "minimal core".

## Mô tả

Đây là file *không phải pattern* — là checklist phủ lên mọi hướng khác. Khi thiết kế/select hướng, check anti-pattern nào bị kích hoạt. Nếu hơn 1-2 cái → thiết kế sai.

## Danh sách (chọn lọc theo bối cảnh mya)

| Anti-pattern | Triệu chứng | Thay bằng |
|---|---|---|
| **Hero Agent** | 1 agent làm hết mọi thứ, context phình | RR routing + role phân tán |
| **Unbounded Subagent Spawn** | Agent sinh subagent vô hạn (đệ quy) | SS step budget + VV max depth |
| **Infinite Debate** | Council/GAN vòng lặp không hội tụ | JJ maxRounds + PP threshold |
| **Same-Model Self-Critique** | 1 model tự review chính mình | JJ discriminator ≠ generator |
| **Tool Explosion** | Tool chồng tool, không ai kiểm soát | OO tool registry + permission |
| **Prompt Bloat** | Prompt stable tier phình vô hạn | MM compaction + skill L1/L2 |
| **Hidden Mode Switching** | Đổi model/agent ngầm, không ai biết | RR route decision audit |
| **Schema-Free Output** | Output không schema, parse tay | core byte-faithful JSON + types |
| **Unbounded Loop** | Agent lặp fix-fail không dừng | SS step budget + UU escalation |
| **Naive-RAG-First** | Gắn RAG vào mọi thứ không cần | MM memory chỉ khi thực sự cần |
| **Hallucinated Tools** | Gọi tool không tồn tại | OO registry: unknown tool → reject |
| **Tool Output Trusted Verbatim** | Tin kết quả tool 100% | PP eval + grounded checks |
| **Black-Box Opaqueness** | Không ai biết agent đang làm gì | K event ledger + audit |
| **Perma-Beta** | Thay đổi mãi không chốt | eval harness gác cổng (PP) |

## Cách dùng (checklist)

```markdown
## Review checklist — trước khi merge 1 hướng mới
- [ ] Không Hero Agent (có routing/role phân tán)?
- [ ] Mọi vòng lặp có bound (step/round budget)?
- [ ] Mọi review dùng model khác generator?
- [ ] Mọi tool đăng ký trong registry + có permission?
- [ ] Prompt/context có compaction policy?
- [ ] Mọi đổi agent/model được log + audit được?
- [ ] Output có schema + validate?
- [ ] Tool result không được tin verbatim (có ground/verify)?
- [ ] Không thêm hướng mới nếu chồng lấn > 2 hướng cũ (minimal core)?
```

## Được / Mất

| Được | Mất |
|---|---|
| ✅ Đặt tên vấn đề → dễ phát hiện sớm | ❌ Không có code (chỉ kỷ luật) |
| ✅ Bảo vệ minimal core (chống pattern creep) | ❌ Checklist dễ bị bỏ qua nếu không gắn review |
| ✅ Liên kết anti-pattern → hướng thay thế | |
| ✅ Đi kèm mọi hướng khác (không thay thế) | |

## Khi nào dùng

- **Luôn luôn**: đính kèm checklist vào quy trình review kiến trúc
- Khi thấy "thêm 1 hướng nữa" mà chồng lấn — file này là lý do dừng
- Khi debug vòng lặp kỳ lạ của agent — tra ngược bảng trên
