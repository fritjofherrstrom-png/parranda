import type { SavedEntry } from './anywhere-storage.mjs';
import type { CommitmentEntry } from './commitment-snapshot.mjs';
export declare function urlEntryCommitments(entry: SavedEntry | null, context?: {
  navigationType?: string;
  anchor?: { place?: string; selectionLabel?: string; placeRef?: string | null; coords?: { lat: number; lng: number } };
  dateIso?: string;
  selected?: string[];
  walkKey?: string;
}): { applies: boolean; entries: Record<string, CommitmentEntry> };
