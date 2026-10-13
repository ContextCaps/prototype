/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_PRINCIPAL?: string;
  readonly VITE_PRIVY_APP_ID?: string;
  readonly VITE_WALLET_PROVIDER?: "injected" | "privy";
  /** Envio indexer GraphQL endpoint (indexer/); enables the on-chain history panel. */
  readonly VITE_ENVIO_GRAPHQL_URL?: string;
}
