/** Resolve only the explicitly chosen wallet; disconnects never select another signer. */
export function resolveSigningWallet<T extends { address: string }>(wallets: readonly T[], selection: string | null, enabled: boolean, embeddedAddress?: string): T | null {
  if (!enabled || !selection) return null;
  const address = selection === "embedded" ? embeddedAddress : selection;
  if (!address) return null;
  return wallets.find((wallet) => wallet.address.toLowerCase() === address.toLowerCase()) ?? null;
}
