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

### 9.1 Implementation notes (Person 2, additive — affects P1/P3)

Typed payloads for every endpoint live in `packages/shared-types/src/broker-api.ts`
(§6 types are unchanged). Additions:

```text
POST /tools/:toolId/invoke   tool-bound call; agent passes opaque handles, gateway injects secrets
POST /agent/runs             { mandateId, scenario?: "golden" | "retry" } → run result + LLM-visible trace
POST /demo/reset             only when DEMO_MODE=true
GET  /health
```

HTTP conventions: `/context/request` always returns 200 with a `DisclosureDecision`
(DENY is a decision, not an error). `/delegations` returns 201, or 403 with
`{ allowed: false, reasonCode, reason }`. Malformed input → 400 `INVALID_REQUEST`.

Resource / operation pairs (`ContextRequest.operation`):

```text
passport.raw, calendar.raw, salary.raw, payment.raw   read            (always DENY)
passport.validity                                     valid_for_trip  params { destination, departureDate, returnDate }
calendar.availability                                 available_window params { from, to, minHours? }  (Scenes 4/8 "calendar.available_window")
travel.hotel_preferences                              select          params { fields? }
profile.legal_name, payment.handle                    issue_handle    audience "demo-booking-connector"
```

Reason-code rule for raw resources (reconciles Scene 2 with Scene 5 / INV-05):
raw resource whose family is in the capability (passport, calendar, payment) →
`RAW_DISCLOSURE_FORBIDDEN`; family not in the capability at all (salary) → `OUT_OF_SCOPE`.
Malformed or off-task parameters (e.g. passport validity for a destination other
than the mandate's) → `DENY / OUT_OF_SCOPE`.

Revocation of a parent revokes its whole subtree (the broker checks every ancestor's
state on each request).

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
