# ContextCaps indexer (Envio HyperIndex)

Indexes the `CapabilityRegistry` on Monad Testnet
([`0xE366…3FB2`](https://testnet.monadscan.com/address/0xE366af2032Bc4e581F533806640185a5b0eA3FB2))
into a GraphQL API: every grant, delegation link, revocation, completion and
anchored disclosure receipt. The demo's **Audit & proof** step reads it to show
what Monad itself recorded for the signed-in wallet, independent of broker
memory, so the history survives broker restarts.

Only on-chain data is indexed: opaque ids, addresses, hashes, status and
timestamps. No private context exists on-chain, so none can be indexed.

## What it exposes

| Entity | Contents |
|---|---|
| `Capability` | principal, agent, policy hash, parent link and depth, expiry, status (`ACTIVE`/`REVOKED`/`COMPLETED`), grant/revoke tx, receipt and denial counts, `children`, `receipts` |
| `Receipt` | capability, request hash, keyed result commitment, decision (`DENY`/`DERIVE`/`SELECT`/`TOOL_BOUND`), tx |
| `LifecycleEvent` | every transition in order: `REGISTERED`, `DELEGATION_CONFIRMED`, `REVOKED`, `COMPLETED` |

Example query, all grants of one wallet with their receipts:

```graphql
query {
  Capability(where: { principal: { _eq: "0xecc070725898eb3aaea8448b16272ee6e56c5e81" } }, order_by: { registeredBlock: desc }) {
    agent status depth receiptCount denyCount registeredTx revokedTx
    receipts(order_by: { anchoredBlock: asc }) { decision txHash }
  }
}
```

`status` is each capability's own status. On-chain, revoking a parent also
revokes its children (the contract checks ancestors); read the parent's status
or the registry's `getCapabilityStatus` for the effective state.

## Run locally

Envio ships Linux and macOS binaries only, so on Windows run it inside **WSL**.
`envio dev` also needs **Docker** (Docker Desktop with WSL integration) for its
Postgres and GraphQL services.

The project uses **pnpm** (Envio Cloud builds with pnpm 10.32.0); `npx pnpm@10.32.0`
works without installing pnpm globally.

```bash
cd indexer
pnpm install
pnpm codegen      # after any change to config.yaml or schema.graphql
pnpm dev          # indexes from the registry's deployment block
```

GraphQL: <http://localhost:8080/v1/graphql> (Hasura console at <http://localhost:8080>).
Then point the web app at it in `apps/web/.env.local` and restart `npm run dev:web`:

```dotenv
VITE_ENVIO_GRAPHQL_URL=http://localhost:8080/v1/graphql
```

## Hosted

Deploy with [Envio Cloud](https://envio.dev/app):

1. Log in with GitHub and install the **Envio Deployments** GitHub App for this repository.
2. **Add Indexer** with **Root Directory** `indexer`, **Config File Path** `config.yaml`,
   and the **Deployment Branch** you want to deploy from.
3. Push to that branch; every push redeploys and re-indexes from the start block.
4. Copy the deployment's GraphQL endpoint into `VITE_ENVIO_GRAPHQL_URL`.

The free development plan allows 100,000 processed events and is deleted after
7 days without queries, which is ample for the demo.

The indexer is kept out of the root npm workspaces so the main project does not
install Envio's toolchain unless you work on it.
