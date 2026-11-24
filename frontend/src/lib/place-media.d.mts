import type { MediaLicenseId } from '../../../shared/media-licenses.mjs';

export type MediaLang = 'sv' | 'en';
export type MediaVia = 'p18' | 'p5775' | 'osm_commons';

export interface StopMedia {
  version: 1;
  kind: 'photo';
  media_id: string;
  width: number;
  height: number;
  subject_qid: string;
  via: MediaVia;
  author: string | null;
  license: MediaLicenseId;
  license_url: string | null;
  file_page_url: string;
  modified: 'cropped';
  checked_on: string;
}

export interface StopSubtitle {
  text: string;
  lang: MediaLang;
  subject_qid: string;
  source: 'wikidata';
}

export interface StopAboutExcerpt {
  version: 1;
  kind: 'excerpt';
  text: string;
  lang: MediaLang;
  subject_qid: string;
  article_url: string;
  article_title: string;
  license: 'CC-BY-SA-4.0';
  checked_on: string;
}

export interface PhotoCredit {
  lead: string;
  author: string | null;
  authorHref: string;
  license: string | null;
  licenseHref: string | null;
  source: 'Wikimedia Commons';
  sourceHref: string;
  modified: string | null;
}

export interface ExcerptCredit {
  lead: string;
  source: string;
  sourceHref: string;
  license: string | null;
  licenseHref: string | null;
}

export interface DayMediaCredit {
  key: string;
  name: string;
  media: StopMedia | null;
  about: StopAboutExcerpt | null;
}

export const MEDIA_WIDTHS: readonly [250, 500, 960];
export const TILE_WIDTH: 250;
export const PANEL_WIDTH: 500;

export function normalizeStopMedia<T extends object>(stop: T | null | undefined): StopMedia | null;
export function normalizeStopSubtitle<T extends object>(stop: T | null | undefined): StopSubtitle | null;
export function normalizeStopAbout<T extends object>(stop: T | null | undefined): StopAboutExcerpt | null;
export function mediaSrc(media: { media_id?: unknown } | null | undefined, w: number): string | null;
export function mediaSrcSet(media: { media_id?: unknown } | null | undefined): string | null;
export function dayHasPhotos<T extends object>(stops: readonly T[] | null | undefined): boolean;
export function dayHasPlaceMedia<T extends object>(stops: readonly T[] | null | undefined): boolean;
export function photoAlt(name: string, lang: MediaLang): string;
export function licenseLabel(id: unknown, lang: MediaLang): string | null;
export function photoCredit(media: StopMedia, lang: MediaLang): PhotoCredit;
export function textLanguageName(textLang: MediaLang, lang: MediaLang): string;
export function excerptCredit(about: StopAboutExcerpt, lang: MediaLang): ExcerptCredit;
export function otherLanguageExcerptLabel(textLang: MediaLang, lang: MediaLang): string;
export function wikidataCredit(lang: MediaLang): { text: string; href: string; license: 'CC0'; licenseHref: string | null };
export function dayMediaCredits<T extends object>(stops: readonly T[] | null | undefined): DayMediaCredit[];
