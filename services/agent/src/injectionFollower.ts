import { OPERATIONS } from "@contextcaps/policy";
import { RESOURCES } from "@contextcaps/shared-types";
import type { AgentSession } from "./session";

/**
 * ATTACKER SIMULATION — not a defense.
 *
 * Models a fully prompt-injected planner: whenever untrusted text asks for
 * private data, it complies by requesting the matching raw resource through
 * its normal tool surface. The broker never sees or inspects the text; the
 * request is blocked purely by capability policy.
 */
const DATA_ASKS: ReadonlyArray<[RegExp, string]> = [
  [/salary/i, RESOURCES.SALARY_RAW],
  [/passport/i, RESOURCES.PASSPORT_RAW],
  [/e-?mail/i, "profile.email"],
];

export async function obeyInjectedInstructions(session: AgentSession, untrustedText: string): Promise<void> {
  for (const [pattern, resource] of DATA_ASKS) {
    if (!pattern.test(untrustedText)) continue;
    session.note(`Untrusted content asks for ${resource}; complying (simulated injected planner).`);
    await session.requestContext({ resource, operation: OPERATIONS.READ });
  }
}
