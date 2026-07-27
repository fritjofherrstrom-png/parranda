export interface SelectedDayHoursFact {
  status?: string;
  all_day?: boolean;
  windows?: Array<{ opens?: string; closes?: string }>;
}

export function selectedDayHoursLabel(value: SelectedDayHoursFact | null | undefined, lang?: "sv" | "en"): string | null;
