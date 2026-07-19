export type LiveEventScope = "around_place" | "near_route" | "near_me";
export type LiveEventTime = "tonight" | "this_week";

export declare const LIVE_EVENT_QUERY_CONTRACT: "live_event_query_v1";
export declare const LIVE_EVENT_SCOPES: LiveEventScope[];
export declare const LIVE_EVENT_TIMES: LiveEventTime[];

export declare function trustedDayAnchor(response: unknown): { lat: number; lng: number } | null;
export declare function boundedRoutePoints(
  stops: unknown,
  limit?: number,
): Array<{ lat: number; lng: number }>;
export declare function buildLiveEventQueryPayload(options?: {
  scope?: LiveEventScope;
  time?: LiveEventTime;
  preferences?: string[];
  response?: unknown;
  routeStops?: unknown[];
  nearMeCoords?: { lat: number; lng: number } | null;
}):
  | {
      scope: LiveEventScope;
      time: LiveEventTime;
      preferences: string[];
      anchor?: { lat: number; lng: number };
      route_points?: Array<{ lat: number; lng: number }>;
    }
  | null;
export declare function acceptedLiveEventQuery(response: unknown): unknown | null;
