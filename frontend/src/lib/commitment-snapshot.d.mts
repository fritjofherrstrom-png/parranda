export type CommitmentKind = "exclude" | "pin";
export type CommitmentEntry = { kind: CommitmentKind; label: string };
export type AppliedPin = { id: string; kind: "pin"; label: string };
export type AppliedRefusal = { id: string; reason: string };

export const COMMITMENT_SNAPSHOT_VERSION: number;
export const MAX_SNAPSHOT_PINS: number;
export const MAX_SNAPSHOT_EXCLUSIONS: number;

export interface CommitmentSnapshot {
  version: number;
  anchorKey: string;
  dayKey: string;
  entries: Record<string, CommitmentEntry>;
  appliedPins: AppliedPin[];
  refusals: AppliedRefusal[];
}

export function buildCommitmentSnapshot(params: {
  anchorKey?: string | null;
  dayKey?: string | null;
  entries?: Record<string, CommitmentEntry>;
  appliedPins?: AppliedPin[];
  refusals?: Array<{ id: string; reason: string | null }>;
}): CommitmentSnapshot | null;

export function readCommitmentSnapshot(
  snapshot: unknown,
  params: { anchorKey?: string | null; dayKey?: string | null },
): {
  applies: boolean;
  reason: string;
  entries: Record<string, CommitmentEntry>;
  appliedPins: AppliedPin[];
  refusals: AppliedRefusal[];
};
