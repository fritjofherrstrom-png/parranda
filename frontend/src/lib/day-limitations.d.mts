export function limitationNote(
  limitations: string[] | null | undefined,
  stopCount: number | null | undefined,
  t: (sv: string, en: string) => string,
  options?: { placesStillArriving?: boolean },
): string;

export function contextNote(
  limitations: string[] | null | undefined,
  t: (sv: string, en: string) => string,
  options?: { statedElsewhere?: string[]; sourceCompletion?: { status?: string; pending?: number } | null },
): string;

export function placesStillArriving(sourceCompletion: { status?: string; pending?: number } | null | undefined): boolean;
