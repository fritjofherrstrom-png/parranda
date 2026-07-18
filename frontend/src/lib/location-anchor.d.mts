export declare const GEO_TIMEOUT_MS: number;

export declare function storeAnchorCoords(coords: { lat?: number; lng?: number } | null | undefined): boolean;

export declare function consumeAnchorCoords(): { lat: number; lng: number } | null;

export declare function requestPosition(
  geolocation?: Geolocation | null,
): Promise<{ lat: number; lng: number }>;
