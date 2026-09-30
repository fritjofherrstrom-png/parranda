export interface MapBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FitMark {
  lat: number;
  lng: number;
  /** Footprint in px around the position the mark is drawn at. */
  radius?: number;
  /** Display offset from the coordinate, in px. */
  offsetX?: number;
  offsetY?: number;
  /** False for marks that only have to stay on the map (the route line's points). */
  avoidControls?: boolean;
}

export function paddingOptions(input: {
  width: number;
  height: number;
  keepouts?: MapBox[];
  edge?: number;
  gap?: number;
}): MapPadding[];

export function controlAwareView(input: {
  marks: FitMark[];
  width: unknown;
  height: unknown;
  keepouts?: MapBox[];
  edge?: number;
  gap?: number;
  minZoom?: number;
  maxZoom?: number;
  project: (mark: { lat: number; lng: number }, zoom: number) => { x: number; y: number };
  unproject: (point: { x: number; y: number }, zoom: number) => { lat: number; lng: number };
}): { center: { lat: number; lng: number }; zoom: number; padding: MapPadding } | null;
