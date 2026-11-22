/** A reading of the published day, never a new selection or a guessed story.
 * Missing source detail stays broad; requested interests cannot describe stops
 * the day did not actually publish. Recomputed after edits/Undo/restore. */
const THEMES = {
  art: ['Konst', 'Art'], history: ['Historia', 'History'], culture: ['Kultur', 'Culture'],
  green: ['Grönt', 'Green spaces'], views: ['Utsikter', 'Views'],
  fika: ['Fika', 'A café break'], food: ['Mat', 'Food'],
  markets: ['Marknader', 'Markets'], second_hand: ['Second hand', 'Second-hand shops'],
  evening: ['Barer', 'Bars'], coast: ['Vid vattnet', 'By the water'],
};
const TYPE_THEME = { museum: 'culture', gallery: 'culture', park: 'green', garden: 'green',
  viewpoint: 'views', promenade: 'views', cafe: 'fika', restaurant: 'food', 'street-food': 'food',
  market: 'markets', 'vintage-shop': 'second_hand', bar: 'evening', beach: 'coast', castle: 'history' };
function theme(stop) {
  if (stop?.is_live_event) return null;
  if (stop?.type === 'museum' && stop.place_details?.kind === 'art_museum' ||
      stop?.type === 'gallery' && stop.place_details?.kind === 'art_gallery') return 'art';
  if (stop?.type === 'museum' && stop.place_details?.kind === 'history_museum') return 'history';
  return typeof stop?.type === 'string' && Object.hasOwn(TYPE_THEME, stop.type) ? TYPE_THEME[stop.type] : null;
}
function name(stop) {
  const value = stop?.label || stop?.name;
  return typeof value === 'string' && value.trim() && value.length <= 160 &&
    !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
}
export function dayIdea(route, lang = 'en') {
  const stops = Array.isArray(route?.main_stops) ? route.main_stops.filter(s => s && !s.is_live_event) : [];
  if (stops.length < 2) return null;
  const keys = [...new Set(stops.map(theme).filter(Boolean))].slice(0, 3);
  if (!keys.length) return null;
  const words = keys.map((key, i) => {
    const text = THEMES[key][lang === 'sv' ? 0 : 1];
    return i ? text.charAt(0).toLowerCase() + text.slice(1) : text;
  });
  const headline = words.length === 1 ? words[0] :
    `${words.slice(0, -1).join(', ')} ${lang === 'sv' ? 'och' : 'and'} ${words.at(-1)}`;
  const first = name(stops[0]), last = name(stops.at(-1));
  return { headline, journey: first && last && first !== last
    ? lang === 'sv' ? `Från ${first} till ${last}.` : `From ${first} to ${last}.` : null };
}
