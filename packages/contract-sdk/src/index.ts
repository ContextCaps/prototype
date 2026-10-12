import { Contract, JsonRpcProvider, Wallet, ZeroAddress, ZeroHash, getAddress, isHexString, keccak256, toUtf8Bytes, type ContractRunner, type ContractTransactionResponse } from "ethers";
import type { CapabilityStatus } from "@contextcaps/shared-types";
import { capabilityRegistryAbi } from "./abi";
import { monadTestnet } from "./network";
export { capabilityRegistryAbi } from "./abi";
export { monadTestnet, type RegistryDeployment } from "./network";

export interface RegisterCapabilityInput {
  capabilityId: string; principal: string; agentId: string; policyHash: string;
  parentCapabilityId?: string; expiresAt: string;
}
export interface RegisterDelegationInput { parentCapabilityId: string; childCapabilityId: string; childAgentId: string }
export interface DisclosureReceiptAnchor { receiptId: string; capabilityId: string; requestHash: string; resultHash: string; decisionCode: number }
export interface TxResult { txHash: string; explorerUrl?: string }
/** An unsigned registry call for the principal's own wallet (e.g. MetaMask) to sign and send. */
export interface UnsignedRegistryCall { to: string; data: string }
export interface OnchainCapability {
  capabilityId: string; principal: string; agentIdHash: string; policyHash: string;
  parentCapabilityId?: string; expiresAt: string; status: CapabilityStatus;
}

export function toBytes32Id(id: string): string {
  if (!id || toUtf8Bytes(id).length > 128) throw new Error("IDs must contain 1–128 UTF-8 bytes");
  return keccak256(toUtf8Bytes(id));
}
function hash(value: string): string {
  if (!isHexString(value, 32)) throw new Error("Expected a 32-byte hex hash");
  return value;
}
function expiry(value: string): bigint {
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error("Expiry must be a valid timestamp");
  }
  // Round down so chain authorization never outlives the broker's millisecond expiry.
  return BigInt(Math.floor(milliseconds / 1000));
}
const statuses: CapabilityStatus[] = ["ACTIVE", "REVOKED", "EXPIRED", "COMPLETED"];

/** Writes wait for a successful mined receipt; reads always query the chain. */
export class ContextCapsContractClient {
  readonly contract: Contract;
  readonly explorerUrl?: string;
  private pendingWrite: Promise<void> = Promise.resolve();
  constructor(options: { address: string; runner: ContractRunner; explorerUrl?: string }) {
    this.contract = new Contract(getAddress(options.address), capabilityRegistryAbi, options.runner);
    this.explorerUrl = options.explorerUrl?.replace(/\/$/, "");
  }
  private write(method: string, args: unknown[]): Promise<TxResult> {
    // One signer may receive simultaneous broker requests. Serialize writes to
    // avoid nonce collisions, and keep the queue usable after a rejected write.
    const next = this.pendingWrite.then(async () => {
      const tx = await this.contract.getFunction(method)(...args) as ContractTransactionResponse;
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error(`Transaction failed: ${tx.hash}`);
      return { txHash: receipt.hash, ...(this.explorerUrl ? { explorerUrl: `${this.explorerUrl}/tx/${receipt.hash}` } : {}) };
    });
    this.pendingWrite = next.then(() => {}, () => {});
    return next;
  }
  private encode(method: string, args: unknown[]): UnsignedRegistryCall {
    return { to: String(this.contract.target), data: this.contract.interface.encodeFunctionData(method, args) };
  }
  private registerArgs(input: RegisterCapabilityInput): unknown[] {
    toBytes32Id(input.capabilityId);
    return [input.capabilityId, getAddress(input.principal), toBytes32Id(input.agentId),
      hash(input.policyHash), input.parentCapabilityId ? toBytes32Id(input.parentCapabilityId) : ZeroHash, expiry(input.expiresAt)];
  }
  registerCapability(input: RegisterCapabilityInput): Promise<TxResult> {
    return this.write("registerCapability", this.registerArgs(input));
  }
  revokeCapability(id: string): Promise<TxResult> { return this.write("revokeCapability", [toBytes32Id(id)]); }
  /** Calldata for the principal's wallet to register a root capability itself. */
  encodeRegisterCapability(input: RegisterCapabilityInput): UnsignedRegistryCall {
    return this.encode("registerCapability", this.registerArgs(input));
  }
  /** Calldata for the principal's wallet to revoke a capability itself. */
  encodeRevokeCapability(id: string): UnsignedRegistryCall { return this.encode("revokeCapability", [toBytes32Id(id)]); }
  completeCapability(id: string): Promise<TxResult> { return this.write("completeCapability", [toBytes32Id(id)]); }
  async getCapability(id: string): Promise<OnchainCapability | null> {
    const key = toBytes32Id(id);
    // Pin multi-call reads to one block so status and data cannot disagree during revocation.
    const provider = this.contract.runner?.provider;
    if (!provider) throw new Error("A provider is required for reads");
    const block = await provider.getBlock("latest");
    if (!block) throw new Error("Latest block unavailable");
    const options = { blockTag: block.number };
    const raw = await this.contract.getFunction("getCapability")(key, options);
    if (raw.principal === ZeroAddress) return null;
    const status = statuses[Number(await this.contract.getFunction("getCapabilityStatus")(key, options))];
    if (!status) throw new Error("Unknown on-chain capability status");
    const parentCapabilityId = raw.parentCapabilityId === ZeroHash ? undefined :
      await this.contract.getFunction("canonicalIds")(raw.parentCapabilityId, options) as string;
    return { capabilityId: id, principal: raw.principal, agentIdHash: raw.agentId, policyHash: raw.policyHash,
      parentCapabilityId, expiresAt: new Date(Number(raw.expiresAt) * 1000).toISOString(), status };
  }
  async isCapabilityActive(id: string): Promise<boolean> { return this.contract.getFunction("isActive")(toBytes32Id(id)); }
  registerDelegation(input: RegisterDelegationInput): Promise<TxResult> {
    return this.write("registerDelegation", [toBytes32Id(input.parentCapabilityId), toBytes32Id(input.childCapabilityId), toBytes32Id(input.childAgentId)]);
  }
  anchorDisclosureReceipt(input: DisclosureReceiptAnchor): Promise<TxResult> {
    if (!Number.isInteger(input.decisionCode) || input.decisionCode < 0 || input.decisionCode > 3) throw new Error("Invalid decision code");
    return this.write("anchorDisclosureReceipt", [toBytes32Id(input.receiptId), toBytes32Id(input.capabilityId), hash(input.requestHash), hash(input.resultHash), input.decisionCode]);
  }
}

export function createContractClient(options: { address: string; runner: ContractRunner; explorerUrl?: string }): ContextCapsContractClient {
  return new ContextCapsContractClient(options);
}

/** Server-side demo signer. User-facing production authorization requires wallet signing. */
export async function createContractClientFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<ContextCapsContractClient> {
  if (!env.CONTEXTCAPS_REGISTRY_ADDRESS || !env.MONAD_PRIVATE_KEY) throw new Error("Set CONTEXTCAPS_REGISTRY_ADDRESS and MONAD_PRIVATE_KEY");
  const provider = new JsonRpcProvider(env.MONAD_RPC_URL ?? monadTestnet.rpcUrl, undefined, { cacheTimeout: -1 });
  const chainId = Number((await provider.getNetwork()).chainId);
  if (chainId !== monadTestnet.chainId) throw new Error(`Expected Monad Testnet chain ${monadTestnet.chainId}, got ${chainId}`);
  const address = getAddress(env.CONTEXTCAPS_REGISTRY_ADDRESS);
  if (await provider.getCode(address) === "0x") throw new Error("No registry contract at configured address");
  return createContractClient({ address, runner: new Wallet(env.MONAD_PRIVATE_KEY, provider), explorerUrl: monadTestnet.explorerUrl });
}
