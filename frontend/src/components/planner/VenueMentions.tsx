import { readVenueMentions } from '../../../../shared/venue-mentions.mjs';
import { ChevronDownIcon, ExternalIcon } from '../shared/icons';
import type { Lang, Translate } from './copy';

function dateLabel(value: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === 'sv' ? 'sv-SE' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

/** Presents server-owned facts only. No fetching, ratings, rank or endorsement inference. */
export default function VenueMentions({ stop, t, lang }: { stop: any; t: Translate; lang: Lang }) {
  const rows = readVenueMentions(stop?.provenance?.venue_mentions, stop);
  if (!rows.length) return null;
  const publishers = [...new Set(rows.map(row => row.publisher))].join(' · ');
  const unknown = rows.some(row => row.independence === 'unknown' || row.sponsorship === 'unknown');
  return (
    <details className="group/mentions min-w-0" data-venue-mentions>
      <summary className="flex min-h-11 min-w-0 max-w-full cursor-pointer list-none items-center gap-1.5 py-2 text-13 text-parranda-ink-soft hover:text-parranda-ink [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 break-words"><span className="font-semibold">{t('Nämnd i', 'Mentioned in')}</span>{' '}{publishers}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 transition group-open/mentions:rotate-180" />
      </summary>
      <ul className="mt-1 min-w-0 space-y-3">
        {rows.map(row => {
          const date = row.updated_on || row.published_on;
          return (
            <li key={`${row.venue_id}:${row.article_id}`} className="min-w-0">
              <a href={row.article_url} target="_blank" rel="noopener noreferrer"
                className="block min-h-11 max-w-full break-words py-1 text-13 leading-relaxed text-parranda-ink-soft underline decoration-parranda-line-firm underline-offset-2 hover:text-parranda-ink">
                <span className="font-semibold">{row.publisher}</span><ExternalIcon className="ml-1 inline h-3.5 w-3.5" />
                <span className="mt-0.5 block">{row.article_title}</span>
              </a>
              <p className="text-xs leading-relaxed text-parranda-ink-meta">
                {date && <>{row.updated_on ? t('Uppdaterad', 'Updated') : t('Publicerad', 'Published')}{' '}<time dateTime={date}>{dateLabel(date, lang)}</time>{' · '}</>}
                {t('Kontrollerad', 'Checked')}{' '}<time dateTime={row.verified_at}>{dateLabel(row.verified_at.slice(0, 10), lang)}</time>
              </p>
              {row.sponsorship === 'sponsored' && <p className="text-xs text-parranda-ink-meta">{t('Sponsrat innehåll', 'Sponsored content')}</p>}
              {row.independence === 'not_independent' && <p className="text-xs text-parranda-ink-meta">{t('Inte en oberoende källa', 'Not an independent source')}</p>}
            </li>
          );
        })}
      </ul>
      {unknown && <p className="mt-3 text-xs leading-relaxed text-parranda-ink-meta">{t('Oberoende och eventuella samarbeten är inte verifierade.', 'Independence and possible commercial relationships have not been verified.')}</p>}
    </details>
  );
}
