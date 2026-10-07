type Choice = { label: string; selection_id: string; attribution?: string; license?: string };
export function PlaceChoices({ intake, pending, locationPending, locationFailed, onChoose, onNarrow, t }: {
  intake: any; pending: boolean; locationPending: boolean; locationFailed: boolean;
  onChoose: (choice: Choice) => void; onNarrow: () => void; t: (sv: string, en: string) => string;
}) {
  const choices: Choice[] = (Array.isArray(intake?.candidates) ? intake.candidates : [])
    .filter((c: any) => typeof c?.label === 'string' && typeof c?.selection_id === 'string' && c.selection_id).slice(0, 5);
  const invalid = intake?.blockers?.includes('place_selection_invalid');
  const credits = [...new Set(choices.filter(c => c.attribution).map(c => `${c.attribution}${c.license ? ` · ${c.license}` : ''}`))];
  if (!choices.length && !invalid) return null;
  return <section aria-label={t('Välj plats', 'Choose place')} className="flex flex-col gap-3 rounded-2xl border border-parranda-ink/15 p-4">
    <p role="status">{invalid ? t('Ditt tidigare platsval behöver bekräftas igen.', 'Your previous place choice needs confirming again.') : t('Vilken plats menar du?', 'Which place do you mean?')}</p>
    {choices.map(choice => <button key={choice.selection_id} type="button" disabled={pending || locationPending}
      className="min-h-11 rounded-xl border border-parranda-ink/20 px-4 py-3 text-left hover:bg-parranda-ink/5 disabled:opacity-50"
      onClick={() => onChoose(choice)}>{choice.label}</button>)}
    {credits.map(credit => <p key={credit} className="text-xs text-parranda-ink/68">{credit}</p>)}
    <button type="button" disabled={pending || locationPending} onClick={onNarrow}
      className="min-h-11 rounded-xl border border-parranda-ink/20 px-4 py-3 text-left disabled:opacity-50">
      {locationPending ? t('Hämtar position …', 'Getting location …') : t('Använd min position för att avgränsa sökningen', 'Use my location to narrow the search')}
    </button>
    {locationFailed && <p role="status">{t('Positionen kunde inte hämtas. Välj en plats ovan eller lägg till stad eller region.', 'Your location could not be obtained. Choose a place above or add a city or region.')}</p>}
  </section>;
}
