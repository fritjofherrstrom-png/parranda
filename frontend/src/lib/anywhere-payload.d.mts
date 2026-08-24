export interface AnywherePreference {
  key: string;
  sv: string;
  en: string;
}

export declare const ANYWHERE_PREFERENCES: AnywherePreference[];

export interface WalkPreset {
  key: string;
  km: number;
  sv: string;
  en: string;
}

export declare const WALK_PRESETS: WalkPreset[];

export declare function isoDateFromOffset(offsetDays?: number, from?: Date): string;
export declare function freezeComposeDateIso(options?: {
  dayOffset?: number;
  dateIsoOverride?: string | null;
  now?: Date;
}): string;

export declare function buildAnywherePayload(options?: {
  place?: string;
  coords?: { lat: number; lng: number } | null;
  dates?: string[];
  preferences?: string[];
  walkingKmTarget?: number;
  excludedCandidateIds?: string[];
  pinnedCandidateIds?: string[];
}): {
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
  walking_km_target: number;
  leg_pacing: string;
  preferences: string[];
  distance_mode: string;
  budget_tier: string;
  experimental_agnostic_route_output: number;
  include_external_candidates: number;
  agnostic_engine_compose: number;
};
