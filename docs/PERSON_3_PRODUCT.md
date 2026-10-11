# Person 3 — Product / Integration / Demo Owner

## Mission

Turn ContextCaps into a product a judge understands in under two minutes.

You are the **end-to-end integration owner**, not only the frontend owner.

## Read First

```text
00_MASTER_CONTEXT.md
01_ARCHITECTURE_AND_CONTRACTS.md
02_SECURITY_AND_DEMO_SPEC.md
```

## Ownership

```text
apps/web/
tests/e2e/
deployment/
demo/
```

## Product Story

The UI must clearly show:

```text
AI asks for raw private data
        ↓
ContextCaps blocks it
        ↓
AI asks for minimum derived fact
        ↓
ContextCaps allows it
```

Do not make the product look like a generic blockchain admin dashboard.

## Required Screens

### P3-01 — Task Screen

User selects/enters:

```text
Book my Singapore trip next weekend under $700.
```

Show:

```text
Travel Agent
Destination
Budget
Purpose
```

### P3-02 — Authorization Preview

```text
Allowed
✓ Passport eligibility
✓ Available travel window
✓ Hotel preferences
✓ Booking credentials at checkout

Not exposed
✕ Raw passport
✕ Full calendar
✕ Salary
✕ Raw payment credentials
```

Button:

```text
Authorize on Monad
```

### P3-03 — Agent Activity

Example denial:

```text
Travel Agent requested:
passport.raw

BLOCKED
RAW_DISCLOSURE_FORBIDDEN
```

Then:

```text
Travel Agent requested:
passport.validity

DERIVED
valid = true
```

### P3-04 — Delegation View

Show:

```text
Travel Agent
     │
     ▼
Hotel Agent
```

Highlight narrower child access.

### P3-05 — Tool-Bound Checkout

Display:

```text
Booking credential:
Protected by ContextCaps
```

Never display actual secret.

### P3-06 — Revocation

Button:

```text
Revoke Access
```

After revocation:

```text
REVOKED
```

Retry must visibly fail.

### P3-07 — Audit / Proof

Important events show:

```text
agent
resource
decision
reason
capability
timestamp
tx/receipt link
```

Use expandable "View proof" so the main UI remains simple.

## Mock First

Build immediately with mocks that exactly match the shared schemas.

Then swap mocks for Person 2 API.

Do not wait for backend completion.

## Integration Responsibility

You own final connectivity:

```text
Web
 ↓
Broker
 ↓
Monad
 ↓
Broker result
 ↓
Web
```

If P1 and P2 work individually but not together, integration is not done.

## E2E Tests

```text
P3-E2E-01 authorize → ACTIVE
P3-E2E-02 passport.raw → BLOCKED
P3-E2E-03 passport.validity → DERIVED true
P3-E2E-04 salary request → BLOCKED
P3-E2E-05 hotel delegation → narrower child capability
P3-E2E-06 tool-bound booking → CONFIRMED, no secret shown
P3-E2E-07 revoke → REVOKED
P3-E2E-08 retry after revoke → BLOCKED
```

## Demo Script

Target: 90–120 seconds.

### 0–15 sec

Show private vault categories.

> The agent needs information from this vault, but we don't want to expose the whole dataset.

### 15–30 sec

Authorize travel task.

### 30–45 sec

Raw passport request:

```text
BLOCKED
```

Then derived validity:

```text
valid = true
```

### 45–60 sec

Malicious salary request:

```text
BLOCKED
Outside task purpose
```

### 60–75 sec

Travel Agent delegates to Hotel Agent.

Show reduced capability.

### 75–90 sec

Tool-bound checkout succeeds.

### 90–105 sec

Revoke capability.

Retry fails.

### End

Show Monad proof and say:

> **Give AI agents the answer they need, not the data they asked for.**

## Product Design Priority

Optimize for:

```text
clarity
visible trust boundary
fast state changes
low explanation tax
```

Avoid:

```text
dense blockchain jargon
too many tabs
unnecessary metrics
generic admin-dashboard styling
```

## Demo Reliability

Create a deterministic Demo Mode if needed.

It may use seeded data and scripted request order, but it must call the **real Broker and real contract paths**.

Never fake:

```text
allow/deny
revocation
delegation
```

in frontend-only state.

## Deployment Ownership

Provide:

```text
frontend deployment
environment checklist
backend URL config
Monad explorer links
demo seed/reset command
```

The team must be able to restore demo state quickly.

## Do Not Change Alone

```text
Broker API schema
shared types
contract events
capability semantics
reason codes
```

## Definition of Done

```text
[ ] frontend works with mocks
[ ] integrated with Broker
[ ] Monad state/proof visible
[ ] all golden demo scenes implemented
[ ] success path passes
[ ] malicious path passes
[ ] revoke path passes
[ ] deterministic reset exists
[ ] deployed app works
[ ] final demo can be recorded cleanly
```

## Priority

```text
1. golden-flow UI with mocks
2. Broker integration
3. allow/deny visualization
4. Monad authorize/revoke
5. delegation view
6. tool-bound checkout
7. audit
8. visual polish
```
