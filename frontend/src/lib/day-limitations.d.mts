export function limitationNote(
  limitations: string[] | null | undefined,
  stopCount: number | null | undefined,
  t: (sv: string, en: string) => string,
): string;

export function contextNote(
  limitations: string[] | null | undefined,
  t: (sv: string, en: string) => string,
  options?: { statedElsewhere?: string[] },
): string;
