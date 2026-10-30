export function readPlannerEntry(search: string | URLSearchParams): {
  place: string;
  coords: { lat: number; lng: number } | null;
  near: boolean;
  restore: boolean;
  hasIntent: boolean;
};

export function readPublicDaySnapshotLink(search: string | URLSearchParams):
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "ready"; reference: string; lang: "en" | "sv" | null };
