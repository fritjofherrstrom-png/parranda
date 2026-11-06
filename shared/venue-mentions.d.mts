export interface VenueMention {
  venue_id: string;
  venue_binding: { label: string; lat: number; lng: number };
  article_id: string;
  publisher_id: string;
  publisher: string;
  publisher_group: string | null;
  article_url: string;
  article_title: string;
  relation_kind: 'mentioned' | 'listed' | 'recommended';
  published_on: string | null;
  updated_on: string | null;
  verified_at: string;
  source_evidence: { document_sha256: string; locator: string };
  independence: 'independent' | 'not_independent' | 'unknown';
  sponsorship: 'sponsored' | 'not_sponsored' | 'unknown';
}
export const MAX_VENUE_MENTIONS: number;
export function readVenueMentions(value: unknown, place: { label?: string; name?: string; lat: number; lng: number }): VenueMention[];
