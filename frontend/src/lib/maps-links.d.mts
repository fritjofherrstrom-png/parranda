export interface MapStop {
  id?: string | null;
  name?: string | null;
  lat: number;
  lng: number;
}

export declare function mapsPlaceUrl(stop: { lat?: number; lng?: number } | null | undefined): string | null;

export declare function mapsWalkingRouteUrl(stops: Array<{ lat?: number; lng?: number }> | null | undefined): string | null;

export declare function dayStops(
  day: { areas?: Array<{ stops?: MapStop[] }> } | null | undefined,
): MapStop[];

export declare function primaryRouteStops(
  response:
    | {
        days?: Array<{
          primary_route?: {
            main_stops?: MapStop[];
          };
        }>;
      }
    | null
    | undefined,
): MapStop[];
