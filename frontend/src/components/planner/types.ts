/**
 * Shapes the planner reads from `/api/route-recommendations` and
 * `/api/live-events`. Every field is optional because the server may omit it;
 * the surface renders only what is present and never fills a gap itself.
 */
import type { EventSourceLinkKind, PulseTimeWindow } from "../../lib/pulse-view.mjs";

export interface DistrictArea {
  center?: { lat: number; lng: number } | null;
  daypart_hint?: string | null;
  covers?: string[];
  stop_names?: string[];
  stops?: Array<{
    id?: string | null;
    place_id?: string | null;
    candidate_id?: string | null;
    name?: string | null;
    lat: number;
    lng: number;
    address?: string | null;
    area?: string | null;
    /**
     * Whether the trusted routing path will accept a commitment to this exact
     * identity. Server-declared; absent means no.
     */
    commitment_eligible?: boolean;
  }>;
  stop_ids?: string[];
}

export interface PlaceStructure {
  provenance?: string;
  area_count?: number;
  district_day?: {
    areas?: DistrictArea[];
    legs?: Array<{ distance_km?: number | null }>;
    covered_intents?: string[];
    missing_intents?: string[];
    evening_event?: {
      title?: string | null;
      starts_at?: string | null;
      place?: string | null;
      source_label?: string | null;
      source_url?: string | null;
      source_link_kind?: EventSourceLinkKind | null;
      source_link_host?: string | null;
      woven_into_route?: boolean;
      route_leg_km?: number | null;
    } | null;
  };
}

export interface PulseEvent {
  id?: string;
  title?: string;
  starts_at?: string;
  ends_at?: string;
  starts_on?: string;
  ends_on?: string;
  time_window?: PulseTimeWindow | null;
  place?: string;
  /** The reviewed feed that listed the event — attribution, not the link's destination. */
  source_label?: string;
  source_url?: string;
  /** Server classification of where `source_url` leads (site root or other page). */
  source_link_kind?: EventSourceLinkKind | null;
  source_link_host?: string | null;
  timezone?: string;
  live_proximity?: "nearby";
  anchor_distance_km?: number;
  // The server's preference fit for this row, in canonical intents.
  preference_match?: string;
  requested_preferences?: string[];
  matched_preferences?: string[];
  partial_preferences?: string[];
  highlight_reason?: string;
}

export interface LiveSourceHealth {
  status?: string;
  result?: string;
  reasons?: string[];
  selected_source_count?: number;
  responding_source_count?: number;
  event_bearing_source_count?: number;
  empty_source_count?: number;
  failed_source_count?: number;
  unavailable_source_count?: number;
  raw_event_count?: number;
  normalized_event_count?: number;
  accepted_event_count?: number;
  surfaced_event_count?: number;
  rejected_event_count?: number;
}

export interface LiveEvents {
  selected_date?: string;
  coverage?: string;
  pending?: boolean;
  feed?: { label?: string; license?: string } | null;
  feeds?: Array<{ label?: string; license?: string | null }>;
  acquisition?: { source_health?: LiveSourceHealth | null } | null;
  tonight?: PulseEvent[];
  this_week?: PulseEvent[];
  browse?: {
    contract?: string;
    max_rows_per_bucket?: number;
    tonight?: { ranked_event_count?: number; highlight_count?: number; more_count?: number; hidden_count?: number; more?: PulseEvent[] };
    this_week?: { ranked_event_count?: number; highlight_count?: number; more_count?: number; hidden_count?: number; more?: PulseEvent[] };
  };
}

/** Which sources could not be fetched, as `liveSourceFailure` reports it. */
export interface LiveFailure {
  selected: number;
  responding: number;
}
