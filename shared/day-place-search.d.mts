export type DayPlaceSearch = { query: string };
export type DayPlaceSearchItem = { id: string; label: string; type: string; match_kind: 'name' | 'address' | 'cuisine' | 'category'; hours_status: 'unknown' | 'known'; address?: string; source_url?: string; selected_day_hours?: Record<string, unknown> };
export type DayPlaceSearchResult = { query: string; coverage: 'available_supply'; items: DayPlaceSearchItem[] };
export function normalizeDayPlaceSearch(value: unknown): DayPlaceSearch | null;
