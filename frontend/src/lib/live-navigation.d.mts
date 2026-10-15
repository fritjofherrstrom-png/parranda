export type LiveSheetSort = 'for_you' | 'by_time';

export interface LiveNavigationRow<E extends object> {
  /** Exact supplied occurrence object; never a generated source identity. */
  event: E;
  /** The original grouped parent, when the row belongs to supplied occurrences. */
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
