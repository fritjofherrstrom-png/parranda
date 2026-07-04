export declare const LAST_KEY: string;
export declare const SAVED_KEY: string;
export declare const SAVED_CAP: number;

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
}

export declare function buildSavedEntry(options?: {
  place?: string;
  label?: string;
  dateIso?: string;
  savedAt?: string;
  safeResponse?: any;
  classification?: any;
  inputs?: SavedInputs;
}): SavedEntry;

export declare function upsertSaved(list: SavedEntry[] | null | undefined, entry: SavedEntry): SavedEntry[];

export declare function removeSaved(list: SavedEntry[] | null | undefined, id: string): SavedEntry[];
