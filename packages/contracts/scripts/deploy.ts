import { ContractFactory, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { mkdirSync, writeFileSync } from "node:fs";
import { compileRegistry } from "./compile";
import { monadTestnet, type RegistryDeployment } from "../../contract-sdk/src/network";

const key = process.env.MONAD_PRIVATE_KEY;
if (!key) throw new Error("Set MONAD_PRIVATE_KEY in .env (funded Monad Testnet wallet)");
const provider = new JsonRpcProvider(process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrl);
try {
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(monadTestnet.chainId)) throw new Error("Deployment requires Monad Testnet");
  const signer = new Wallet(key, provider);
  const writer = getAddress(process.env.CONTEXTCAPS_RECEIPT_WRITER || signer.address);
  const artifact = compileRegistry();
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(writer);
  await contract.waitForDeployment();
  const receipt = await contract.deploymentTransaction()!.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Deployment failed");
  const address = await contract.getAddress();
  const deployment: RegistryDeployment = { chainId: monadTestnet.chainId, address, receiptWriter: writer,
    transactionHash: receipt.hash, blockNumber: receipt.blockNumber, explorerUrl: `${monadTestnet.explorerUrl}/address/${address}` };
  const dir = new URL("../deployments/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("monad-testnet.json", dir), JSON.stringify({ ...deployment, abi: artifact.abi }, null, 2) + "\n");
  console.log(JSON.stringify(deployment, null, 2));
  console.log(`Set CONTEXTCAPS_REGISTRY_ADDRESS=${address}`);
} finally { provider.destroy(); }
