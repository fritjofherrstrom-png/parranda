export type PlannerPreferenceKey = "food" | "culture" | "views" | "fika" | "nightlife" | "green" | "second_hand";
export declare const PLANNER_PREFERENCE_KEYS: readonly PlannerPreferenceKey[];
/** Ranked prefix of the selection in pick order, or [] when nothing is ranked. */
export declare function normalizePreferencePriority(value: unknown, selected: unknown): PlannerPreferenceKey[];

export interface PreferenceSelection {
  selected: PlannerPreferenceKey[];
  preferencePriority: PlannerPreferenceKey[];
}
export declare function togglePreferenceSelection(state: {
  selected?: unknown;
  preferencePriority?: unknown;
} | null | undefined, key: unknown): PreferenceSelection;

export interface DayEdit {
  version: 1;
  action: "replace" | "remove";
  candidate_id: string;
  retained_candidate_ids: string[];
  target_stop_count: number;
  slot_index: number;
  replacement_preference: PlannerPreferenceKey | null;
  removed_candidate_ids: string[];
  /** Only false is emitted canonically; absence/true preserves retained venues. */
  preserve_retained?: boolean;
}
/** Bounded canonical copy, or null for any malformed/unsupported edit. */
export declare function normalizeDayEdit(value: unknown): DayEdit | null;
