import type { SelectedDayHoursFact } from "./selected-day-hours.mjs";

export interface StopCardFactsInput {
  type?: string | null;
  source?: { category?: string | null } | null;
  selected_day_hours?: SelectedDayHoursFact | null;
}

export function stopTypeLabel(stop: StopCardFactsInput | null | undefined, lang?: "sv" | "en"): string;
export function stopHoursUnknown(stop: StopCardFactsInput | null | undefined): boolean;
