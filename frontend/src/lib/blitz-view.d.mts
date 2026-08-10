export interface BlitzMoveView {
  key: string | null;
  kind: "place" | "live_event";
  title: string;
  type: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  walking_minutes: number | null;
  starts_in_minutes: number | null;
  starts_at: string | null;
  ends_at: string | null;
  starts_on: string | null;
  ends_on: string | null;
  timezone: string | null;
  time_window: Record<string, unknown> | null;
  covered_preferences: string[];
  partial_preferences: string[];
  source: { label: string | null; url: string | null; source_kind: string | null };
}

export interface AnywhereBlitzView {
  state: "available" | "blocked" | "invalid";
  best: BlitzMoveView | null;
  backup: BlitzMoveView | null;
  live_option: BlitzMoveView | null;
  confidence_level: string | null;
  time_band?: string | null;
  timezone_known?: boolean;
}

export declare function anywhereBlitzView(response: unknown): AnywhereBlitzView;
export declare const ANYWHERE_BLITZ_CONTRACT: "anywhere_contextual_blitz_v1";
