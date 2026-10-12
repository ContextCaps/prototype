export const monadTestnet = {
  chainId: 10143,
  name: "Monad Testnet",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorerUrl: "https://testnet.monadscan.com",
  currency: "MON",
} as const;

export interface RegistryDeployment {
  chainId: number;
  address: string;
  receiptWriter: string;
  transactionHash: string;
  blockNumber: number;
  explorerUrl: string;
}
