import type { SavedEntry } from './anywhere-storage.mjs';
import type { CommitmentEntry } from './commitment-snapshot.mjs';
import type { DayEdit } from '../../../shared/planner-intent.mjs';
export declare function urlEntryCommitments(entry: SavedEntry | null, context?: {
  navigationType?: string;
  anchor?: { place?: string; selectionLabel?: string; placeRef?: string | null; coords?: { lat: number; lng: number } };
  dateIso?: string;
  selected?: string[];
  walkKey?: string;
  preferencePriority?: string[] | null;
  dayEdit?: DayEdit | null;
  invalidDayEdit?: boolean;
}): { applies: boolean; entries: Record<string, CommitmentEntry> };
