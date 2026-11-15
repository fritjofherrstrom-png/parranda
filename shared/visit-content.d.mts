export type VisitContent = { version: 1; text: { sv: string; en: string }; source_url: string; checked_on: string };
export function normalizeVisitContent(value: unknown): VisitContent | null;
