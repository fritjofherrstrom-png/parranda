export declare function walkingTargetLabel(targetKm: number, lang?: "sv" | "en"): string;

export declare function walkingTargetNotes(input?: {
  route?: {
    walking_target_fit?: {
      status?: string | null;
      target_km?: number | null;
      estimated_km?: number | null;
    } | null;
    live_event_stop?: { base_estimated_km?: number | null } | null;
  } | null;
  interrupt?: {
    status?: string | null;
    route_mutation?: boolean;
    reasons?: string[];
    event?: { title?: string | null } | null;
    walking_impact?: {
      leg_km?: number | null;
      estimated_km?: number | null;
      walking_target_km?: number | null;
      auto_weave_limit_km?: number | null;
    } | null;
  } | null;
  lang?: "sv" | "en";
}): string[];
