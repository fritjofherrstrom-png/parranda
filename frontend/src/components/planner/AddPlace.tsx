import { useId, useState } from 'react';
import type { DayPlaceSearchItem } from '../../../../shared/day-place-search.mjs';
import { buttonClass } from '../shared/ui';
import type { Translate } from './copy';

export type PlacePreview = { label: string; replacing: boolean; stops: Array<{ id: string; label: string }>;
  beforeKm: number | null; afterKm: number | null };
type Props = { t: Translate; disabled: boolean; disabledReason?: string; busy: boolean; searched: boolean;
  items: DayPlaceSearchItem[]; error: string | null; preview: PlacePreview | null;
  stops: Array<{ id: string; label: string; type?: string; covered_preferences?: string[] }>;
  pinnedIds: string[]; onSearch: (query: string) => void; onPreview: (id: string, replaceId?: string) => void;
  onConfirm: () => void; onCancel: () => void };

function PlaceResult({ item, t, stops, pinnedIds, disabled, onPreview }: Pick<Props, 't' | 'stops' | 'pinnedIds' | 'onPreview'> & { item: DayPlaceSearchItem; disabled: boolean }) {
  const meals = stops.filter(stop => !pinnedIds.includes(stop.id) && (stop.covered_preferences?.includes('food') || ['restaurant', 'pizza', 'fast-food'].includes(stop.type || '')));
  const canAdd = stops.length < 6;
  const [placement, setPlacement] = useState(canAdd ? '' : meals[0]?.id || '');
  return <li className="border-b border-parranda-line py-4 last:border-b-0">
    <p className="font-semibold text-parranda-ink">{item.label}</p>
    {item.address && <p className="mt-1 text-sm text-parranda-ink-muted">{item.address}</p>}
    <p className="mt-1 text-sm text-parranda-ink-muted">{item.hours_status === 'unknown'
      ? t('Öppettider saknas – kontrollera före besöket.', 'Opening hours unknown — check before visiting.')
      : t('Öppettider finns för vald dag. Besökstiden är inte bokad.', 'Hours available for the selected day. A visit time is not reserved.')}
      {item.source_url && <> <a href={item.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{t('Visa källa', 'View source')}</a></>}
    </p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <select aria-label={`${t('Placering för', 'Placement for')} ${item.label}`} value={placement} onChange={e => setPlacement(e.target.value)} disabled={disabled}
        className="min-h-11 max-w-full rounded-lg border border-parranda-line bg-parranda-paper px-3 text-sm text-parranda-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-parranda-terracotta">
        {canAdd && <option value="">{t('Lägg till som stopp', 'Add as a stop')}</option>}
        {meals.map(stop => <option key={stop.id} value={stop.id}>{t('Ersätt', 'Replace')} {stop.label}</option>)}
      </select>
      <button type="button" disabled={disabled || (!canAdd && !meals.length)} className={buttonClass('secondary', 'min-h-11 px-4 text-sm')} onClick={() => onPreview(item.id, placement || undefined)}>{t('Förhandsvisa ändring', 'Preview change')}</button>
    </div>
    {!canAdd && <p className="mt-2 text-sm text-parranda-ink-muted">{t('Dagen har sex stopp. Välj en måltid att ersätta eller ta bort ett stopp först.', 'This day has six stops. Choose a meal to replace or remove a stop first.')}</p>}
  </li>;
}

export default function AddPlace({ t, disabled, disabledReason, busy, searched, items, error, preview, stops, pinnedIds, onSearch, onPreview, onConfirm, onCancel }: Props) {
  const id = useId();
  return <section aria-labelledby={`${id}-heading`} className="mt-8 border-t border-parranda-line pt-6">
    <h2 id={`${id}-heading`} className="text-xl font-semibold text-parranda-ink">{t('Lägg till en plats', 'Add a place')}</h2>
    <form aria-label={t('Lägg till en plats', 'Add a place')} className="mt-3" onSubmit={event => { event.preventDefault(); const input = event.currentTarget.elements.namedItem('place-query') as HTMLInputElement; onSearch(input.value); }}>
      <label htmlFor={`${id}-query`} className="block text-sm text-parranda-ink-muted">{t('Platsnamn eller vad du letar efter', "Place name or what you're looking for")}</label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input id={`${id}-query`} name="place-query" type="search" maxLength={80} required disabled={disabled || busy} placeholder={t('T.ex. indiskt, café eller ett platsnamn', 'e.g. Indian food, a café or a place name')}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-parranda-line bg-parranda-paper px-3 text-base text-parranda-ink placeholder:text-parranda-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-parranda-terracotta" />
        <button type="submit" disabled={disabled || busy} className={buttonClass('secondary', 'min-h-11 px-4 text-sm')}>{t('Sök platser', 'Search places')}</button>
      </div>
    </form>
    <p className="mt-2 text-sm text-parranda-ink-muted">{disabledReason || t('Sök bland platserna vi har underlag för här. Du får se ändringen innan du bekräftar.', 'Search the places we have source data for here. Review the change before confirming.')}</p>
    <div role="status" aria-live="polite" className="mt-3 text-sm text-parranda-ink-muted">
      {busy ? t('Kontrollerar platser och promenaden …', 'Checking places and the walk …') : error ? error : searched && !items.length ? t('Inga träffar i vårt underlag här. Prova ett annat namn eller en annan typ av plats.', 'No matches in our available places here. Try another name or type of place.') : null}
    </div>
    {busy && <button type="button" className={buttonClass('quiet', 'min-h-11 px-4 text-sm')} onClick={onCancel}>{t('Avbryt', 'Cancel')}</button>}
    {!preview && items.length > 0 && <ul className="mt-1">{items.map(item => <PlaceResult key={item.id} item={item} t={t} stops={stops} pinnedIds={pinnedIds} disabled={disabled || busy} onPreview={onPreview} />)}</ul>}
    {preview && <div aria-label={t('Förhandsvisa ändring av dagen', 'Preview day change')} className="mt-4 rounded-xl bg-parranda-fill p-4">
      <h3 className="font-semibold text-parranda-ink">{t('Förhandsvisning', 'Preview')}: {preview.label}</h3>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-parranda-ink">{preview.stops.map(stop => <li key={stop.id}>{stop.label}</li>)}</ol>
      {preview.beforeKm !== null && preview.afterKm !== null && <p className="mt-3 text-sm text-parranda-ink-muted">
        {t('Beräknad promenad', 'Estimated walk')}: {preview.beforeKm.toFixed(1)} → {preview.afterKm.toFixed(1)} km ({preview.afterKm >= preview.beforeKm ? '+' : ''}{(preview.afterKm - preview.beforeKm).toFixed(1)} km)
      </p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={disabled || busy} className={buttonClass('primary', 'min-h-11 px-4 text-sm')} onClick={onConfirm}>{preview.replacing ? t('Bekräfta byte', 'Confirm replacement') : t('Bekräfta tillägg', 'Confirm addition')}</button>
        <button type="button" className={buttonClass('quiet', 'min-h-11 px-4 text-sm')} onClick={onCancel}>{t('Avbryt förhandsvisning', 'Cancel preview')}</button>
      </div>
    </div>}
  </section>;
}
