/**
 * Read-only client for the Envio indexer (indexer/). It returns what Monad
 * itself recorded for a principal, independent of broker memory, so the audit
 * trail survives broker restarts. Disabled unless VITE_ENVIO_GRAPHQL_URL is set.
 */
const ENDPOINT = import.meta.env.VITE_ENVIO_GRAPHQL_URL?.trim() || "";

export const envioEnabled = ENDPOINT.length > 0;

export interface IndexedReceipt {
  id: string;
  decision: "DENY" | "DERIVE" | "SELECT" | "TOOL_BOUND" | "UNKNOWN";
  txHash: string;
  anchoredAt: string;
}

export interface IndexedCapability {
  id: string;
  agent: string;
  status: "ACTIVE" | "REVOKED" | "COMPLETED";
  depth: number;
  expiresAt: string;
  registeredAt: string;
  registeredTx: string;
  revokedTx: string | null;
  receiptCount: number;
  denyCount: number;
  receipts: IndexedReceipt[];
}

const HISTORY_QUERY = `
  query History($principal: String!) {
    Capability(where: { principal: { _eq: $principal } }, order_by: { registeredBlock: desc }, limit: 12) {
      id agent status depth expiresAt registeredAt registeredTx revokedTx receiptCount denyCount
      receipts(order_by: { anchoredBlock: asc }) { id decision txHash anchoredAt }
    }
  }
`;

export async function fetchHistory(principal: string): Promise<IndexedCapability[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: HISTORY_QUERY, variables: { principal: principal.toLowerCase() } }),
  });
  if (!res.ok) throw new Error(`Indexer returned ${res.status}.`);
  const json = (await res.json()) as { data?: { Capability?: IndexedCapability[] }; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors[0]!.message);
  return json.data?.Capability ?? [];
}
