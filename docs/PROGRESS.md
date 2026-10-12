# ContextCaps — Progress Tracker

Status:

```text
[ ] TODO
[~] IN PROGRESS
[x] DONE
[!] BLOCKED
```

Keep this file short and current.

## M0 — Freeze Shared Contracts

```text
[~] M0-01 TaskMandate schema          ┐ transcribed verbatim into packages/shared-types (P2);
[~] M0-02 ContextCapability schema     │ awaiting P1/P3 sign-off to mark frozen
[~] M0-03 ContextRequest schema        │
[~] M0-04 DisclosureDecision schema    │
[~] M0-05 DisclosureReceipt schema     │
[~] M0-06 reason codes                 ┘
[~] M0-07 Broker endpoints             payloads in shared-types/src/broker-api.ts, see 01 §9.1
[ ] M0-08 contract events
```

**Owner:** Shared  
**Exit:** `01_ARCHITECTURE_AND_CONTRACTS.md` frozen for implementation pass 1.

## M1 — Independent Skeletons

### Person 1

```text
[x] P1-01 CapabilityRegistry skeleton   lifecycle + delegation + receipt anchors
[x] P1-02 contract tests running        actual bytecode on local EVM
[x] P1-03 local deployment              ephemeral local EVM deployments in tests
[x] P1-04 SDK skeleton                  @contextcaps/contract-sdk
```

### Person 2

```text
[x] P2-01 Broker server              services/broker (Fastify, npm run start:broker → :8787)
[x] P2-02 seeded vault               services/vault (derive/select/tool-secret only; no raw getter)
[x] P2-03 ContextRequest endpoint
[x] P2-04 policy engine              packages/policy (pure, deterministic)
```

### Person 3

```text
[ ] P3-01 Web app skeleton
[ ] P3-02 authorization screen
[ ] P3-03 activity UI
[ ] P3-04 mock API integration
```

**Exit:** all three domains run independently.

## M2 — Core Security Flow

### Person 1

```text
[x] register   local EVM verified
[x] query      local EVM verified
[x] revoke     local EVM verified, including descendants
[x] expiry     local EVM verified at exact boundary
```

### Person 2

```text
[x] DENY passport.raw
[x] DERIVE passport.validity
[x] DENY calendar.raw
[x] DERIVE calendar.availability
[x] DENY salary.raw
```

### Person 3

```text
[ ] BLOCKED state
[ ] DERIVED state
[ ] capability state
```

**Exit:** raw passport blocked and derived validity succeeds end-to-end.

## M3 — First Real Integration

```text
[ ] Web → Broker
[x] Broker → Contract SDK      wired; conformance + golden flow on real local EVM
[x] SDK → Monad               deployed registry; live root/child reads verified on chain 10143
[ ] Broker result → Web
[ ] Revoke from Web
[x] Revoke reflected in Broker  live Monad golden-flow: root and hotel-agent retries denied
```

**Coordinator:** Person 3

**Exit:** real Monad capability can be revoked and the next Broker request fails.

## M4 — Advanced Golden Flow

```text
[x] SELECT hotel preferences
[x] create Hotel Agent child capability
[x] reject invalid delegation
[x] TOOL_BOUND checkout
[x] booking mock succeeds
[x] disclosure receipts available   (live Monad demo completed; 13 audit receipts)
```

## M5 — Attack Scenario

```text
[x] malicious instruction seeded    services/agent/src/environment.ts
[x] agent requests salary
[x] Broker denies OUT_OF_SCOPE
[ ] UI clearly shows trust moment
[x] receipt generated
```

## M6 — Demo Stabilization

```text
[~] full demo works after clean reset   broker: npm run demo:reset && npm run demo:golden-flow (repeatable, real HTTP); UI pending
[x] raw passport absent from LLM logs   (asserted in tests/broker, incl. everything sent to the LLM provider)
[x] payment token absent from LLM logs  (asserted in tests/broker)
[~] no private values on-chain          anchored payloads asserted id/hash-only (mock); re-check on Monad
[~] critical tests pass                 P1/P2 local tests + typecheck clean; live Monad/P3 pending
[x] demo reset command works            npm run demo:reset / demo:seed (DEMO_MODE=true)
[ ] explorer links work
[ ] failure reasons are human-readable
```

## M7 — Submission

```text
[ ] README
[ ] architecture diagram
[ ] demo video
[ ] deployed app
[ ] clean repo
[x] .env.example                    (broker + LLM planner vars)
[ ] setup tested by another teammate
[ ] final pitch
[ ] submission form
```

## Current Blockers

| ID | Owner | Blocker | Depends On | Status |
|---|---|---|---|---|
| B-01 | P2 | Real Monad provider not wired | P1 SDK | Closed — SDK wired and tested on local EVM |
| B-02 | P1/P3 | Who signs registerCapability / revokeCapability on Monad (broker relayer key vs user wallet)? Broker supports both: it re-reads chain state on every request | Team decision | Open |
| B-03 | P1 | String IDs → bytes32 mapping | P1 | Closed — SDK uses keccak256(UTF-8); canonical parent IDs recoverable after restart |
| B-04 | P1/P3 | Principal endpoints (`/mandates`, `/revoke`) are unauthenticated in MVP; agent endpoints are session-bound. Wallet-signature auth for principals is future work | Team decision | Open (known limitation) |
| B-05 | P2 | LLM planner not exercised against the live API in this environment (no credentials); request shape unit-tested, fake-provider tests L01–L06 pass | ANTHROPIC_API_KEY + LLM_PLANNER=anthropic | Open — run one live smoke before demo |

## Shared Decisions

| Date | Decision | Affects |
|---|---|---|
| TBD | Travel-agent golden path is the MVP | All |
| TBD | LLM is never authorization authority | P2/P3 |
| TBD | Raw private data stays off-chain | All |
| TBD | Modes are DENY / DERIVE / SELECT / TOOL_BOUND | All |
| 2026-10-12 | Raw resource in an in-scope family → RAW_DISCLOSURE_FORBIDDEN; otherwise OUT_OF_SCOPE (01 §9.1) | P2/P3 |
| 2026-10-12 | `calendar.availability` + operation `available_window` (not a separate resource) | P2/P3 |
| 2026-10-12 | Child purpose must equal parent purpose; parent revocation cascades to children | All |
| 2026-10-12 | Agent identity comes from broker-issued sessions (`x-contextcaps-session`), never from request bodies | P2/P3 |
| 2026-10-12 | New reason code `DERIVATION_QUOTA_EXCEEDED` (passport.validity 5, calendar.availability 10 distinct queries / capability) | P2/P3 |
| 2026-10-12 | Effective authority = intersection over the capability lineage (checked on every request) | All |
| 2026-10-12 | Delegation decisions are `LifecycleEvent`s with `requestHash` (DisclosureMode has no delegation value) | P2/P3 |

## Integration Notes

Add only changes another owner must react to.

- **P1 → P2/P3:** Contract, SDK and broker wiring implemented; handoff in `packages/contracts/README.md` and `packages/contract-sdk/README.md`. Monad Testnet registry deployed at `0x9d1eB4688D770202E9753eCD6263f2d60f189728`; importable manifest: `packages/contracts/deployments/monad-testnet.json`. User's live golden-flow completed (13 receipts, 4 lifecycle events), broker health reports `provider: monad`, and SDK reads directly from public RPC confirm root `cap_c832caf31ea26bed` and child `cap_739e67414f479215` are REVOKED. Demo lifecycle writes use a server-side principal signer; the submitted principal must be its full wallet address. Direct user signing is supported by SDK but UI/API wallet authentication remains future work (B-02/B-04). Monad uses random IDs because on-chain IDs cannot be reset/reused. Expiry rounds down to whole seconds. Canonical capability IDs are public opaque IDs; never embed private data in them.

- **P2 → P3 (BREAKING vs first pass):** agent endpoints (`/context/request`, `/delegations`, `/tools/:id/invoke`) now require the `x-contextcaps-session` header. Use `session` from `POST /mandates` and `childSession` from `POST /delegations`. Identity fields in bodies are optional; mismatches are denied. Missing/unknown session → 401 `INVALID_SESSION`. Full handoff with examples: 01 §9.1.
- **P2 → P3:** Broker API payload types are in `packages/shared-types/src/broker-api.ts`. `POST /api/v1/agent/runs` returns the full LLM-visible trace for the activity UI; `scenario:"retry"` drives Scene 8; `planner:"llm"` (when enabled) and `injection:"hotel_description" | "tool_response" | "booking_page"` are optional.
- **P2 → P3:** render new reason code `DERIVATION_QUOTA_EXCEEDED`; `LifecycleEvent` gained `eventId`, `requestHash`, `delegationId`.
- **P2 → P3:** TOOL_BOUND `result` is `{ handle, resource, audience, expiresAt }` — the handle is opaque, safe to display truncated.
- **P2 → P1:** Broker calls the SDK only via `services/broker/src/chain/contractSdkProvider.ts` (`ContractClientLike` = assumed §12 shapes; the header lists exactly what the SDK must do). Prove your provider with `runProviderConformance` (`tests/broker/providerConformance.ts`). Receipt `decisionCode`: DENY 0, DERIVE 1, SELECT 2, TOOL_BOUND 3. `resultHash` is a keyed HMAC commitment (zero hash for denials).
- **P2 → All:** `packages/shared-types` created by P2 from 01 §3–§8 verbatim, plus additive `broker-api.ts`. Seed fixture adds `travelPreferences.hotel.loyaltyMemberId` (never disclosed) to make SELECT observable.

## Person 2 Readiness (2026-10-12)

```text
[x] original 99-test baseline still passes        (now 173 tests, all green)
[x] typecheck clean                               (no lint configured)
[x] agent identity cannot be spoofed via request body   (sessions; A01–A05)
[x] LLM planner behind BrokerPort                 (fake-provider L01–L06; live API not yet run — B-05)
[x] scripted planner still default + fallback     (L06)
[x] raw passport / raw calendar never reach LLM   (provider-request leak tests)
[x] salary request blocked                        (+ 3 realistic injection variants)
[x] tool-bound secret never reaches LLM           (TBA08: logs, receipts, trace, API, anchors)
[x] handle replay / wrong agent / wrong tool / other mandate fail   (TBA01–TBA07)
[x] derived-query quota                           (Q01–Q05)
[x] child capability narrower than parent; ancestor revoke/expiry blocks descendants   (D01–D10)
[x] receipts contain no private values; keyed commitments documented
[x] demo reset + golden-flow commands             (verified against a real broker process)
[x] API ready for Person 3                        (01 §9.1)
[x] CapabilityStateProvider ready for Person 1    (conformance suite + toBytes32Id)
```

Local latency baseline (`npm run bench:broker`; in-process, mock trust layer, one laptop — informational only):

```text
policy evaluation (pure)                   p50 0.015 ms   p95 0.037 ms
broker DENY (passport.raw)                 p50 0.024 ms   p95 0.054 ms
broker DERIVE passport.validity            p50 0.052 ms   p95 0.130 ms
broker SELECT hotel preferences            p50 0.035 ms   p95 0.078 ms
broker TOOL_BOUND issue handle             p50 0.031 ms   p95 0.063 ms
```

Real Monad state reads will add RPC latency to every request; these numbers say nothing about that.
