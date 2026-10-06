export function readPlannerEntry(search: string | URLSearchParams): {
  place: string;
  coords: { lat: number; lng: number } | null;
  near: boolean;
  restore: boolean;
  hasIntent: boolean;
};
