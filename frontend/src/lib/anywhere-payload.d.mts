export interface AnywherePreference {
  key: string;
  sv: string;
  en: string;
}

export declare const ANYWHERE_PREFERENCES: AnywherePreference[];

export interface DayRhythm {
  key: "calm" | "balanced" | "full" | "free";
  sv: string;
  en: string;
  /** What the engine does with this rhythm, in each language. */
  noteSv: string;
  noteEn: string;
}

export declare const DAY_RHYTHMS: DayRhythm[];

export declare function isoDateFromOffset(offsetDays?: number, from?: Date): string;
export declare function freezeComposeDateIso(options?: {
  dayOffset?: number;
  dateIsoOverride?: string | null;
  now?: Date;
}): string;

export declare function buildAnywherePayload(options?: {
  city?: string;
  place?: string;
  coords?: { lat: number; lng: number } | null;
  dates?: string[];
  preferences?: string[];
  dayRhythm?: "calm" | "balanced" | "full" | "free";
  excludedCandidateIds?: string[];
  pinnedCandidateIds?: string[];
}): {
  city?: string;
  place?: string;
  place_query?: string;
  excluded_candidate_ids?: string[];
  pinned_candidate_ids?: string[];
  lat?: number;
  lng?: number;
  dates: string[] | undefined;
  home_base: { type: string; label: string };
  start: { type: string; label: string };
  end: { type: string; label: string };
  day_rhythm: string;
  leg_pacing?: string;
  preferences: string[];
  distance_mode: string;
  budget_tier: string;
  experimental_agnostic_route_output?: number;
  include_external_candidates?: number;
  agnostic_engine_compose?: number;
};
