import type { RoutePoint, WalkingRoutePart } from './maps-links.mjs';

export type ContinuationPosition = {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
};
export type WalkingContinuationPlan = {
  fromIndex: number;
  fromStop: RoutePoint;
  parts: WalkingRoutePart[];
};
export function buildWalkingContinuation(input?: {
  stops?: RoutePoint[] | null;
  position?: ContinuationPosition | null;
  enabled?: boolean;
  destination?: RoutePoint | null;
  now?: number;
}): WalkingContinuationPlan | null;
