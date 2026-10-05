/**
 * The commitment ledger's shape, and the one rule every Add control obeys.
 *
 * The ledger itself — who may write it, when it is scoped, what a request
 * sends — belongs to the orchestrator (AnywherePlanner.tsx). Pieces that only
 * render it read this type.
 */
export type Commitments = Record<string, { kind: "exclude" | "pin"; label: string }>;

/**
 * A NEW commitment needs the server's explicit permission. Only an explicit
 * `true` is permission — not truthiness, which would let a string, a number or
 * an object read as a yes. A commitment already held keeps its way out
 * regardless (the call sites check the ledger first).
 */
export function canCommitTo(stop: { commitment_eligible?: unknown } | null | undefined): boolean {
  return stop?.commitment_eligible === true;
}
