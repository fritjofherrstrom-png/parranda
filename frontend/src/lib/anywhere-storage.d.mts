export declare const LAST_KEY: string;
export declare const SAVED_KEY: string;
export declare const SAVED_CAP: number;
export declare const DEFAULT_SAVED_WALK_KEY: "balanced";
export declare function normalizeSavedWalkKey(value?: unknown): "calm" | "balanced" | "full" | "free";

import type { CommitmentSnapshot } from "./commitment-snapshot.mjs";
import type { DayEdit } from "../../../shared/planner-intent.mjs";

export interface SavedInputs {
  city?: string | null;
  place?: string | null;
  placeLabel?: string | null;
  placeSelection?: string | null;
  placeRef?: string | null;
  mode?: string;
  dayOffset?: number;
  walkKey?: string;
  selected?: string[];
  preferencePriority?: string[] | null;
  liveSheetSort?: "for_you" | "by_time";
  dayEdit?: DayEdit | null;
  invalidDayEdit?: boolean;
  /** Set when the reader asked Parranda to choose the day's interests. */
  intentMode?: "parranda_chooses" | null;
}

export interface SavedEntry {
  id: string;
  label: string;
  place: string | null;
  dateIso: string | null;
  savedAt: string | null;
  safeResponse: any;
  classification: any;
  inputs: SavedInputs | null;
  /** The commitments this day answered. Null for days saved before this existed. */
  commitments: CommitmentSnapshot | null;
}

export declare function savedEntryAnchorKey(entry: SavedEntry | null): string | null;

export declare function isComposedEntry(entry: unknown): boolean;
export declare function isEditedEmptyEntry(entry: unknown): boolean;

export declare function savedEntryId(options?: {
  placeLabel?: string | null;
  city?: string | null;
  place?: string | null;
  dateIso?: string | null;
  selected?: string[];
  walkKey?: string | null;
  preferencePriority?: string[] | null;
  dayEdit?: DayEdit | null;
  invalidDayEdit?: boolean;
}): string;

export declare function buildSavedEntry(options?: {
  placeLabel?: string;
  city?: string | null;
  place?: string;
  label?: string;
  dateIso?: string;
  savedAt?: string;
  safeResponse?: any;
  classification?: any;
  inputs?: SavedInputs;
  commitments?: CommitmentSnapshot | null;
}): SavedEntry;

export declare function upsertSaved(list: SavedEntry[] | null | undefined, entry: SavedEntry): SavedEntry[];

export declare function removeSaved(list: SavedEntry[] | null | undefined, id: string): SavedEntry[];
