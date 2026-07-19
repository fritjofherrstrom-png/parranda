// Type surface for pulse-view.mjs (the .mjs is the source of truth).
// Structurally generic: callers keep their own stop/event types (e.g. MapStop)
// — no index signatures required, no `any` at the component boundary.

export interface PulseTimeWindow {
  kind?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  local_start?: string | null;
  local_end?: string | null;
  timezone?: string | null;
}

// `T extends object` (not `{ is_live_event?: … }`): the discriminant fields are
// optional on every caller type, and TS's weak-type check would otherwise reject
// stop types that don't mention them at all (e.g. MapStop). The runtime reads
// `is_live_event`/`event_id` defensively either way.
export declare function splitRouteStops<T extends object>(
  stops: readonly T[] | null | undefined,
): { core: T[]; woven: T[] };

export declare function wovenEventIds(stops: readonly object[] | null | undefined): Set<string>;

export declare function pulseEventBuckets<E extends object>(
  liveEvents: { tonight?: E[]; this_week?: E[] } | null | undefined,
  wovenIds?: Set<string>,
): { tonight: E[]; thisWeek: E[] };

export declare function eventTiming(
  ev:
    | {
        starts_at?: string | null;
        ends_at?: string | null;
        starts_on?: string | null;
        ends_on?: string | null;
        timezone?: string | null;
        time_window?: PulseTimeWindow | null;
      }
    | null
    | undefined,
  lang: "sv" | "en",
  now?: Date,
): string;

export declare function pulseHealthState(
  liveEvents:
    | {
        coverage?: string;
        pending?: boolean;
        acquisition?: { source_health?: { status?: string; result?: string; reasons?: string[] } | null } | null;
      }
    | null
    | undefined,
  buckets: { tonight: unknown[]; thisWeek: unknown[] } | null | undefined,
): "hidden" | "uncovered" | "pending" | "unavailable" | "partial" | "ok" | "rejected_empty" | "soft_empty";

export declare function clothingAdvice(
  observed: { max_temp?: number; condition?: string; precipitation_probability_max?: number } | null | undefined,
  lang: "sv" | "en",
): { headline: string; advice: string } | null;

export declare function pulseSourceLine(
  liveEvents:
    | {
        feeds?: Array<{ label?: string; license?: string | null }>;
        feed?: { label?: string; license?: string | null } | null;
      }
    | null
    | undefined,
): string | null;
