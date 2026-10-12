# @contextcaps/contract-sdk

Person 2 imports the client without handling ABI or bytes32 conversions:

```ts
import { createContractClient, monadTestnet } from "@contextcaps/contract-sdk";
import { JsonRpcProvider, Wallet } from "ethers";

const provider = new JsonRpcProvider(monadTestnet.rpcUrl, undefined, { cacheTimeout: -1 });
const signer = new Wallet(process.env.MONAD_PRIVATE_KEY!, provider);
const client = createContractClient({
  address: process.env.CONTEXTCAPS_REGISTRY_ADDRESS!,
  runner: signer,
  explorerUrl: monadTestnet.explorerUrl,
});
await client.registerCapability({
  capabilityId: "cap_example_unique",
  principal: signer.address,
  agentId: "travel-agent",
  policyHash: "0x" + "ab".repeat(32),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
console.log(await client.getCapability("cap_example_unique"));
await client.revokeCapability("cap_example_unique");
```

Also available: `completeCapability`, `isCapabilityActive`, `registerDelegation`
and `anchorDisclosureReceipt`. Delegation follows Person 2's existing two-step
sequence: register child with `parentCapabilityId`, then confirm the matching
parent/child/agent tuple. The immutable link is effective from child registration,
even if confirmation fails. Retry confirmation without registering the child again.

`createContractClientFromEnv()` checks Monad Testnet and deployed code, then
creates the broker client. `CHAIN_PROVIDER=monad` is wired in the broker's
composition root. Existing shared schemas and API routes are unchanged.

IDs use keccak256(UTF-8); existing policy/request/result hashes pass through.
Timestamps are ISO strings; chain expiry uses uint64 seconds and rounds fractional
milliseconds **down**, reducing lifetime by at most 999 ms. Decision codes:
DENY=0, DERIVE=1, SELECT=2, TOOL_BOUND=3. Unknown capability → `null`; inactive →
effective REVOKED/EXPIRED/COMPLETED; RPC/contract failures throw. No mock fallback.
SDK read calls pin state and status to one block. All writes wait for a successful
mined receipt before returning `{ txHash, explorerUrl? }`.
Writes are serialized per client to avoid signer nonce collisions; a rejected
write does not poison the queue. Use one client instance per server-side signer.

Use a provider runner for reads only, or a principal wallet signer for lifecycle
writes. Deploy instructions and security boundaries are in `../contracts/README.md`.
