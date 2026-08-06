# PLAN — Kế hoạch nghiên cứu các vòng tiếp theo (agent-architecture-patterns)

> Tự động sinh: 40 vòng (Vòng 52 → Vòng 91), 3 hướng/vòng → **120 file mới (228 → 347)**.
>
> **Quy ước chữ (bijective base-26):** file n dùng mã `toCode(n)` — A, B, ..., Z, AA, AB, ..., AZ, BA, ... Luôn duy nhất. (vd 1=A, 27=AA, 227=HS, 228=HT, 347=MI).
>
> **Cách chạy mỗi vòng:** 3× `web-search-prime` (query cột EN; timeout → retry query rút gọn; firecrawl fallback nếu lặp 2 lần fail) → viết `<n>-<slug>.md` theo chuẩn repo (Nguồn gốc, Coupling, Agent-agnostic, Code sẵn, Effort, kiến trúc, Được/Mất, bảng so sánh, khi nào chọn) → `sed` typo `Code sẵn` → cập nhật README (Nhóm mới, insert rows đúng text row cuối, mapping) → verify `grep -c '^| \[' README.md` == số file == target, typos == 0.

| # | Letter | File (slug) | Chủ đề nghiên cứu | Search query (web-search-prime) | Liên kết nội bộ |
|---|---|---|---|---|---|

### Vòng 52 — Distributed & Consensus

| 228 | HT | `228-raft-consensus-cluster.md` | Raft consensus — nhân bản trạng thái, leader election, majority quorum cho cluster agent | `"Raft consensus" leader election replicated state machine distributed agents 2026` | 13, 16 |
| 229 | HU | `229-distributed-locking.md` | Distributed locking — mutex/lease, tránh 2 agent đụng tài nguyên chung | `distributed lock lease mutex coordination multiple agents shared resources` | 13, 30 |
| 230 | HV | `230-event-sourcing-outbox.md` | Event sourcing + outbox — mọi thay đổi là event, replay để khôi phục trạng thái | `transactional outbox pattern event sourcing agent state replay rebuild` | 198, 66 |

### Vòng 53 — Task Reliability

| 231 | HW | `231-dead-letter-queue.md` | Dead-letter queue — tác vụ hỏng vào DLQ/quarantine thay vì retry đè mãi | `dead letter queue DLQ failed agent tasks poison message quarantine` | 203, 46 |
| 232 | HX | `232-actor-supervision.md` | Actor supervision — cây giám sát, restart strategy (1:1/1:N), crash isolation | `actor supervision restart strategy Erlang OTP resilient process tree` | 13, 111 |
| 233 | HY | `233-work-stealing.md` | Work stealing — scheduler cướp việc từ queue bận, cân bằng tải worker agent | `work stealing scheduler task queues load balancing parallel workers` | 178, 208 |

### Vòng 54 — Security Ops

| 234 | HZ | `234-secret-rotation.md` | Secret rotation — xoay vòng key, credential ngắn hạn, vault integration | `secret rotation vault short lived credentials API key lifecycle agents` | 106, 200 |
| 235 | IA | `235-output-moderation.md` | Output moderation — lọc toxicity/PII ngoài dòng cuối trước khi trả user | `LLM output content moderation filter toxic PII unsafe replies policy` | 214, 168 |
| 236 | IB | `236-behavior-anomaly.md` | Behavior anomaly — phát hiện hành vi agent lệch baseline (chỉ số người lạ) | `LLM agent behavior anomaly detection deviation baseline security monitoring` | 114, 200 |

### Vòng 55 — Uncertainty & World

| 237 | IC | `237-conformant-planning.md` | Conformant planning — lập kế hoạch bền vững dưới quan sát không đầy đủ | `conformant planning partial observability robust plan uncertainty` | 179, 215 |
| 238 | ID | `238-uncertainty-quantification.md` | Uncertainty quantification — calibration, confidence score, abstain khi mờ | `LLM uncertainty quantification confidence calibration abstain unsafe action` | 205, 36 |
| 239 | IE | `239-world-model.md` | World model — belief state, ước lượng môi trường, dự đoán hậu quả hành động | `world model belief state estimation environment simulation agent planning` | 135, 57 |

### Vòng 56 — Data & Privacy

| 240 | IF | `240-data-lineage.md` | Data lineage — truy vết nguồn dữ liệu → quyết định, attribution | `data lineage LLM outputs provenance training data attribution decisions` | 198, 219 |
| 241 | IG | `241-differential-privacy.md` | Differential privacy — nhiễu + budget riêng tư khi train/học từ dữ liệu user | `differential privacy LLM fine tuning agent memory noise budget` | 214, 146 |
| 242 | IH | `242-memory-rollback.md` | Memory rollback — snapshot/undo cho bộ nhớ agent khi sai | `agent memory rollback snapshot restore undo mistakes checkpoint` | 172, 151 |

### Vòng 57 — Ops & SLO

| 243 | II | `243-agent-slo-sli.md` | Agent SLO/SLI — định nghĩa mục tiêu chất lượng + error budget cho agent | `SLO SLI LLM agents service level objectives error budget latency` | 101, 143 |
| 244 | IJ | `244-incident-runbooks.md` | Incident runbook — playbook khắc phục tự động khi agent lỗi | `AI agent incident response runbook playbook remediation automation` | 46, 203 |
| 245 | IK | `245-capacity-planning.md` | Capacity planning — dự báo GPU/token, autoscale theo tải | `capacity planning LLM inference GPU tokens traffic forecast autoscale` | 109, 118 |

### Vòng 58 — Eval Advanced

| 246 | IL | `246-judge-calibration.md` | Judge calibration — hiệu chỉnh LLM-as-judge, đo bias/agreement | `LLM as judge calibration bias agreement self consistency metrics` | 78, 126 |
| 247 | IM | `247-differential-testing.md` | Differential testing — so sánh output nhiều phiên bản prompt/model | `differential testing LLM prompts versions compare outputs regression` | 134, 80 |
| 248 | IN | `248-success-criteria-engineering.md` | Success criteria engineering — thiết kế rubric/tiêu chí chấm cho agentic task | `success criteria rubric agentic benchmark task evaluation design` | 126, 159 |

### Vòng 59 — Time & Speed

| 249 | IO | `249-priority-scheduling.md` | Priority scheduling — queue ưu tiên, preemption, deadline SLA | `priority scheduling preemption deadlines agent tasks queue SLA` | 215, 203 |
| 250 | IP | `250-context-prefetching.md` | Context prefetching — nạp trước tool/context, warm cache giảm latency | `context prefetching tool preload warm cache latency optimization LLM` | 38, 44 |
| 251 | IQ | `251-time-aware-planning.md` | Time-aware planning — suy luận thời gian, lịch, deadline trong kế hoạch | `time aware planning agent deadlines calendars temporal reasoning schedule` | 215, 185 |

### Vòng 60 — User Experience

| 252 | IR | `252-command-palette.md` | Command palette — slash commands, phím tắt, discoverability | `command palette slash commands agent CLI UX discoverability` | 2, 16 |
| 253 | IS | `253-change-preview-diff.md` | Change preview/diff — xem diff trước khi apply, review rồi xác nhận | `change preview diff before apply agent modifications review` | 226, 124 |
| 254 | IT | `254-offline-first.md` | Offline-first — hàng đợi tác vụ, sync khi có mạng, chạy local trước | `offline first AI agent operation local queue sync reconnect edge` | 98, 117 |

### Vòng 61 — Emergence & Cooperation

| 255 | IU | `255-emergent-behavior-detection.md` | Emergent behavior — phát hiện hành vi nổi lên không lường trước ở hệ multi-agent | `emergent behavior multi agent systems detection monitoring unexpected` | 236, 100 |
| 256 | IV | `256-contract-net-protocol.md` | Contract-net — đấu thầu tác vụ giữa agent, chọn người nhận tốt nhất | `contract net protocol task allocation bidding multi agent negotiation` | 122, 189 |
| 257 | IW | `257-blast-radius-containment.md` | Blast radius — cô lập hậu quả lỗi trong phạm vi nhỏ (namespace/quota/side-effect) | `blast radius containment isolate agent failures namespace side effects` | 111, 56 |

### Vòng 62 — Model Security

| 258 | IX | `258-model-poisoning-detection.md` | Model poisoning — phát hiện backdoor/trigger trong model khi deploy | `LLM backdoor attack detection data poisoning trigger security` | 161, 200 |
| 259 | IY | `259-prompt-hardening.md` | Prompt hardening — gia cố prompt chống adversarial, defense-in-depth | `prompt hardening adversarial robustness defense in depth prompts` | 200, 167 |
| 260 | IZ | `260-tool-arg-injection.md` | Tool-arg injection — validate tham số tool (path, shell, url) tránh injection | `tool argument injection security LLM hallucinated parameters validate path shell` | 200, 204 |

### Vòng 63 — Ops at Scale

| 261 | JA | `261-multi-region-failover.md` | Multi-region failover — HA nhiều vùng, DR, failover người/người | `multi region failover LLM inference availability disaster recovery` | 111, 133 |
| 262 | JB | `262-compliance-automation.md` | Compliance automation — bằng chứng tuân thủ tự động (SOC2/GDPR) từ audit log | `AI compliance automation SOC2 GDPR audit reports evidence chain` | 198, 240 |
| 263 | JC | `263-collaborative-sessions.md` | Collaborative sessions — nhiều user chia sẻ 1 phiên agent realtime | `multi user shared agent session collaborative editing realtime` | 186, 87 |

### Vòng 64 — Cognition

| 264 | JD | `264-temporal-knowledge.md` | Temporal knowledge — fact gắn thời gian, KG thời gian cho trí nhớ | `temporal knowledge graph time aware facts LLM agent memory` | 103, 145 |
| 265 | JE | `265-hallucination-detection.md` | Hallucination detection — phát hiện claim sai, verify chéo trước khi trả | `hallucination detection LLM claims verification contradictions pipeline` | 219, 131 |
| 266 | JF | `266-runaway-loop-detection.md` | Runaway loop — phát hiện vòng lặp vô hạn/dao động retry, giới hạn hội tụ | `runaway feedback loop detection agent oscillation infinite retries guard` | 203, 114 |

### Vòng 65 — Novel Architectures

| 267 | JG | `267-neural-symbolic.md` | Neuro-symbolic — kết hợp LLM + logic/rules, suy luận kiểm chứng được | `neural symbolic reasoning LLM logic integration verifiable agents` | 179, 135 |
| 268 | JH | `268-petri-net-workflow.md` | Petri net — mô hình hóa workflow/concurrency/blocking trạng thái | `petri nets workflow modeling agents concurrency deadlock analysis` | 107, 183 |
| 269 | JI | `269-counterfactual-reasoning.md` | Counterfactual — suy luận "nếu không X thì sao" để quyết định an toàn hơn | `counterfactual reasoning LLM agents what if analysis planning` | 205, 239 |

### Vòng 66 — Performance

| 270 | JJ | `270-request-coalescing.md` | Request coalescing — gộp các lời gọi LLM trùng đang bay, de-dup in-flight | `request coalescing deduplicate concurrent LLM calls identical prompts` | 38, 44 |
| 271 | JK | `271-speculative-task-execution.md` | Speculative execution — chạy trước các nhánh tác vụ song song, hủy nhánh thừa | `speculative task execution parallel branches precompute risk agent` | 207, 208 |
| 272 | JL | `272-graceful-degradation.md` | Graceful degradation — xuống chế độ rút gọn khi quá tải/lỗi provider | `graceful degradation LLM features degraded mode under load fallback` | 111, 215 |

### Vòng 67 — Security & Trust

| 273 | JM | `273-signed-agent-actions.md` | Signed actions — ký số hành động agent, attestation, chống chối cãi | `signed agent actions cryptographic attestation verifiable audit non repudiation` | 198, 240 |
| 274 | JN | `274-containerized-tool-execution.md` | Containerized tools — chạy tool trong container, cô lập syscall/resource | `container isolation tool execution sandboxing syscalls resource limits` | 56, 200 |
| 275 | JO | `275-ssrf-via-tools.md` | SSRF prevention — chặn tool fetch nội bộ (169.254.0.0, metadata) | `SSRF prevention tool calls URL fetch restrict internal network metadata` | 260, 200 |

### Vòng 68 — Memory & Learning

| 276 | JP | `276-procedural-memory.md` | Procedural memory — lưu "cách làm" (skills/quy trình) tái dùng cho task mới | `procedural memory agent learn procedures skills long term reuse` | 145, 90 |
| 277 | JQ | `277-reasoning-memoization.md` | Reasoning memoization — cache kết quả suy luận trùng (dedup compute) | `memoization agent reasoning caching repeated computations dedup` | 38, 44 |
| 278 | JR | `278-after-action-review.md` | After-action review — rút kinh nghiệm sau mỗi task, cải tiến quy trình | `after action review agent post task retrospective improvements` | 86, 180 |

### Vòng 69 — Distributed State

| 279 | JS | `279-crdt-agent-state.md` | CRDT — trạng thái agent merge không xung đột trên nhiều node | `CRDT conflict free replicated data types agent shared state merge` | 30, 97 |
| 280 | JT | `280-optimistic-concurrency.md` | Optimistic concurrency — version hóa state, retry khi stale write | `optimistic concurrency versioned state agent retries stale write` | 30, 103 |
| 281 | JU | `281-tool-idempotency-keys.md` | Idempotency keys — key chống trùng lặp hiệu ứng khi retry tool call | `idempotency keys tool calls retry safe dedup API semantics` | 203, 229 |

### Vòng 70 — Data Security

| 282 | JV | `282-encrypted-memory-at-rest.md` | Encrypted memory — mã hóa bộ nhớ agent khi lưu (at-rest) | `encrypted agent memory at rest key management vault` | 214, 106 |
| 283 | JW | `283-data-classification.md` | Data classification — tự gắn nhãn nhạy cảm (PII/confidential) cho dữ liệu | `data classification automated tagging PII sensitivity LLM documents` | 214, 283 |
| 284 | JX | `284-data-minimization.md` | Data minimization — thiết kế prompt/chỉ lấy dữ liệu tối thiểu cần thiết | `data minimization principle prompt design collect only necessary LLM` | 214, 240 |

### Vòng 71 — Prompt Techniques

| 285 | JY | `285-step-back-prompting.md` | Step-back — hỏi khái niệm trừu tượng trước, rồi giải cụ thể | `step back prompting abstraction generalization LLM reasoning` | 135, 86 |
| 286 | JZ | `286-chain-of-verification.md` | Chain-of-Verification — sinh câu trả lời rồi tự kiểm tra sửa sai | `chain of verification LLM answer verify correct mistakes CoVe` | 219, 131 |
| 287 | KA | `287-program-aided-lm.md` | PAL — dùng code để tính (agent viết script tính thay vì suy luận số) | `program aided language models PAL code execution arithmetic reasoning` | 169, 90 |

### Vòng 72 — Tooling

| 288 | KB | `288-tool-polyfill-fallback.md` | Tool polyfill — giả lập tool thiếu bằng tool khác có khả năng tương đương | `tool fallback polyfill emulate missing capability alternative tool` | 192, 64 |
| 289 | KC | `289-tool-dry-run.md` | Tool dry-run — chạy thử mô phỏng không side-effect trước khi thật | `tool dry run simulation no side effects preview execute` | 226, 56 |
| 290 | KD | `290-tool-precondition-checks.md` | Precondition checks — kiểm tra điều kiện state trước khi gọi tool | `tool precondition checks validate state before call avoid failure` | 203, 192 |

### Vòng 73 — Multi-agent Ops

| 291 | KE | `291-cancel-propagation.md` | Cancel propagation — hủy tác vụ lan truyền xuống sub-agent đúng cách | `cancellation propagation multi agent tree abort context cleanup` | 46, 111 |
| 292 | KF | `292-agent-lifecycle-hooks.md` | Lifecycle hooks — sự kiện start/stop/migrate agent cho hệ thống quanh | `agent lifecycle hooks startup shutdown migrate events orchestration` | 81, 32 |
| 293 | KG | `293-hermetic-config.md` | Hermetic config — cấu hình agent khép kín, tái tạo được như cũ | `hermetic agent configuration reproducibility deterministic rebuild` | 62, 123 |

### Vòng 74 — Communication Contracts

| 294 | KH | `294-agent-message-contracts.md` | Message contracts — schema tin nhắn giữa agent, version hóa hợp đồng | `agent message contracts schema evolution versioning inter agent` | 202, 72 |
| 295 | KI | `295-agent-error-codes.md` | Error codes — taxonomy lỗi chung giữa các agent/tool | `agent error taxonomy codes interop fault diagnosis` | 203, 46 |
| 296 | KJ | `296-agent-diagnostics-cli.md` | Diagnostics CLI — lệnh chẩn đoán on-call (trace, state, memory, cost) | `agent diagnostics CLI troubleshooting trace state memory on call` | 101, 143 |

### Vòng 75 — Eval & QA

| 297 | KK | `297-golden-trace-replay.md` | Golden trace replay — chạy lại kịch bản vàng để đo hồi quy | `golden trace replay regression eval agent sessions deterministic` | 172, 126 |
| 298 | KL | `298-mock-llm-server.md` | Mock LLM server — giả lập model để test agent deterministic | `mock LLM API server replay deterministic testing agents offline` | 94, 55 |
| 299 | KM | `299-regression-gates-ci.md` | Regression gates — cổng chất lượng/chi phí trong CI agent | `quality regression gates CI CD agent latency cost threshold` | 12, 126 |

### Vòng 76 — Scheduling & Cost

| 300 | KN | `300-offpeak-batch-window.md` | Off-peak batch — chạy việc không gấp vào giờ rẻ, window giảm giá | `off peak batch window LLM discounted pricing background jobs` | 222, 215 |
| 301 | KO | `301-latency-budget-routing.md` | Latency-budget routing — chọn model theo ngân sách độ trễ của task | `latency budget aware routing model selection deadline SLA` | 76, 66 |
| 302 | KP | `302-inference-budget-arbitration.md` | Budget arbitration — phân bổ token/cost giữa các agent theo ưu tiên | `token budget arbitration multi agent priority cost allocation` | 191, 249 |

### Vòng 77 — Security Testing

| 303 | KQ | `303-redteam-automation.md` | Red-team automation — pipeline tự động tấn công prompt định kỳ | `automated red team pipeline LLM penetration testing periodic` | 167, 35 |
| 304 | KR | `304-prompt-fuzzing.md` | Prompt fuzzing — bơm input biến thể để tìm lỗ hổng | `prompt fuzzing adversarial input mutation LLM robustness` | 167, 134 |
| 305 | KS | `305-security-eval-suite.md` | Security eval suite — bộ benchmark bảo mật (jailbreak, injection, leak) | `LLM security benchmark suite jailbreak injection data leak evaluation` | 126, 167 |

### Vòng 78 — UX Advanced

| 306 | KT | `306-multi-window-views.md` | Multi-window — tách view chat/diff/status/đồ thị tác vụ | `split view terminal agent UI chat diff status graph` | 2, 143 |
| 307 | KU | `307-output-verbosity-adapt.md` | Verbosity adapt — tự chỉnh độ dài câu trả lời theo ngữ cảnh/user | `adaptive verbosity response length LLM user context preference` | 70, 84 |
| 308 | KV | `308-first-run-experience.md` | First-run — hướng dẫn khởi đầu, khám phá khả năng agent | `agent first run experience onboarding guided setup tutorial` | 32, 252 |

### Vòng 79 — Inference Ops

| 309 | KW | `309-autoscaling-llm.md` | Autoscaling — tín hiệu scale (queue depth, latency) cho inference | `autoscaling signals LLM inference queue depth latency scale` | 245, 118 |
| 310 | KX | `310-inference-slot-scheduler.md` | Slot scheduler — lịch chạy inference theo slot, tối ưu batch | `inference slot scheduler batching concurrency throughput planning` | 222, 270 |
| 311 | KY | `311-warm-pool-cache.md` | Warm pool — giữ model/tool ấm, giảm cold start | `warm pool model cache cold start latency serverless` | 138, 44 |

### Vòng 80 — Knowledge

| 312 | KZ | `312-knowledge-retention-policy.md` | Retention policy — hạn dùng kiến thức, tự xóa khi hết giá trị | `knowledge retention expiry policy agent memory lifecycle cleanup` | 146, 151 |
| 313 | LA | `313-incremental-kb-build.md` | Incremental KB — xây dựng tri thức dần từ phiên làm việc | `incremental knowledge base build agent sessions distill` | 150, 91 |
| 314 | LB | `314-knowledge-conflict-merge.md` | Knowledge merge — hợp nhất fact mâu thuẫn từ nhiều nguồn | `knowledge conflict resolution merge contradictory facts sources` | 30, 103 |

### Vòng 81 — Coordination

| 315 | LC | `315-plan-merge-agents.md` | Plan merge — hợp nhất kế hoạch từ nhiều agent con | `merge plans multi agent coordination subplans constraints` | 129, 173 |
| 316 | LD | `316-resource-negotiation.md` | Resource negotiation — mặc cả tài nguyên chung giữa agent | `resource negotiation agents shared capacity fairness bidding` | 122, 189 |
| 317 | LE | `317-cross-agent-txn.md` | Cross-agent transaction — giao dịch trải nhiều agent, rollback toàn bộ | `distributed transaction across agents rollback compensation` | 130, 188 |

### Vòng 82 — Observability Deep

| 318 | LF | `318-token-trace-visual.md` | Token trace — xem chi tiết token/step cho debugging | `token level tracing LLM step visualization debug agent` | 101, 143 |
| 319 | LG | `319-latency-breakdown.md` | Latency breakdown — phân tích độ trễ từng giai đoạn (prompt→tool→model) | `latency breakdown analysis stages LLM tool model attribution` | 143, 101 |
| 320 | LH | `320-cost-per-step.md` | Cost per step — gán chi phí cho từng bước agent, tìm nút chôn tiền | `cost per step trace attribution LLM agent finops optimization` | 191, 118 |

### Vòng 83 — Testing Reliability

| 321 | LI | `321-flaky-test-stabilization.md` | Flaky tests — ổn định test agent hay fail ngẫu nhiên | `flaky test stabilization agent tests retry quarantine flakiness` | 46, 134 |
| 322 | LJ | `322-chaos-agents.md` | Chaos experiments — tiêm lỗi (tool chết, model chậm) đo khả năng chịu lỗi | `chaos engineering LLM agents fault injection tool failure latency` | 47, 111 |
| 323 | LK | `323-load-testing-agents.md` | Load testing — ép tải agent workload, tìm ngưỡng | `load testing agent workloads concurrency throughput saturation` | 55, 126 |

### Vòng 84 — Model Updates

| 324 | LL | `324-model-upgrade-rollout.md` | Model upgrade rollout — nâng cấp model an toàn (canary + đo hồi quy) | `model upgrade rollout canary regression evaluation safe` | 71, 42 |
| 325 | LM | `325-model-retirement.md` | Model retirement — ngừng model cũ đúng quy trình, migrate output | `model deprecation retirement plan migrate prompts outputs` | 71, 66 |
| 326 | LN | `326-embedding-model-switch.md` | Embedding switch — đổi model embedding không vỡ index cũ | `switch embedding models vector index migration recompute` | 60, 213 |

### Vòng 85 — Agent Interaction

| 327 | LO | `327-interruptible-agents.md` | Interruptible — user ngắt giữa chừng, agent dừng sạch và đổi hướng | `interruptible agent user interrupt mid task clean stop redirect` | 132, 215 |
| 328 | LP | `328-deferred-questions.md` | Deferred questions — gom câu hỏi chờ trả lời sau (không chặn task) | `deferred questions queue LLM agent ask later non blocking` | 132, 227 |
| 329 | LQ | `329-quick-action-shortcuts.md` | Quick actions — hành động nhanh định sẵn (retry, fix, resume) | `quick action shortcuts agent resume retry fix one command` | 2, 252 |

### Vòng 86 — Safety

| 330 | LR | `330-safety-case-evidence.md` | Safety case — hồ sơ bằng chứng an toàn của agent, xem xét định kỳ | `safety case LLM agent evidence argument assurance` | 198, 273 |
| 331 | LS | `331-escalation-timeouts.md` | Escalation timeouts — chốt cứng thời gian chờ trước khi leo cấp | `escalation timeout hard deadline human intervention fallback` | 46, 215 |
| 332 | LT | `332-runtime-policy-enforcement.md` | Runtime policy — thực thi chính sách tại runtime (không chỉ config) | `runtime policy enforcement agent behavior guardrails dynamic` | 16, 168 |

### Vòng 87 — Data Ops

| 333 | LU | `333-data-versioning.md` | Data versioning — quản lý phiên bản dataset cho eval/train | `dataset versioning lineage reproducibility eval training` | 66, 71 |
| 334 | LV | `334-synthetic-data-quality.md` | Synthetic quality — đo chất lượng dữ liệu tổng hợp trước khi dùng | `synthetic data quality validation bias coverage LLM eval` | 54, 126 |
| 335 | LW | `335-feedback-flywheel.md` | Feedback flywheel — vòng thu phản hồi user → cải thiện agent | `user feedback loop LLM agent improvement flywheel corrections` | 92, 180 |

### Vòng 88 — Tool Ecosystem

| 336 | LX | `336-tool-discovery-gateway.md` | Discovery gateway — khám phá tool runtime từ nhiều nguồn, 1 cửa | `tool discovery gateway runtime registry multiple sources unified` | 64, 110 |
| 337 | LY | `337-context-tool-reco.md` | Context-aware tool suggestion — gợi ý tool theo ngữ cảnh hiện tại | `context aware tool recommendation suggestion current task LLM` | 64, 75 |
| 338 | LZ | `338-tool-usage-insights.md` | Usage insights — khai thác pattern dùng tool để tinh chỉnh | `tool usage patterns mining insights optimization agent telemetry` | 143, 101 |

### Vòng 89 — Comm Protocols

| 339 | MA | `339-agent-middleware.md` | Messaging middleware — lớp giữa agent (validate, route, transform) | `agent messaging middleware interceptor routing transform validation` | 13, 202 |
| 340 | MB | `340-event-schema-registry.md` | Event schema registry — đăng ký/chia sẻ schema event giữa agent | `event schema registry shared contracts versioning publish subscribe` | 13, 101 |
| 341 | MC | `341-async-req-reply.md` | Async request-reply — mẫu gọi bất đồng bộ có correlation id | `async request reply pattern correlation id callback polling agents` | 13, 12 |

### Vòng 90 — Output Quality

| 342 | MD | `342-output-quality-pipeline.md` | Quality pipeline — cổng chất lượng cuối (grounding, độ dài, style) | `output quality pipeline gates grounding length style verification` | 219, 168 |
| 343 | ME | `343-answer-relevance-score.md` | Relevance scoring — chấm mức liên quan câu trả lời với câu hỏi | `answer relevance score metric LLM evaluation faithfulness` | 219, 78 |
| 344 | MF | `344-citation-health-check.md` | Citation health — kiểm tra citation còn sống, đúng chỗ | `citation validity health check links references LLM answer` | 219, 240 |

### Vòng 91 — Synthesis

| 345 | MG | `345-adaptive-goal-priorities.md` | Adaptive priorities — sắp xếp lại mục tiêu theo ngữ cảnh thay đổi | `dynamic goal prioritization replanning changing context agent` | 104, 249 |
| 346 | MH | `346-slow-fast-reasoning.md` | Slow/fast reasoning — 2 tầng suy luận: nhanh cho việc thường, chậm cho khó | `dual system fast slow reasoning LLM tiered deliberation` | 135, 86 |
| 347 | MI | `347-privacy-budget-agent.md` | Privacy budget — theo dõi ngân sách riêng tư khi agent xử lý dữ liệu | `privacy budget tracking agent data processing consent limits` | 241, 214 |

## Ghi chú
- Nếu cần thêm vòng sau 347: tiếp tục công thức letter, chủ đề mới tương tự (tránh trùng 347 slug hiện có — grep trước khi chốt).
- Ưu tiên độc lập: mỗi vòng đứng riêng được, không phụ thuộc vòng trước — chạy theo thứ tự nào cũng được.
- Một số chủ đề gần hướng cũ nhưng đủ khác: 232 (supervision ≠ 13 actor), 271 (speculative *task* ≠ 207 speculative *decoding*), 281 (idempotency ≠ 203 retry), 302 (arbitration ≠ 191 attribution).
---

## PHẦN B — Hướng bổ sung từ khảo sát nguồn `source/` (pull 2026-08-06)

> Đã pull 40+ repo trong `my-agent/source/` và đối chiếu với 227 pattern + Phần A.
> Quy ước letter tiếp tục `toCode(n)`. Đây là 55-56 hướng KHÔNG trùng — dành làm thêm sau Phần A.
> Khi nghiên cứu, dùng `web-search-prime` (query, timeout→rút gọn / firecrawl fallback) như Phần A.

### B1 — Code & Memory (11)

| # | Letter | File (slug) | Nguồn | Ý chính (tránh trùng) |
|---|---|---|---|---|
| 348 | MJ | `348-ast-code-knowledge-graph.md` | graphify, codebase-memory-mcp | Đồ thị tri thức mã nguồn 0-LLM từ tree-sitter/TS-LSP; query thay vì grep (khác tool-orchestration-graph = graph tool CALL) |
| 349 | MK | `349-synthesis-with-gap-analysis.md` | gbrain | Lớp tổng hợp trả lời có citation + nêu 'brain chưa biết/stale/mâu thuẫn' (khác error-analysis) |
| 350 | ML | `350-agent-session-history-indexing.md` | ctx | Index transcript 30+ harness về SQLite local, tìm kiếm có citation, tiết kiệm ~50x token so với grep raw |
| 351 | MM | `351-append-only-memory-accumulation.md` | mem0 | Memory bất biến ADD-only không ghi đè/xóa, facts tích lũy + entity linking + temporal reasoning |
| 352 | MN | `352-memory-confidence-scoring.md` | agentmemory | Điểm tin cậy + vòng đời (Karpathy LLM-wiki) cho từng memory entry |
| 353 | MO | `353-memory-state-versioning.md` | agentmemory | Git-snapshot toàn bộ memory state (rollback/diff) |
| 354 | MP | `354-attention-based-memory-decay.md` | agentmemory | Decay theo đường cong Ebbinghaus, truy cập nhiều mạnh lên, evict theo importance |
| 355 | MQ | `355-memory-provenance-traceability.md` | agentmemory | Mỗi memory trace ngược về observation/source ban đầu (chiều mới ≠ grounding/audit) |
| 356 | MR | `356-time-aware-memory-retrieval.md` | mem0 | Xếp hạng retrieval theo thì (hiện tại/quá khứ/tương lai) — khác temporal-knowledge chỉ là edge |
| 357 | MS | `357-entity-trajectory-scoring.md` | gbrain | Theo dõi claims có thời gian của entity (mrr, mốc, event) auto-flag regression/red flag |
| 358 | MT | `358-execution-trace-world-modeling.md` | papers WorldCoder | Agent viết code để build world-model/simulator môi trường |

### B2 — Context & Token (9)

| # | Letter | File (slug) | Nguồn | Ý chính (tránh trùng) |
|---|---|---|---|---|
| 359 | MU | `359-content-type-aware-compression.md` | headroom | Router chọn compressor theo loại nội dung (JSON-crusher/AST/LLM prose) thay policy chung |
| 360 | MV | `360-model-output-token-shaping.md` | headroom | Giảm token model VIẾT RA: verbosity steering + effort routing + đo savings CI |
| 361 | MW | `361-cache-prefix-preserving-compression.md` | headroom | CacheAligner giữ KV-cache prefix khi nén, không phá cache hit của provider |
| 362 | MX | `362-event-sourced-session-continuity.md` | context-mode, pi-vcc | Index mọi event (edit/git/decision) FTS5, compact không mất data, trả đúng phần liên quan |
| 363 | MY | `363-programmatic-context-mining.md` | context-mode | Think-in-code: sandbox chạy script chỉ lấy stdout (1 script thay 47 Reads) |
| 364 | MZ | `364-fetch-index-then-search.md` | context-mode | Fetch→index→search, raw HTML không vào context, chặn curl/wget/WebFetch |
| 365 | NA | `365-deterministic-command-reducers.md` | rtk, hypa | Reducer per-lệnh (git/npm/docker) giảm ~90% token, có analytics dashboard |
| 366 | NB | `366-seamless-compaction-continuity.md` | leaks+Codex | Compact→continue tự nhiên 'time never runs out', không làm lại việc đã xong |
| 367 | NC | `367-designated-scratchpad.md` | leaks | Thư mục scratch riêng agent tùy ý, không cần xác nhận gọi, thay /tmp mặc định |

### B3 — Editing & Workflow (13)

| # | Letter | File (slug) | Nguồn | Ý chính (tránh trùng) |
|---|---|---|---|---|
| 368 | ND | `368-hash-anchored-editing.md` | pi-hashline-edit-pro | Địa chỉ dòng bằng content-hash (62-symbol perfect), stale anchor → E_STALE_ANCHOR fail-closed |
| 369 | NE | `369-mandatory-undo-precondition.md` | pi-hashline-edit-pro | Undo record persisted TRƯỚC khi ghi, không undo được thì từ chối (fail-closed) |
| 370 | NF | `370-read-tracked-edit-guard.md` | pi-lens | Theo dõi mọi nguồn đọc (read/bash/grep/LSP) để chặn edit vùng chưa đọc, autopatch oldText |
| 371 | NG | `371-impact-cascade-diagnostics.md` | pi-lens | Sau edit chạy LSP/linters trên dependents qua reverse-deps graph (BFS depth-bound) |
| 372 | NH | `372-diagnostic-triage-dispositions.md` | pi-lens | Mark false-positive/suppress/defer/flag, content-anchored, feed rule tuning |
| 373 | NI | `373-plan-as-branch-workflow.md` | pi-soly | Plan = git branch (.agents/plans/slug/PLAN.md) → scaffold/execute/verify/PR; STATE.md mỗi turn |
| 374 | NJ | `374-conditional-rule-loading.md` | pi-soly | Rules markdown frontmatter glob-scope; block MANDATORY token-budgeted; built-in ưu tiên cao nhất |
| 375 | NK | `375-differential-workflow-resume.md` | pi-dynamic-workflows | Resume run cũ sau khi sửa script: agent() không đổi replay từ journal, chỉ re-run phần edit |
| 376 | NL | `376-model-tier-routing.md` | pi-dynamic-workflows | Routing task→model theo tier small/medium/big (rõ hơn dynamic-model-routing) |
| 377 | NM | `377-tool-execution-order-preservation.md` | pi-core-agent | Tool chạy parallel nhưng persist theo thứ tự gọi nguồn (completion ≠ source order) |
| 378 | NN | `378-single-writer-session-lease.md` | pi-mobile | Một-writer/session JSONL: web giữ runtime, Release bàn giao CLI an toàn |
| 379 | NO | `379-workflow-keyword-triggering.md` | pi-dynamic-workflows | Keyword ('workflow') arm orchestrate mode nhưng không ép phải theo lệnh |
| 380 | NP | `380-context-filesystem-abstraction.md` | OpenViking | Memory/resource/skill là virtual FS (viking://), agent dùng ls/tree/find thay vì truy vấn store |

### B4 — Multi-agent & Platform (10)

| # | Letter | File (slug) | Nguồn | Ý chính (tránh trùng) |
|---|---|---|---|---|
| 381 | NQ | `381-inter-session-message-broker.md` | pi-intercom | Broker 1:1 session↔session local, ask/reply timeout 10ph, mailbox, reply hints |
| 382 | NR | `382-structured-escalation-protocol.md` | pi-intercom | Taxonomy 3 reason subagent→supervisor: need_decision / interview_request / progress_update |
| 383 | NS | `383-omnichannel-agent-gateway.md` | openlclaw | 1 agent, ~22 kênh chat (WhatsApp/Telegram/Zalo/Signal/iMessage), transport-agnostic |
| 384 | NT | `384-agent-daemon-lifecycle.md` | theo openclaw | Agent như daemon OS (launchd/systemd always-on), onboarding wizard |
| 385 | NU | `385-meeting-presence-agents.md` | openhuman | Agent tham dự Meet/Zoom/Teams có mặt + giọng nói, transcript + action items |
| 386 | NV | `386-privacy-mode-enforcement.md` | openhuman | 1 switch: không inference rời máy, enforced ở core (≠ pii-redaction) |
| 387 | NW | `387-agent-blocked-signaling.md` | herdr | Pane trạng thái working/blocked/idle, báo khi agent kẹt cần người |
| 388 | NX | `388-skill-lifecycle-curation.md` | hermes-agent | Curator nền theo usage → stale → archive (không xóa); quản skill tự sinh |
| 389 | NY | `389-agent-environment-hibernation.md` | hermes-agent | Thuê bao sleep khi idle, wake-on-demand (chi tiết hóa serverless) |
| 390 | NZ | `390-low-cost-agent-triggers.md` | MyAgents | Watcher lệnh rẻ, chỉ wake AI khi trúng điều kiện |

### B5 — UI · Auth · Trust & Research (12)

| # | Letter | File (slug) | Nguồn | Ý chính (tránh trùng) |
|---|---|---|---|---|
| 391 | OA | `391-biometric-agent-gate.md` | pi-mobile | WebAuthn Face ID/Touch ID làm cổng truy cập agent từ xa |
| 392 | OB | `392-trust-scoped-context-blocks.md` | leaks (Gemini/Claude) | Gắn nhãn tin cậy từng block; Capabilities không được dùng làm lệnh; reminder/untrusted title |
| 393 | OC | `393-dual-channel-agent-communication.md` | leaks (Codex) | Kênh commentary (ngắn) vs final (self-contained), link clickable |
| 394 | OD | `394-safeguard-model-tiering.md` | leaks (Anthropic) | Cùng weights 2 tier safety + routing, agent giải thích vì sao bị route |
| 395 | OE | `395-minimal-code-ladder.md` | ponytail | Thang 7 bậc reuse-before-write; giữ 100% safety; -54% LOC |
| 396 | OF | `396-repository-graph-planning.md` | papers CodePlan/RPG | Planning trên đồ thị repo thay vì file-by-file |
| 397 | OG | `397-adaptive-topology-search.md` | papers BOAD/SEW | Tìm topology multi-agent bằng bandit (khác agent-topology tĩnh) |
| 398 | OH | `398-test-gated-convergence.md` | papers RLTF/BOAD | Cửa dừng multi-agent theo test pass (điểm hội tụ correctness) |
| 399 | OI | `399-rl-from-execution-feedback.md` | papers RLTF | RL từ compiler/test/fuzzer feedback (≠ process-reward chuỗi suy luận) |
| 400 | OJ | `400-harness-as-distillation-surface.md` | papers Composer | Dùng trajectory harness thực làm bề mặt distill + RL real-time cho model code |
| 401 | OK | `401-observability-driven-harness.md` | papers Meta-Harness | Harness tự tiến hóa dựa trên observability |
| 402 | OL | `402-request-type-authorization.md` | leaks (Codex) | Autonomy matrix: answer/diagnose/change/monitor; destructive-action protocol |

## Ghi chú Phần B
- Tổng 55 hướng, số tiếp theo từ `403` (`OM`) nếu thêm.
- Các slug gần hướng cũ nhưng khác bản chất đã ghi chú ở cột 'Tránh trùng'.