import type { SavedEntry } from './anywhere-storage.mjs';
export interface NavigationPublication { reference: string; address: string; readOnly: boolean; }
export declare const NAVIGATION_KEY: string;
export declare const NAVIGATION_STATE_KEY: string;
export declare const NAVIGATION_PARAM: string;
export declare const NAVIGATION_CAP: number;
export declare const NAVIGATION_ENTRY_BYTES: number;
export declare const NAVIGATION_TOTAL_BYTES: number;
export declare function navigationDayPresentation(dateIso: string, lang: string, now?: Date): { label: string; activeOffset: 0 | 1 | null };
export declare function navigationAddress(entry: SavedEntry, options?: { lang?: string; readOnly?: boolean; pathname?: string }): string;
export declare function saveNavigationPublication(storage: Storage, entry: SavedEntry, options: { address: string; readOnly?: boolean; crypto?: Crypto }): NavigationPublication | null;
export declare function navigationHistoryState(state: unknown, publication: NavigationPublication): Record<string, unknown>;
export declare function navigationHref(publication: NavigationPublication, lang: string): string;
export declare function readNavigationPublication(storage: Storage, options?: { pathname?: string; search?: string; state?: unknown; navigationType?: string | null }):
  { kind: 'absent' | 'invalid' } | { kind: 'restored'; entry: SavedEntry; publication: NavigationPublication };
