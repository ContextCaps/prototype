# ContextCaps — Architecture & Contracts

> **Source of truth for shared technical boundaries.**
>
> Changes to shared interfaces must be coordinated before implementation.

## 1. Architecture

```text
┌──────────────────────┐
│        USER          │
└──────────┬───────────┘
           │ authorize / revoke
           ▼
┌──────────────────────┐
│       WEB APP        │
│      Person 3        │
└──────────┬───────────┘
           │ task / UI actions
           ▼
┌──────────────────────┐
│     AI RUNTIME       │
│      Person 2        │
└──────────┬───────────┘
           │ ContextRequest
           ▼
┌──────────────────────────────┐
│       CONTEXT BROKER         │
│          Person 2            │
│  ┌────────────────────────┐  │
│  │ Deterministic Policy   │  │
│  │ Engine                 │  │
│  └──────────┬─────────────┘  │
└─────────────┼────────────────┘
              │
     ┌────────┴──────────┐
     ▼                   ▼
┌──────────────┐  ┌─────────────────┐
│ CONTEXT VAULT│  │ MONAD TRUST     │
│  Person 2    │  │ LAYER           │
│ raw private  │  │ Person 1        │
│ data         │  │ capability      │
└──────────────┘  │ revocation      │
                  │ delegation      │
                  │ receipt hashes  │
                  └─────────────────┘
```

## 2. Recommended Repository Structure

```text
contextcaps/
├── apps/
│   └── web/                 # Person 3
├── services/
│   ├── broker/              # Person 2
│   ├── agent/               # Person 2
│   └── vault/               # Person 2
├── packages/
│   ├── contracts/           # Person 1
│   ├── contract-sdk/        # Person 1
│   ├── shared-types/        # Shared / frozen
│   └── policy/              # Person 2
├── tests/
│   ├── contracts/
│   ├── broker/
│   └── e2e/
└── docs/
```

## 3. Shared IDs

```ts
type CapabilityId = string;
type MandateId = string;
type AgentId = string;
type ReceiptId = string;
```

MVP agent IDs:

```text
travel-agent
hotel-agent
```

Future wallet/ERC-8004 IDs may map behind the same abstraction.

## 4. Capability Lifecycle

```text
ACTIVE
  ├──► REVOKED
  ├──► EXPIRED
  └──► COMPLETED
```

```ts
export type CapabilityStatus =
  | "ACTIVE"
  | "REVOKED"
  | "EXPIRED"
  | "COMPLETED";
```

## 5. Disclosure Modes

```ts
export type DisclosureMode =
  | "DENY"
  | "DERIVE"
  | "SELECT"
  | "TOOL_BOUND";
```

Do not add modes without updating all consumers.

## 6. Shared Types

### TaskMandate

```ts
export interface TaskMandate {
  mandateId: string;
  principal: string;
  purpose: string;
  description: string;
  rootAgentId: AgentId;

  constraints: {
    budgetUsd?: number;
    destination?: string;
    validFrom: string;
    validUntil: string;
  };

  status: CapabilityStatus;
}
```

### ContextPermission

```ts
export interface ContextPermission {
  resource: string;
  allowedModes: DisclosureMode[];
  allowedOperations?: string[];
  allowedAudience?: string[];
  delegable: boolean;
}
```

### ContextCapability

```ts
export interface ContextCapability {
  capabilityId: CapabilityId;
  mandateId: MandateId;

  principal: string;
  agentId: AgentId;
  purpose: string;

  permissions: ContextPermission[];

  parentCapabilityId?: CapabilityId;
  delegationDepth: number;
  maxDelegationDepth: number;

  validFrom: string;
  expiresAt: string;

  status: CapabilityStatus;
  policyHash: string;
}
```

Delegated capability invariant:

```text
child.permissions ⊆ parent.permissions
child.expiresAt <= parent.expiresAt
child max delegation depth < parent allowance
```

### ContextRequest

```ts
export interface ContextRequest {
  requestId: string;

  mandateId: MandateId;
  capabilityId: CapabilityId;
  agentId: AgentId;

  purpose: string;

  resource: string;
  operation: string;

  requestedMode?: DisclosureMode;
  parameters?: Record<string, unknown>;
  audience?: string;

  timestamp: string;
}
```

### DisclosureDecision

```ts
export interface DisclosureDecision {
  requestId: string;

  decision: DisclosureMode;
  allowed: boolean;

  reasonCode: string;
  reason: string;

  result?: unknown;

  receiptId: ReceiptId;
  capabilityId: CapabilityId;
  policyHash: string;

  timestamp: string;
}
```

### Delegation

```ts
export interface Delegation {
  delegationId: string;

  mandateId: MandateId;

  parentCapabilityId: CapabilityId;
  childCapabilityId: CapabilityId;

  parentAgentId: AgentId;
  childAgentId: AgentId;

  purpose: string;
  createdAt: string;
}
```

### DisclosureReceipt

```ts
export interface DisclosureReceipt {
  receiptId: ReceiptId;

  requestId: string;
  mandateId: MandateId;
  capabilityId: CapabilityId;

  agentId: AgentId;

  resource: string;
  operation: string;

  decision: DisclosureMode;
  reasonCode: string;

  requestHash: string;
  resultHash?: string;

  timestamp: string;
  chainTxHash?: string;
}
```

Raw sensitive outputs must never be included in public receipts.

## 7. Stable Reason Codes

```text
ALLOW_DERIVED
ALLOW_SELECTED
ALLOW_TOOL_BOUND

OUT_OF_SCOPE
PURPOSE_MISMATCH
AGENT_MISMATCH
CAPABILITY_REVOKED
CAPABILITY_EXPIRED
INVALID_CAPABILITY
MODE_NOT_ALLOWED
AUDIENCE_NOT_ALLOWED
DELEGATION_NOT_ALLOWED
DELEGATION_SCOPE_ESCALATION
DELEGATION_DEPTH_EXCEEDED
RAW_DISCLOSURE_FORBIDDEN
TOOL_NOT_ALLOWED

DERIVATION_QUOTA_EXCEEDED     (added 2026-10-12 by P2 — affects P3 rendering)
```

`DERIVATION_QUOTA_EXCEEDED`: a capability asked too many *distinct* questions of a
low-entropy derived resource (passport.validity: 5, calendar.availability: 10).
Identical repeated questions are answered from cache and do not count. Suggested
UI copy: "Blocked — too many different questions about the same private fact."

## 8. MVP Resources

```text
profile.legal_name

passport.raw
passport.validity

calendar.raw
calendar.availability

travel.hotel_preferences

salary.raw

payment.raw
payment.handle
```

Expected policy:

```text
passport.raw                 → DENY
passport.validity            → DERIVE

calendar.raw                 → DENY
calendar.availability        → DERIVE

travel.hotel_preferences     → SELECT

salary.raw                   → DENY

payment.raw                  → DENY
payment.handle               → TOOL_BOUND
```

## 9. Broker API

Base:

```text
/api/v1
```

### POST `/mandates`

Creates/prepares mandate and root capability.

### POST `/context/request`

Input:

```ts
ContextRequest
```

Output:

```ts
DisclosureDecision
```

### POST `/delegations`

Creates a child capability after attenuation checks.

### POST `/capabilities/:id/revoke`

Revokes capability.

### GET `/capabilities/:id`

Returns current state.

### GET `/audit?mandateId=...`

Returns decisions/receipts for UI.

### 9.1 Broker API handoff (Person 2 — additive, affects P1/P3)

Typed payloads for every endpoint: `packages/shared-types/src/broker-api.ts`
(§6 types are unchanged and reused).

**Run it**

```text
npm install
npm run start:broker                       → http://127.0.0.1:8787/api/v1   (env: .env.example)
npm run demo:reset                         → clear state (DEMO_MODE=true)
npm run demo:seed                          → reset + create the travel mandate; prints ids + root session
npm run demo:golden-flow [-- --local]      → walks all 9 scenes over HTTP; exit 1 on any surprise
npm test / npm run typecheck / npm run bench:broker
```

In `DEMO_MODE` ids are sequential after every reset (`mdt_0001`, `cap_0001`,
`cap_0002` for the hotel child). Session tokens and tool handles are always random.

**Wallet signing (`PRINCIPAL_SIGNING=wallet`, P3 — additive)**

The principal's own wallet signs the root grant and revocation; the broker key is only the
registry operator (child registration under an active user-signed root, delegation links, receipts).

```http
POST /api/v1/mandates                       (same body)
→ 202 { "status": "AWAITING_SIGNATURE", "mandate": {…}, "capability": {…},
        "signRequest": { "chainId": 10143, "to": "0x<registry>", "data": "0x…" } }      (no session)
  … wallet sends signRequest …
POST /api/v1/mandates/:mandateId/confirm    { "txHash": "0x…" }
→ 201 CreateMandateResponse   once chain state matches (ACTIVE, same policyHash and principal, no parent)
→ 409 not registered yet / mismatch;  404 unknown or already confirmed

POST /api/v1/capabilities/:id/revoke/prepare → 200 { "signRequest": {…} }
  … wallet sends signRequest …
POST /api/v1/capabilities/:id/revoke        { "txHash": "0x…" }
→ 200 CapabilityStateResponse once the chain reports REVOKED;  400 without txHash;  409 not revoked yet
```

The broker trusts chain state, never the submitted hash (it is stored for display only).
In wallet mode the broker never registers roots or revokes. Server signing remains the default.

**Two kinds of caller**

| Caller | Endpoints | Identity |
|---|---|---|
| User / web app (principal) | `POST /mandates`, `POST /capabilities/:id/revoke`, `GET /capabilities/:id`, `GET /audit`, `POST /agent/runs`, `POST /demo/reset`, `GET /health` | none in MVP (wallet signature is future work) |
| Agent | `POST /context/request`, `POST /delegations`, `POST /tools/:toolId/invoke` | **session header required** |

**Agent sessions.** `POST /mandates` returns `session` (root agent) and a successful
`POST /delegations` returns `childSession`. Send it as `x-contextcaps-session: ses_…`
(or `Authorization: Bearer ses_…`). The broker resolves `agentId`, `mandateId`,
`capabilityId` and `purpose` from the session; body copies of these fields are
optional, and a value that differs from the session is **denied and receipted**
(`AGENT_MISMATCH` / `INVALID_CAPABILITY`). Missing or unknown session →
`401 { error: "INVALID_SESSION", allowed: false, decision: "DENY" }`, no receipt.
Treat the session token as a credential: never show it to an LLM or log it.

**HTTP conventions.** `/context/request` and `/tools/:id/invoke` return 200 with a
decision even for DENY (DENY is a result, not an error). `/delegations` → 201, or 403
with `{ allowed: false, reasonCode, reason }`. Malformed body → 400 `INVALID_REQUEST`
(paths only, values never echoed). Trust layer unreachable → requests fail closed.

**Examples**

```http
POST /api/v1/mandates
{ "principal": "0xA11CE", "description": "Book my Singapore trip next weekend under $700.",
  "constraints": { "budgetUsd": 700, "destination": "Singapore" } }
→ 201 { "mandate": { "mandateId": "mdt_0001", "purpose": "travel-booking", "status": "ACTIVE", … },
        "capability": { "capabilityId": "cap_0001", "agentId": "travel-agent", "permissions": [ … ], "policyHash": "0x…", … },
        "chain": { "txHash": "0x…" },
        "session": { "sessionId": "ses_…", "agentId": "travel-agent", "capabilityId": "cap_0001", … } }

POST /api/v1/context/request            x-contextcaps-session: ses_…
{ "resource": "passport.validity", "operation": "valid_for_trip",
  "parameters": { "destination": "Singapore", "departureDate": "2026-10-17", "returnDate": "2026-10-18" } }
→ 200 { "requestId": "req_0001", "decision": "DERIVE", "allowed": true, "reasonCode": "ALLOW_DERIVED",
        "reason": "…", "result": { "valid": true }, "receiptId": "rcpt_0001", "capabilityId": "cap_0001",
        "policyHash": "0x…", "timestamp": "…" }

{ "resource": "salary.raw", "operation": "read" }
→ 200 { "decision": "DENY", "allowed": false, "reasonCode": "OUT_OF_SCOPE", "receiptId": "rcpt_0002", … }   (no result)

{ "resource": "payment.handle", "operation": "issue_handle", "requestedMode": "TOOL_BOUND", "audience": "demo-booking-connector" }
→ 200 { "decision": "TOOL_BOUND", "result": { "handle": "tbh_…", "resource": "payment.handle",
        "audience": "demo-booking-connector", "expiresAt": "…" }, … }

POST /api/v1/delegations                x-contextcaps-session: <travel-agent session>
{ "childAgentId": "hotel-agent", "permissions": [
    { "resource": "calendar.availability", "allowedModes": ["DERIVE"], "delegable": false },
    { "resource": "travel.hotel_preferences", "allowedModes": ["SELECT"], "delegable": false } ] }
→ 201 { "allowed": true, "delegation": { "delegationId": "dlg_0001", … },
        "capability": { "capabilityId": "cap_0002", "agentId": "hotel-agent", "delegationDepth": 1, … },
        "chain": { "txHash": "0x…" }, "childSession": { "sessionId": "ses_…", "agentId": "hotel-agent", … } }

POST /api/v1/tools/demo-booking-connector/invoke      x-contextcaps-session: <travel-agent session>
{ "arguments": { "offerId": "SG-HTL-MRNA-02", "checkIn": "2026-10-17", "checkOut": "2026-10-18",
                 "amountUsd": 189, "identityHandle": "tbh_…", "paymentHandle": "tbh_…" } }
→ 200 { "allowed": true, "decision": "TOOL_BOUND", "reasonCode": "ALLOW_TOOL_BOUND",
        "result": { "bookingStatus": "CONFIRMED", "reference": "CC-DEMO-001", … }, "receiptIds": ["rcpt_…", "rcpt_…"] }

POST /api/v1/capabilities/cap_0001/revoke
→ 200 { "capability": { …, "status": "REVOKED" }, "chain": { "provider": "mock", "status": "REVOKED",
        "registrationTxHash": "0x…", "revocationTxHash": "0x…" }, "childCapabilityIds": ["cap_0002"] }

GET /api/v1/capabilities/cap_0002      → same shape; status is EFFECTIVE (REVOKED/EXPIRED if any ancestor is)

GET /api/v1/audit?mandateId=mdt_0001
→ 200 { "mandateId": "mdt_0001",
        "entries":   [ { "receipt": DisclosureReceipt, "allowed": bool, "reason": "…", "kind": "context_request" | "tool_invocation" } ],
        "delegations": [ Delegation ],
        "lifecycle": [ { "eventId", "type": "MANDATE_CREATED" | "DELEGATION_CREATED" | "DELEGATION_REJECTED" | "CAPABILITY_REVOKED",
                         "capabilityId", "agentId", "reasonCode"?, "requestHash"?, "chainTxHash"?, "timestamp" } ] }

POST /api/v1/agent/runs
{ "mandateId": "mdt_0001", "scenario"?: "golden" | "retry", "planner"?: "scripted" | "llm",
  "injection"?: "deals_page" | "hotel_description" | "tool_response" | "booking_page" }
→ 200 { "status": "BOOKED" | "HALTED_BY_POLICY" | "NO_BOOKING" | "PLANNER_ERROR",
        "planner": "scripted" | "llm" | "scripted-fallback", "summary": "…", "booking"?: {…, "reference"},
        "haltReasonCode"?: "CAPABILITY_REVOKED", "childCapabilityId"?: "cap_0002",
        "trace": [ LLM-visible entries: task | note | external_content | tool_call {tool, input, output} ] }
   planner "llm" → 503 LLM_UNAVAILABLE unless LLM_PLANNER=openai. Runs use the mandate's root session server-side.

GET /api/v1/health → { "ok": true, "provider": "mock" | "monad", "llmPlanner": "available" | "unavailable" }
```

**Resource / operation pairs** (`operation` field):

```text
passport.raw, calendar.raw, salary.raw, payment.raw   read             always DENY
passport.validity                                     valid_for_trip   {destination, departureDate, returnDate}   DERIVE, max 5 distinct queries
calendar.availability                                 available_window {from, to, minHours?}  (≤ 14 days)          DERIVE, max 10 distinct queries
travel.hotel_preferences                              select           {fields?}  roomType | bedType | areaPreference
profile.legal_name, payment.handle                    issue_handle     audience "demo-booking-connector"            TOOL_BOUND
```

Scenes 4/8 "calendar.available_window" = resource `calendar.availability` + operation `available_window`.

**Reason codes** (§7, plus `DERIVATION_QUOTA_EXCEEDED`). Rules worth rendering:
raw resource in an in-scope family (passport, calendar, payment) → `RAW_DISCLOSURE_FORBIDDEN`;
family not in scope at all (salary) → `OUT_OF_SCOPE`. Malformed or off-task parameters
(e.g. passport validity for a destination other than the mandate's), unapproved SELECT
fields, and charges over budget → `OUT_OF_SCOPE`. Revoking a parent revokes its whole
subtree; a child can never exercise anything an ancestor does not grant.

**Golden demo order** (what `demo:golden-flow` and `POST /agent/runs` exercise):
authorize → passport.raw DENY → passport.validity DERIVE → calendar.raw DENY →
calendar.availability DERIVE → salary.raw DENY (injected page) → delegate to hotel-agent
(passport delegation 403) → hotel-agent availability + preferences → TOOL_BOUND handles →
booking CONFIRMED → revoke → retry DENY `CAPABILITY_REVOKED`.

**Mock Monad behaviour.** Until Person 1's SDK lands, `CHAIN_PROVIDER=mock` keeps
capability status, policy hash, expiry, delegation links and receipt anchors in memory
with deterministic `0x…` tx hashes (no explorer links yet). The broker re-reads trust-layer
state on every request, so a revocation made directly on the chain is enforced the same way.

**Receipts.** `requestHash` = SHA-256 of the canonical request (recomputable by anyone
holding it). `resultHash` = HMAC-SHA256 with `RECEIPT_HMAC_KEY` — a keyed commitment for
sensitive low-entropy derived outputs; only a key holder can verify it, it is not publicly
recomputable. Denials have no `resultHash`. Receipts never contain results, parameters or handles.

**Person 1 boundary.** The broker talks to the chain only via `CapabilityStateProvider`
(`services/broker/src/chain/`). The SDK receives canonical string IDs; recommended bytes32
encoding is `toBytes32Id(id) = keccak256(UTF-8(id))`. Prove a provider with
`runProviderConformance` in `tests/broker/providerConformance.ts`. Receipt `decisionCode`:
DENY 0, DERIVE 1, SELECT 2, TOOL_BOUND 3.

## 10. Monad Contract Responsibilities

### CapabilityRegistry

Must support:

```text
registerCapability
revokeCapability
completeCapability
getCapabilityStatus
registerDelegation
isActive
anchorDisclosureReceipt
```

Minimum on-chain state:

```text
capability ID/hash
principal
agent ID/hash
policy hash
parent capability
expiry
status
```

## 11. Suggested Contract Events

```solidity
event CapabilityRegistered(
    bytes32 indexed capabilityId,
    address indexed principal,
    bytes32 indexed agentId,
    bytes32 policyHash,
    bytes32 parentCapabilityId,
    uint64 expiresAt
);

event CapabilityRevoked(
    bytes32 indexed capabilityId,
    address indexed principal
);

event CapabilityCompleted(
    bytes32 indexed capabilityId
);

event DelegationRegistered(
    bytes32 indexed parentCapabilityId,
    bytes32 indexed childCapabilityId,
    bytes32 indexed childAgentId
);

event DisclosureReceiptAnchored(
    bytes32 indexed capabilityId,
    bytes32 indexed receiptId,
    bytes32 requestHash,
    bytes32 resultHash,
    uint8 decisionCode
);
```

## 12. Contract SDK Boundary

Person 1 provides a TypeScript SDK:

```ts
interface ContextCapsContractClient {
  registerCapability(input: RegisterCapabilityInput): Promise<TxResult>;
  revokeCapability(capabilityId: string): Promise<TxResult>;
  getCapability(capabilityId: string): Promise<OnchainCapability>;
  isCapabilityActive(capabilityId: string): Promise<boolean>;
  registerDelegation(input: RegisterDelegationInput): Promise<TxResult>;
  anchorDisclosureReceipt(
    receipt: DisclosureReceiptAnchor
  ): Promise<TxResult>;
}
```

Person 2 should not manually implement raw contract calls.

## 13. Trust Boundary

```text
UNTRUSTED / PROBABILISTIC
- LLM
- websites
- external tool responses
- sub-agents

TRUST-CRITICAL / DETERMINISTIC
- capability state
- revocation
- policy evaluation
- delegation validation
- tool-bound secret injection
```

No direct Agent → Vault path is allowed.

## 14. Integration Strategy

First:

```text
Web → Broker → Mock Contract SDK
```

Then:

```text
Web → Broker → Real Monad SDK
```

If this file is respected, replacing mocks should not require a frontend or broker redesign.
