export function storePlaceChoice(choice: { place?: string; selection?: string | null; label?: string | null }): void;
export function consumePlaceChoice(place: string): { placeSelection?: string; selectionLabel?: string; placeContextSelection?: string };
