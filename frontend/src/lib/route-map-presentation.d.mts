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

export interface RouteMapPin {
  /** Stop indices this pin stands for; one for a stop's own pin. */
  members: number[];
  /** Where the pin is drawn, in container pixels. */
  x: number;
  y: number;
  /** Offset from the members' centre (a single stop: its own coordinate). */
  shift_x_px: number;
  shift_y_px: number;
  /** Outside the view: drawn at its coordinate, not placed. */
  offscreen?: boolean;
}

export function screenPinPresentation(
  points: Array<{ x: number; y: number }>,
  options: {
    width: number;
    height: number;
    keepouts?: Array<{ left: number; top: number; right: number; bottom: number }>;
    radius?: number;
    gap?: number;
    mergeDistance?: number;
    maxShift?: number;
    previous?: Map<string, { dx: number; dy: number }> | null;
    /** False keeps every stop's own number (the fitted view and closer). */
    grouping?: boolean;
  },
): RouteMapPin[] | null;

export function pinGroupLabel(members: number[]): string;
