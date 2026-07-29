export interface RouteMapPoint {
  lat?: number | null;
  lng?: number | null;
}

export interface RouteMarkerPresentation {
  shift_x_px: number;
  shift_y_px: number;
  clustered: boolean;
}

export function routeMarkerPresentation(
  stops: RouteMapPoint[] | null | undefined,
  options?: { collisionDistanceKm?: number; radiusPx?: number },
): RouteMarkerPresentation[];
