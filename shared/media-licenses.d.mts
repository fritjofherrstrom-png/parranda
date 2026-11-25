export type MediaLicenseId =
  | 'CC0-1.0' | 'PD'
  | 'CC-BY-1.0' | 'CC-BY-2.0' | 'CC-BY-2.5' | 'CC-BY-3.0' | 'CC-BY-4.0'
  | 'CC-BY-SA-1.0' | 'CC-BY-SA-2.0' | 'CC-BY-SA-2.5' | 'CC-BY-SA-3.0' | 'CC-BY-SA-4.0';
export type MediaLicense = { label: string; url: string | null; attribution: boolean };
export const MEDIA_LICENSES: Readonly<Record<MediaLicenseId, Readonly<MediaLicense>>>;
export const MEDIA_LICENSE_IDS: readonly MediaLicenseId[];
export const WIKIPEDIA_TEXT_LICENSE: 'CC-BY-SA-4.0';
export const WIKIDATA_DATA_LICENSE: 'CC0-1.0';
export function isMediaLicenseId(id: unknown): id is MediaLicenseId;
export function mediaLicenseLabel(id: unknown): string | null;
export function mediaLicenseNeedsAuthor(id: unknown): boolean;
export function normalizeCommonsLicense(input?: { code?: unknown; shortName?: unknown; url?: unknown }): { id: MediaLicenseId; url: string | null } | null;
export function isMediaLicenseUrl(id: unknown, url: unknown): boolean;
