import type { SelectedDayHoursFact } from "./selected-day-hours.mjs";

export interface StopCardFactsInput {
  type?: string | null;
  covered_preferences?: string[] | null;
  partial_preferences?: string[] | null;
  source?: { category?: string | null } | null;
  website?: string | null;
  address?: string | null;
  place_details?: { kind?: string | null; address?: string | null } | null;
  selected_day_hours?: SelectedDayHoursFact | null;
}

export function stopTypeLabel(stop: StopCardFactsInput | null | undefined, lang?: "sv" | "en"): string;
export function stopHoursUnknown(stop: StopCardFactsInput | null | undefined): boolean;
export function stopWebsiteUrl(stop: StopCardFactsInput | null | undefined): string | null;

export function stopMatchedPreferences(stop: StopCardFactsInput | null | undefined, selected: string[] | null | undefined): string[];

export function stopPlaceDetails(stop: StopCardFactsInput | null | undefined, lang?: "sv" | "en"): { kindLabel: string | null; address: string | null };
