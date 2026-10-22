export function limitationNote(
  limitations: string[] | null | undefined,
  stopCount: number | null | undefined,
  t: (sv: string, en: string) => string,
  options?: { sourcesIncomplete?: boolean },
): string;

export function contextNote(
  limitations: string[] | null | undefined,
  t: (sv: string, en: string) => string,
  options?: { statedElsewhere?: string[]; sourceCompletion?: { status?: string; pending?: number; failed?: number } | null; sourceFailed?: boolean },
): string;

export function sourcesIncomplete(sourceCompletion: { status?: string; pending?: number; failed?: number } | null | undefined): boolean;
