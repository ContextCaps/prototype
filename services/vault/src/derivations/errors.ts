/** Raised when derivation parameters are malformed or unsupported. Never carries private data. */
export class DerivationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DerivationError";
    this.code = code;
  }
}

export function parseInstant(value: unknown, field: string): Date {
  if (typeof value !== "string" || value.length === 0) {
    throw new DerivationError("INVALID_PARAMETER", `${field} must be an ISO date string`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DerivationError("INVALID_PARAMETER", `${field} is not a valid date`);
  }
  return date;
}
