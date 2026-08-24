export declare const LAST_KEY: string;
export declare const SAVED_KEY: string;
export declare const SAVED_CAP: number;
export declare const DEFAULT_SAVED_WALK_KEY: "balanced";
export declare function normalizeSavedWalkKey(value?: unknown): "short" | "balanced" | "long";

import type { CommitmentSnapshot } from "./commitment-snapshot.mjs";

export interface SavedInputs {
  place?: string | null;
  mode?: string;
  dayOffset?: number;
  walkKey?: string;
  selected?: string[];
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

export declare function savedEntryId(options?: {
  place?: string | null;
  dateIso?: string | null;
  selected?: string[];
  walkKey?: string | null;
}): string;

export declare function buildSavedEntry(options?: {
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
