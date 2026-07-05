export interface ShareInputs {
  place?: string;
  preferences?: string[];
  dayOffset?: number;
  walkKey?: string;
  lang?: string;
}

export declare function encodeShareParams(inputs?: ShareInputs): string;

export declare function buildShareUrl(origin: string, inputs: ShareInputs): string;

export declare function decodeShareParams(
  search: string | URLSearchParams,
  allowedPrefKeys?: string[] | null,
): { place: string; preferences: string[]; dayOffset: 0 | 1; walkKey: string; lang: "sv" | "en" | null };
