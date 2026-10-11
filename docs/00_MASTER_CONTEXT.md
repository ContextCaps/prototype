# ContextCaps — Master Context

> **Read this file first before modifying the repository.**
>
> This is the shared product context for all team members and coding agents.

## 1. Project Identity

**Project:** ContextCaps  
**Hackathon:** Monad Metropolis  
**Primary Track:** Trust, Identity & AI Infrastructure  
**Target Network:** Monad Testnet  
**Team Size:** 3

### One-line pitch

> **Give AI agents the answer they need, not the data they asked for.**

### Core thesis

ContextCaps is a **task-aware minimum-disclosure layer** between AI agents and sensitive user context.

Instead of granting broad resource access:

```text
Agent may access:
- calendar
- passport
- payment credentials
```

ContextCaps asks:

> **What is the minimum information this agent actually needs for this specific authorized task?**

Examples:

- Full passport → `passport_valid_for_trip = true`
- Full calendar → one available time window
- Payment secret → injected directly into an approved tool, never shown to the LLM
- Parent agent permission → narrower child-agent capability, never automatic inheritance

---

## 2. MVP Use Case

### Private Travel Agent

User instruction:

```text
"Book my Singapore trip next weekend under $700."
```

Seeded private context:

```text
profile
passport
calendar
salary
travel_preferences
payment_method
```

The MVP must demonstrate:

1. User authorizes the travel task.
2. Travel Agent requests the full passport.
3. ContextCaps denies the raw request.
4. Agent requests `passport_valid_for_trip(destination, dates)`.
5. ContextCaps returns a derived boolean.
6. Agent requests calendar availability.
7. ContextCaps returns only an available window.
8. Travel Agent delegates hotel search to Hotel Agent.
9. Hotel Agent receives a narrower capability.
10. Checkout uses a tool-bound credential so the LLM never sees the secret.
11. User revokes the capability.
12. The next request is denied.

This is the **golden demo flow**. New features must not endanger it.

---

## 3. Core Components

### Task Mandate

Human-authorized root task.

### Context Capability

Defines:

- principal;
- agent;
- purpose;
- allowed context;
- disclosure modes;
- expiry;
- delegation constraints;
- status.

### Context Broker

Security-critical service that intercepts all context requests.

### Policy Engine

Deterministically returns:

```text
DENY
DERIVE
SELECT
TOOL_BOUND
```

### Context Vault

Private off-chain context store.

### Monad Trust Layer

Used for:

- capability registration;
- expiry;
- revocation;
- delegation state;
- disclosure receipt commitments.

Raw private data is never stored on-chain.

---

## 4. Non-Negotiable Rules

### Rule 1 — LLM is never the authorization authority

The LLM may request context.

The LLM may not decide that its own request is authorized.

### Rule 2 — Minimum sufficient disclosure first

If a derived answer is enough, do not return raw data.

### Rule 3 — Tool-bound secrets do not enter LLM context

The model may receive an opaque handle. The approved connector receives the actual secret.

### Rule 4 — Delegation attenuates authority

```text
Child Scope ⊆ Parent Scope
```

### Rule 5 — Raw private data never goes on-chain

Only hashes, commitments, identifiers, status, timestamps, and non-sensitive authorization state.

### Rule 6 — Revoked or expired capability fails closed

No fallback or best-effort access.

---

## 5. Differentiation

ContextCaps is **not**:

- a generic AI memory database;
- another agent reputation system;
- a simple PII redactor;
- a generic permission dashboard;
- a wallet policy product.

The core abstraction is:

```text
Resource-level access
        ↓
Task-aware information authority
        ↓
Minimum sufficient disclosure
```

Key differentiators:

- purpose-bound authorization;
- derived disclosure;
- selective disclosure;
- tool-bound secrets;
- non-transitive delegation;
- verifiable capability lifecycle.

---

## 6. MVP Scope

### Must ship

- Monad capability registry.
- Capability expiry.
- Revocation.
- Parent/child capability state.
- Context Broker.
- Deterministic policy engine.
- Seeded Context Vault.
- Travel Agent.
- Hotel sub-agent.
- `DENY`.
- `DERIVE`.
- `SELECT`.
- `TOOL_BOUND`.
- Audit/disclosure timeline.
- End-to-end web app.
- Successful path.
- Malicious/out-of-scope path.
- Delegation path.
- Revoke-and-retry path.

### Nice to have only after golden path works

- Passkey onboarding.
- ERC-8004 identity.
- Envio indexing.
- MCP compatibility.
- richer policy authoring.

### Explicitly out of scope

- production passport integration;
- production booking APIs;
- production custody;
- full KYC;
- universal policy language;
- ZK system from scratch;
- multi-chain support;
- generic IAM;
- generic reputation network.

---

## 7. Team Ownership

### Person 1 — Protocol / Monad

Owns:

```text
packages/contracts
packages/contract-sdk
```

Goal:

> Make authorization state verifiable and enforceable on Monad.

### Person 2 — Context Broker / AI

Owns:

```text
services/broker
services/agent
services/vault
packages/policy
```

Goal:

> Decide what information agents receive and in what representation.

### Person 3 — Product / Integration

Owns:

```text
apps/web
tests/e2e
deployment/demo
```

Goal:

> Make the trust mechanism obvious and the full flow work end-to-end.

---

## 8. Shared Boundary Rule

Shared schemas are defined in:

```text
01_ARCHITECTURE_AND_CONTRACTS.md
```

Do not independently change:

- shared type names;
- enum values;
- contract events;
- API payloads;
- capability lifecycle;
- agent ID representation.

---

## 9. Definition of Done

A judge must be able to see:

```text
1. User authorizes travel task.
2. Agent requests unnecessary raw data.
3. Request is blocked.
4. Agent asks for a minimum derived fact.
5. Request succeeds.
6. Agent delegates to a narrower sub-agent.
7. Checkout succeeds without exposing the secret to the LLM.
8. User revokes.
9. Next access fails.
10. Monad proves authorization lifecycle.
```

### Final judge takeaway

> **ContextCaps lets autonomous agents use private context without automatically seeing the underlying private data.**
