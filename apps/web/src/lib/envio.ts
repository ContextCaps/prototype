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
  parent_id: string | null;
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
      id agent status depth parent_id expiresAt registeredAt registeredTx revokedTx receiptCount denyCount
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
  return groupUnderParents(json.data?.Capability ?? []);
}

/** Newest grants first, each delegated child listed directly under its parent. */
function groupUnderParents(rows: IndexedCapability[]): IndexedCapability[] {
  const ids = new Set(rows.map((row) => row.id));
  const childrenOf = new Map<string, IndexedCapability[]>();
  for (const row of rows) {
    if (row.parent_id && ids.has(row.parent_id)) childrenOf.set(row.parent_id, [...(childrenOf.get(row.parent_id) ?? []), row]);
  }
  const ordered: IndexedCapability[] = [];
  const visit = (row: IndexedCapability) => {
    ordered.push(row);
    for (const child of childrenOf.get(row.id) ?? []) visit(child);
  };
  for (const row of rows) if (!row.parent_id || !ids.has(row.parent_id)) visit(row);
  return ordered;
}
