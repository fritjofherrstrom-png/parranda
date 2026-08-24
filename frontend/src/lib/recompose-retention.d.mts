export function anchorKey(anchor: { place?: string; coords?: { lat: number; lng: number } | null } | null): string | null;

export function planRecomposeRetention(params: {
  silent?: boolean;
  previousStatus?: string | null;
  previousAnchorKey?: string | null;
  nextAnchorKey?: string | null;
}): { keepPrevious: boolean; reason: string };

export type Commitment = { kind: "exclude" | "pin"; label: string };

export function scopeCommitmentsToAnchor(params: {
  entries?: Record<string, Commitment>;
  ledgerAnchorKey?: string | null;
  nextAnchorKey?: string | null;
}): {
  entries: Record<string, Commitment>;
  excludedIds: string[];
  pinnedIds: string[];
  applies: boolean;
};

export function unhonouredPins(params: {
  entries?: Record<string, Commitment>;
  pinnedIds?: string[];
  stopIds?: string[];
  isStale?: boolean;
  serverReasons?: Array<{ id: string; reason: string | null }>;
}): {
  labels: string[];
  count: number;
  reasons: Array<{ id: string; label: string; reason: string | null }>;
};

export function staleDayNotice(params: {
  isStale?: boolean;
  phase?: "idle" | "loading" | "done" | "error";
}): "updating" | "update_failed" | null;
