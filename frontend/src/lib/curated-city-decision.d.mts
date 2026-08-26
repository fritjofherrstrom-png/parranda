export interface CuratedCityClassification {
  status: "composed" | "unavailable";
  hasStructure: boolean;
  placeLabel: string;
  limitations: string[];
}

export declare function classifyCuratedCityResult(
  response: unknown,
  input?: { city?: string; label?: string },
): CuratedCityClassification;

export declare function safeCuratedCityResponse(response: unknown, classification?: { status?: string } | null): any;