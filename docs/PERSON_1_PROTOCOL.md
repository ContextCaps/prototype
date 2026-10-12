# Person 1 — Protocol / Monad Owner

## Mission

Build the verifiable authorization state for ContextCaps.

> Make capability lifecycle, revocation, and delegation queryable and enforceable on Monad.

## Read First

```text
00_MASTER_CONTEXT.md
01_ARCHITECTURE_AND_CONTRACTS.md
02_SECURITY_AND_DEMO_SPEC.md
```

## Ownership

```text
packages/contracts/
packages/contract-sdk/
tests/contracts/
```

## Deliverables

### P1-01 — Capability Registry

Implement:

```text
register capability
query capability
revoke capability
complete capability
expiry handling
```

Store only:

```text
capability ID/hash
principal
agent ID/hash
policy hash
parent capability
expiry
status
```

Acceptance:

- register/query works;
- revoked capability is inactive;
- expired capability is inactive;
- only authorized principal can revoke.

### P1-02 — Delegation State

Preserve:

```text
parent capability
child capability
child agent
```

MVP scope attenuation may be validated by Broker, but on-chain linkage must be verifiable.

### P1-03 — Disclosure Receipt Anchor

Anchor:

```text
receipt ID
capability ID
request hash
result hash
decision code
```

Never raw private output.

### P1-04 — TypeScript Contract SDK

Expose:

```ts
registerCapability()
revokeCapability()
getCapability()
isCapabilityActive()
registerDelegation()
anchorDisclosureReceipt()
```

Person 2 should not need raw ABI handling.

### P1-05 — Monad Deployment

Provide:

```text
network config
deployed addresses
ABI
env variable names
explorer links
```

Keep deployment info in one importable module.

## Required Tests

```text
P1-T01 register valid capability → ACTIVE
P1-T02 revoke → REVOKED
P1-T03 expiry → inactive
P1-T04 unauthorized revoke → revert
P1-T05 parent/child registration → visible
P1-T06 disclosure anchor → event emitted
```

## Security Responsibility

You own:

```text
revocation authority
expiry state
principal revoke permissions
immutable receipt anchoring
delegation linkage
```

Do not claim on-chain enforcement for checks actually performed off-chain.

## Integration Handoff

Give Person 2:

```text
package/import path
example calls
network requirements
error behavior
deployed addresses
```

## Do Not Change Alone

```text
ContextCapability schema
DisclosureMode
Broker API
reason codes
UI flow
Vault design
Agent prompt design
```

## Definition of Done

```text
[x] contract tests pass                  local EVM + Person 2 conformance + golden flow
[x] deployed on Monad Testnet            manifest: packages/contracts/deployments/monad-testnet.json
[x] SDK queries live capability          root/child REVOKED verified directly on chain 10143
[x] SDK revokes live capability          user's golden-flow completed on Monad provider
[x] delegation state works               local EVM, inherited revoke/expiry
[x] disclosure receipt anchoring works    local EVM, immutable hashes + events
[x] Person 2 integrates SDK successfully  broker wiring + real-contract integration tests
[ ] Person 3 can show tx/proof
```

## Priority

```text
1. register/query
2. revoke
3. expiry
4. SDK
5. delegation
6. receipt anchor
7. optimizations
```

Do not optimize gas before end-to-end integration works.
