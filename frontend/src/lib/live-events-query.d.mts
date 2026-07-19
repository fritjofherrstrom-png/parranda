export type LiveScope = "near_route" | "around_place" | "near_me";
export type LiveTimeKey = "tonight" | "week";

export interface Coord {
  lat: number;
  lng: number;
}

export declare function liveEventsTimeWindow(timeKey: LiveTimeKey | string): "tonight" | "this_week";

export declare function availableLiveScopes(context: {
  coordsAnchoredDay?: boolean;
  hasRoute?: boolean;
  routePointCount?: number;
}): LiveScope[];

export declare function buildLiveEventsQuery(input: {
  scope: LiveScope;
  time: LiveTimeKey | string;
  anchorCoord?: Coord | null;
  routePoints?: Array<Coord | null | undefined>;
  nearMeCoords?: Coord | null;
  preferences?: string[];
}):
  | {
      body: {
        scope: LiveScope;
        time: "tonight" | "this_week";
        preferences: string[];
        anchor?: Coord;
        route_points?: Coord[];
      };
      error?: undefined;
    }
  | { error: string; body?: undefined };
