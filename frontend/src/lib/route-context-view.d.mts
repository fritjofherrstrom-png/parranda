export interface RouteContextStop {
  id?: string | null;
  place_id?: string | null;
  candidate_id?: string | null;
  name?: string | null;
  label?: string | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  area?: string | null;
  covered_preferences?: string[];
  partial_preferences?: string[];
  type?: string | null;
  tags?: string[];
  chain?: boolean;
  brand?: string | null;
  local_feel_rank?: number | null;
  candidate_origin?: string | null;
}

export interface RouteContextArea {
  daypart_hint?: string | null;
  covers?: string[];
  stops?: RouteContextStop[];
}

export interface RouteContextSuggestion extends RouteContextStop {
  /**
   * Whether the trusted routing path will accept a commitment to this exact
   * identity. Server-declared; absent means no.
   */
  commitment_eligible?: boolean;
  area_index: number;
  source_index: number;
  daypart_hint: string | null;
  covers: string[];
  route_stop_index: number;
  route_stop_name: string | null;
  distance_km: number;
}

export declare function buildRouteContextSuggestions(
  routeStops: RouteContextStop[] | null | undefined,
  areas: RouteContextArea[] | null | undefined,
  options?: { limit?: number; maxDistanceKm?: number },
): RouteContextSuggestion[];

export declare function walkingDistanceLabel(km: number | null | undefined, lang?: "sv" | "en"): string;

export interface RoutePreferenceCoverage {
  has_coverage_evidence: boolean;
  covered_preferences: string[];
  partial_preferences: string[];
  missing_preferences: string[];
}

export declare function routePreferenceCoverage(
  routeStops: RouteContextStop[] | null | undefined,
  requestedPreferences: string[] | null | undefined,
): RoutePreferenceCoverage;

export type RouteTimeAnchoring = "full_arc_not_now" | "anchored_trimmed" | null;

export declare function routeTimeAnchoring(
  primaryRoute: { caveats?: string[]; anchored_to_local_time?: boolean } | null | undefined,
): RouteTimeAnchoring;
