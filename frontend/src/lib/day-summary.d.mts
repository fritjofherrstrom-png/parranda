export function countWord(n: number, lang?: "sv" | "en"): string;
export function daySummary(input: { stops: number; live?: number; distance?: string | null; lang?: "sv" | "en" }): string;
export function dayStationLine(
  entry: { dateIso?: string | null; safeResponse?: any },
  options?: { lang?: "sv" | "en"; now?: Date; saved?: boolean },
): string;
