export interface RouteMapPoint {
  lat?: number | null;
  lng?: number | null;
}

export interface RouteMarkerPresentation {
  shift_x_px: number;
  shift_y_px: number;
  clustered: boolean;
}

export function routePathIsSketch(
  pathPoints: RouteMapPoint[] | null | undefined,
  stopCount: number | null | undefined,
): boolean;

export function routeMarkerPresentation(
  stops: RouteMapPoint[] | null | undefined,
  options?: { collisionDistanceKm?: number; radiusPx?: number },
): RouteMarkerPresentation[];

export function screenMarkerPresentation(
  points: Array<{ x: number; y: number }>,
  options: { width: number; height: number; keepouts?: Array<{ left: number; top: number; right: number; bottom: number }>; radius?: number; gap?: number },
): RouteMarkerPresentation[] | null;
