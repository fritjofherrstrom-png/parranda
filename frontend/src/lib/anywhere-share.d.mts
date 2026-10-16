import type { PlannerPreferenceKey, DayEdit } from "../../../shared/planner-intent.mjs";

export interface ShareInputs {
  city?: string | null;
  place?: string;
  placeRef?: string | null;
  preferences?: string[];
  preferencePriority?: string[] | null;
  dayEdit?: DayEdit | null;
  invalidDayEdit?: boolean;
  dayOffset?: number;
  walkKey?: string;
  lang?: string;
}

export declare function validPlaceRef(value: unknown): string | null;

export declare function encodeShareParams(inputs?: ShareInputs): string;

export declare function buildShareUrl(origin: string, inputs: ShareInputs): string;
export declare function shareablePlace(inputs?: { place?: string | null; placeLabel?: string | null } | null): string | null;

export declare function decodeShareParams(
  search: string | URLSearchParams,
  allowedPrefKeys?: string[] | null,
): { city: string | null; place: string; placeRef: string | null; invalidPlaceRef: boolean; preferences: string[]; preferencePriority?: PlannerPreferenceKey[]; dayEdit?: DayEdit | null; invalidDayEdit?: boolean; dayOffset: 0 | 1; walkKey: string; lang: "sv" | "en" | null };
