export type LineProgress =
  | { state: "at"; index: number }
  | { state: "toward"; next: number; toNextKm: number }
  | { state: "off" };

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number;

export function lineProgress(
  stations: Array<{ lat?: number | null; lng?: number | null } | null | undefined> | null | undefined,
  position: { lat: number; lng: number } | null | undefined,
  options?: { atStationKm?: number; offLineKm?: number },
): LineProgress | null;
