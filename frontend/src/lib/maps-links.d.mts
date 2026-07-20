export interface MapStop {
  id?: string | null;
  name?: string | null;
  label?: string | null;
  address?: string | null;
  area?: string | null;
  lat: number;
  lng: number;
}

export declare function mapsPlaceUrl(
  stop: {
    name?: string | null;
    label?: string | null;
    address?: string | null;
    area?: string | null;
    lat?: number;
    lng?: number;
  } | null | undefined,
  placeContext?: string | null,
): string | null;

export declare function mapsWalkingRouteUrl(
  stops: Array<{ lat?: number; lng?: number }> | null | undefined,
  options?: {
    origin?: { lat?: number; lng?: number } | null;
    destination?: { lat?: number; lng?: number } | null;
  },
): string | null;

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
