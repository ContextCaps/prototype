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
[ ] M0-01 TaskMandate schema
[ ] M0-02 ContextCapability schema
[ ] M0-03 ContextRequest schema
[ ] M0-04 DisclosureDecision schema
[ ] M0-05 DisclosureReceipt schema
[ ] M0-06 reason codes
[ ] M0-07 Broker endpoints
[ ] M0-08 contract events
```

**Owner:** Shared  
**Exit:** `01_ARCHITECTURE_AND_CONTRACTS.md` frozen for implementation pass 1.

## M1 — Independent Skeletons

### Person 1

```text
[ ] P1-01 CapabilityRegistry skeleton
[ ] P1-02 contract tests running
[ ] P1-03 local deployment
[ ] P1-04 SDK skeleton
```

### Person 2

```text
[ ] P2-01 Broker server
[ ] P2-02 seeded vault
[ ] P2-03 ContextRequest endpoint
[ ] P2-04 policy engine skeleton
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
[ ] register
[ ] query
[ ] revoke
[ ] expiry
```

### Person 2

```text
[ ] DENY passport.raw
[ ] DERIVE passport.validity
[ ] DENY calendar.raw
[ ] DERIVE calendar.availability
[ ] DENY salary.raw
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
[ ] Broker → Contract SDK
[ ] SDK → Monad
[ ] Broker result → Web
[ ] Revoke from Web
[ ] Revoke reflected in Broker
```

**Coordinator:** Person 3

**Exit:** real Monad capability can be revoked and the next Broker request fails.

## M4 — Advanced Golden Flow

```text
[ ] SELECT hotel preferences
[ ] create Hotel Agent child capability
[ ] reject invalid delegation
[ ] TOOL_BOUND checkout
[ ] booking mock succeeds
[ ] disclosure receipts available
```

## M5 — Attack Scenario

```text
[ ] malicious instruction seeded
[ ] agent requests salary
[ ] Broker denies OUT_OF_SCOPE
[ ] UI clearly shows trust moment
[ ] receipt generated
```

## M6 — Demo Stabilization

```text
[ ] full demo works after clean reset
[ ] raw passport absent from LLM logs
[ ] payment token absent from LLM logs
[ ] no private values on-chain
[ ] critical tests pass
[ ] demo reset command works
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
[ ] .env.example
[ ] setup tested by another teammate
[ ] final pitch
[ ] submission form
```

## Current Blockers

| ID | Owner | Blocker | Depends On | Status |
|---|---|---|---|---|
| - | - | - | - | - |

## Shared Decisions

| Date | Decision | Affects |
|---|---|---|
| TBD | Travel-agent golden path is the MVP | All |
| TBD | LLM is never authorization authority | P2/P3 |
| TBD | Raw private data stays off-chain | All |
| TBD | Modes are DENY / DERIVE / SELECT / TOOL_BOUND | All |

## Integration Notes

Add only changes another owner must react to.

Examples:

```text
P1 changed deployed address.
P2 added a required request field.
P3 needs rendering for a new reason code.
```
