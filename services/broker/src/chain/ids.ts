import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Reference mapping from a canonical application ID (e.g. "cap_0001",
 * "rcpt_…", "travel-agent") to a Solidity bytes32: keccak256(UTF-8(id)).
 *
 * The broker domain keeps string IDs everywhere. Only the chain adapter /
 * contract SDK applies this encoding, so policy code never sees bytes32.
 * Hashes that are already 32 bytes (policyHash, requestHash, resultHash) are
 * passed through unchanged.
 */
export function toBytes32Id(applicationId: string): `0x${string}` {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(applicationId)))}`;
}
