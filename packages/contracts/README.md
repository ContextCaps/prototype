# Person 1: Monad authorization protocol

Implementation: `src/CapabilityRegistry.sol`; SDK: `@contextcaps/contract-sdk`.
Solidity 0.8.28, optimizer 200 runs, Shanghai EVM target. Compiler is installed
through npm; compilation/tests need no compiler download or external RPC.

From the `prototype` root:

```sh
npm install
npm run contracts:compile
npm run test:contracts
npm run typecheck
npm test
```

Compilation generates `packages/contracts/artifacts/CapabilityRegistry.json`
(ABI, bytecode, compiler version) and the committed SDK ABI in
`packages/contract-sdk/src/abi.ts`. Recompile after Solidity changes.
Tests deploy the actual bytecode to an in-process Ganache EVM. They cover the
six P1 acceptance cases, completion, inherited revocation/expiry, depth limit,
receipt immutability/authorization, Person 2's provider conformance, and the
complete agent/broker booking flow. Ganache is development-only and runs no
public RPC server; on Node builds without its native uWS binary it uses the JS fallback.

## Deployment

Create `.env` from `.env.example`, then configure a **dedicated funded testnet wallet**:

```dotenv
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
MONAD_PRIVATE_KEY=<testnet signer key, keep local>
CONTEXTCAPS_RECEIPT_WRITER=<optional broker wallet address; defaults to deployer>
```

```sh
npm run contracts:compile
npm run contracts:deploy
```

The script checks chain ID 10143, deploys, waits for success, and writes
`packages/contracts/deployments/monad-testnet.json`. This single importable
manifest contains address, receipt writer, deployment transaction, block,
explorer URL and ABI. It never contains a private key. No deployment address is
invented or preconfigured. Network constants live in
`packages/contract-sdk/src/network.ts`; references:
[Monad network documentation](https://docs.monad.xyz/developer-essentials/testnet),
[viem's Monad Testnet definition](https://github.com/wevm/viem/blob/main/src/chains/definitions/monadTestnet.ts).

Set the printed address in `.env`, plus:

```dotenv
CONTEXTCAPS_REGISTRY_ADDRESS=<deployed address>
CHAIN_PROVIDER=monad
RECEIPT_HMAC_KEY=<your own random receipt commitment key>
```

Start the broker with environment loading (Node 22+):

```sh
node --env-file=.env --import tsx services/broker/src/main.ts
node --env-file=.env --import tsx services/broker/scripts/demo.ts golden-flow
```

The demo derives the principal address from `MONAD_PRIVATE_KEY`. Web clients
must submit the same full wallet address in `POST /mandates`; the mock-only
`0xA11CE` fixture is not an Ethereum address. Random IDs are used on Monad so
reset/restart never reuses immutable capability/receipt IDs. Broker reset
clears local state only; it cannot erase on-chain history or revoke old grants.
Revoke grants before resetting if needed. Broker storage remains in-memory.

## Authorization and on-chain guarantees

- Root registration, revoke and complete require `msg.sender == principal`.
- The immutable `receiptWriter` is also the broker **operator**: it may register a *child*
  capability under an active parent owned by the same principal (never a root, never longer
  than the parent) and confirm that delegation. This lets the principal sign only the root
  grant and revocation from their own wallet (`PRINCIPAL_SIGNING=wallet`) while the broker
  handles mid-run delegation. Revoking the root still revokes every child.
- Monad Testnet (wallet signing): registry `0xE366af2032Bc4e581F533806640185a5b0eA3FB2`,
  operator `0x8332d4eD21e9ceaEb887Ee2e8Ea2F08D26548534`.
- There is no owner/admin bypass for principal revocation.
- Immutable parent links require a live parent, the same principal, non-increasing
  expiry and at most eight on-chain delegation levels. Cycles are impossible:
  parents must already exist, and IDs can never be overwritten.
- `getCapabilityStatus` and `isActive` evaluate ancestors, including revocation,
  expiry and completion. Child reads report effective state immediately.
- Receipt anchoring requires the principal or immutable `receiptWriter`. Receipt
  IDs cannot be overwritten. DENY receipts can be anchored after revoke/expiry;
  allowed receipts require a currently active capability.
- The contract stores only opaque public IDs, addresses, hashes, status,
  timestamps, links and receipt commitments. Canonical capability IDs are stored
  so a fresh SDK can recover parent IDs without an off-chain mapping. Never use
  private data or descriptions as identifiers.
- Resource scope, purpose, audiences and per-task delegation attenuation remain
  **broker checks**. The contract commits their policy hash; it does not parse
  or verify that policy. Receipt anchoring proves who committed a hash, not the
  correctness of an off-chain result.

The current broker API has no wallet-signature authentication. The server-side
wallet supports a single-principal hackathon demo; it is not multi-user wallet
authorization. Agents never receive this key. For direct user signing, pass a
wallet signer to the SDK. A separate receipt-writer key cannot register/revoke
on another principal's behalf. Wallet-authenticated API work belongs to the
product integration phase.
