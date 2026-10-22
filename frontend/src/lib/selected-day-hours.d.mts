export interface SelectedDayHoursFact {
  status?: string;
  all_day?: boolean;
  windows?: Array<{ opens?: string; closes?: string }>;
  ordinary_status?: "known" | "closed";
  ordinary_windows?: Array<{ opens?: string; closes?: string }>;
  uncertainty?: "holiday_exceptions" | "unresolved_conditions";
  date?: string;
  timezone?: string;
  source_url?: string;
  observed_at?: string;
}

export function selectedDayHoursLabel(value: SelectedDayHoursFact | null | undefined, lang?: "sv" | "en"): string | null;
