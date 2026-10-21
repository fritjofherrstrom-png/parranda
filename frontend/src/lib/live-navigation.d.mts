export type LiveSheetSort = 'for_you' | 'by_time';

export interface LiveNavigationRow<E extends object> {
  /** Exact supplied occurrence, or a source_program display container whose
   * occurrences are the exact supplied slots on this local date. No generated
   * source or choice identity. */
  event: E;
  /** Original grouped parent (explicit source series or display-only programme). */
  series: E | null;
  kind: 'date' | 'range' | 'undated';
  date: string | null;
  clock: string | null;
  endClock: string | null;
}

export declare function liveNavigationGroups<E extends object>(
  events: readonly E[] | null | undefined,
  moreEvents: readonly E[] | null | undefined,
  options?: { sort?: LiveSheetSort; selectedPreferences?: readonly string[] },
): {
  picks: E[];
  other: E[];
  more: E[];
  dates: Array<{ date: string; rows: LiveNavigationRow<E>[] }>;
  ranges: LiveNavigationRow<E>[];
  undated: LiveNavigationRow<E>[];
};

export declare function liveEventTags(event: object | null | undefined): string[];
