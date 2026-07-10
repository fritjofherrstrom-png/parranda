export interface CityEntry {
  key: string;
  label: string;
  status?: string;
}

export type CityRegistry = Record<string, CityEntry>;

export declare function resolveEntry(registry: CityRegistry | null | undefined, raw: string): CityEntry | null;

export declare function bestPrefixMatch(registry: CityRegistry | null | undefined, raw: string): CityEntry | null;

export declare function resolveEntryLoose(registry: CityRegistry | null | undefined, raw: string): CityEntry | null;

export declare function inlineCompletion(registry: CityRegistry | null | undefined, typed: string): string | null;

export declare function routeForInput(
  registry: CityRegistry | null | undefined,
  raw: string,
  lang?: string,
): { type: "city" | "anywhere"; href: string } | null;
