export interface ShareInputs {
  city?: string | null;
  place?: string;
  placeRef?: string | null;
  preferences?: string[];
  dayOffset?: number;
  walkKey?: string;
  lang?: string;
}

export declare function validPlaceRef(value: unknown): string | null;

export declare function encodeShareParams(inputs?: ShareInputs): string;

export declare function buildShareUrl(origin: string, inputs: ShareInputs): string;
export declare function shareablePlace(inputs?: { place?: string | null; placeLabel?: string | null } | null): string | null;

export declare function decodeShareParams(
  search: string | URLSearchParams,
  allowedPrefKeys?: string[] | null,
): { city: string | null; place: string; placeRef: string | null; invalidPlaceRef: boolean; preferences: string[]; dayOffset: 0 | 1; walkKey: string; lang: "sv" | "en" | null };
