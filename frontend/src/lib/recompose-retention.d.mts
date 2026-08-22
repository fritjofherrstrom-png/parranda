export function anchorKey(anchor: { place?: string; coords?: { lat: number; lng: number } | null } | null): string | null;

export function planRecomposeRetention(params: {
  silent?: boolean;
  previousStatus?: string | null;
  previousAnchorKey?: string | null;
  nextAnchorKey?: string | null;
}): { keepPrevious: boolean; reason: string };

export function scopeExcludedToAnchor(params: {
  ids?: string[];
  ledgerAnchorKey?: string | null;
  nextAnchorKey?: string | null;
}): { ids: string[]; applies: boolean };

export function staleDayNotice(params: {
  isStale?: boolean;
  phase?: "idle" | "loading" | "done" | "error";
}): "updating" | "update_failed" | null;
