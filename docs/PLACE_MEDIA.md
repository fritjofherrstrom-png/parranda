# Place media: real photos and sourced place text (contract v1)

Plan with research and numbers: `review-shots/place-media-20261124/PLAN.sv.md` (owner's machine).
This file is the binding implementation contract for PR 1. Where it differs from the plan, this file wins.

## Decisions for PR 1

1. **Photos and text ship together** (the owner asked for "foto, beskrivning av platser"): photo, Wikidata
   subtitle (kicker) and a verbatim Wikipedia excerpt. Offline name matching for stops without a QID is PR 2.
2. **Works for any place.** Media are found by Wikidata QID. A built index covers extract regions in advance;
   any other QID is looked up on demand with a short wait budget, so a first view usually has its photos.
   Nothing about media ever changes stop selection or order.
3. **Feature switch:** server env `PARRANDA_PLACE_MEDIA_DIR` (directory with `index-v1.jsonl`, writable for
   `learned-v1.jsonl`). Unset = feature off, responses unchanged byte for byte.
4. **The browser never talks to Wikimedia.** Images are served from our origin at `/media/c/:media_id/:w`.

## Identity

`stopMediaQid(stop)` returns a QID candidate from, in order:
1. `stop.id` / `stop.candidate_id` of the form `wikidata-Q123`;
2. a `https://www.wikidata.org/wiki/Q123` URL in `stop.provenance.attribution[].url` (the OSM element's own
   `wikidata` tag ends up here; soft merges may also put one here, which is why the gate below always runs).

Live-event stops (`is_live_event`) never get media.

**Entity gate** (`server/place-media/entity-gate.js`, pure, no network) accepts QID for a stop only if ALL hold:
- Entity facts present: `p31` (array of QIDs), `labels` and `aliases` (any language), `coord` (P625).
- No P31 in `REJECT_CLASSES` (direct match only): human Q5, city Q515, town Q3957, village Q532,
  human settlement Q486972, municipality Q15284, administrative territorial entity Q56061, street Q79007,
  square Q174782, bus stop Q953806, tram stop Q2175765, railway station Q55488, bridge Q12280,
  neighbourhood Q123705, district Q149621, brand Q431289, business chain Q507619, restaurant chain Q18534524,
  retail chain Q507619-like (keep the list in one exported constant; extend with reasons in comments).
- Name: after `normalizeName` (lowercase, NFKD, strip diacritics/punctuation, collapse spaces), some label or
  alias equals the stop name, or contains the whole stop name as a word sequence. Only that direction.
- Distance: haversine(stop lat/lng, coord) <= 250 m, or <= 500 m when the stop is a park/garden/nature type.
- Venue gate: if the stop type is food, drink or shop (cafe, restaurant, bar, pub, bakery, shop, second hand,
  market stall...), at least one P31 must be in `VENUE_CLASSES` (restaurant Q11707, café Q30022, bar Q187456,
  pub Q212198, bakery Q274393, shop Q213441, store Q11410, second-hand shop Q1758825, brewery Q131734,
  coffee roaster/coffeehouse variants...). A building QID is not a venue.
- Same-day ambiguity: if two stops of one day resolve to the same QID, neither gets media.
Rejections carry a reason code (`brand`, `p31_rejected`, `name`, `distance`, `venue_class`, `ambiguous`,
`no_facts`) for tests and health counters.

## Media record (per QID, in the index)

```js
{ v: 1, qid: 'Q1234', checked_on: '2026-11-24',
  entity: { p31: ['Q33506'], labels: { sv: '…', en: '…' }, aliases: ['…'], coord: { lat, lng } },
  photo: null | { media_id: '<40-hex sha1 of the Commons file>', file_title: 'File:X.jpg', file_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg',
                  width, height, via: 'p18'|'p5775'|'osm_commons', author: '…',
                  license: '<id from shared/media-licenses.mjs>', license_url: null | 'https://creativecommons.org/…',
                  file_page_url: 'https://commons.wikimedia.org/wiki/File:X.jpg' },
  subtitle: { sv?: '…', en?: '…' },                  // Wikidata descriptions, <= 80 chars, CC0
  about: { sv?: Excerpt, en?: Excerpt } }           // Excerpt = { text, title, rev, lang }
```

**Photo order:** P18 (preferred rank first, never deprecated) → P5775 (only for venue stops) →
OSM `wikimedia_commons=File:…` when known → none. Never the Wikipedia page image (see "As built").
Never P154, P94, P41, P242, P15. Never Wikipedia `summary.thumbnail` (may be a local non-free file).

**Commons gate** (`server/place-media/commons-gate.js`, pure): file on commons.wikimedia.org; `NonFree` not set;
`Restrictions` empty; mime jpeg/png/webp; original width >= 800; title not a map/plan/logo/flag/coat of arms/diagram;
licence normalises to an id in `shared/media-licenses.mjs`; real `LicenseUrl` kept (ported "3.0 de" stays ported);
author from `Attribution`, else `Artist` (HTML stripped), else `Credit` only when it reads as a name; author
required unless PD/CC0; author <= 200 chars, no control chars, must not start like a URL (`http`, `www.`, `//`), at
least one letter and two letters or digits, and not a placeholder ("Unknown author", "Okänd", "Anonymous", "Own work",
Commons' "No machine-readable author provided"). The rules live in `shared/place-media-text.mjs`, shared by the gate,
the record, the published schema and the frontend. Anything else → no photo.

`shared/media-licenses.mjs` is the ONE licence list (CC0-1.0, PD, CC-BY-1.0…4.0, CC-BY-SA-1.0…4.0, generic
over jurisdiction ports via the URL). GFDL-only, FAL, plain "Attribution", unreadable multi-licence: refused.

**Excerpt rules:** from the QID's own article (`wikibase_item` must equal the QID); not a disambiguation page;
plain text intro; the first paragraph that is not a hatnote ("För slottet i Helsingborg, se …", "Ej att förväxla med …",
"This article is about …"); cut only at a sentence end before any maintenance marker ("[källa behövs]",
"[citation needed]"), 40–320 chars; no URL inside; stored verbatim with revision id.
Languages: `sv` and `en` only in v1. The response picks the request language; an `en` excerpt is shown to `sv`
readers only behind "Visa beskrivningen på engelska" (never translated).

## Wikimedia client (`server/place-media/wikimedia-client.js`)

Injectable `fetcher`. Serial (concurrency 1), User-Agent
`Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda) place-media`, gzip, 4 s timeout per call,
honours `Retry-After`, circuit breaker: 5 failures/429s in a row → open for 10 min. Batched calls only:
`wbgetentities` (≤50 ids, props claims|labels|aliases|descriptions|sitelinks, languages sv|en),
Commons `imageinfo` (≤50 titles, iiprop url|size|mime|sha1|extmetadata), Wikipedia `extracts`
(exintro, explaintext, ≤20 titles per language, plus `pageprops` for disambiguation + `revisions` ids, or
REST summary per title when batching is impossible). Only QIDs and file/article titles are sent upstream.

## Place media service (`server/place-media/index.js`)

```js
createPlaceMedia({ dir, fetcher, waitMs = 1500, clock }) -> {
  peek(qid) -> record | undefined,          // sync; index + learned + in-memory
  ensure(qids, { signal }) -> Promise<void>,   // dedupes in flight; persists to learned-v1.jsonl
  byMediaId(media_id) -> photo | undefined,  // for /media route
  health() -> counters }
getPlaceMedia()  // singleton from env PARRANDA_PLACE_MEDIA_DIR, null when unset
setPlaceMediaForTests(instance|null)
```

## Hydration (`server/place-media/hydrate.js`)

`await hydratePlaceMedia(route, { lang, placeMedia })` runs after `hydrateVisitContent` in
`server/planner/agnostic-route-output.js` (same pass for compose, edits, Keep and Live upgrade paths).
For each non-live stop with a QID: missing records are `ensure`d with the wait budget (never longer);
then the entity gate runs against the stop; on pass the stop gets:

```js
stop.wikidata_id = 'Q1234'
stop.media = { version: 1, kind: 'photo', media_id, width, height, subject_qid, via, author, license,
               license_url /* or null */, file_page_url, modified: 'cropped', checked_on }
stop.subtitle = { text, lang, subject_qid, source: 'wikidata' }          // only if it adds to the category
stop.about = { version: 1, kind: 'excerpt', text, lang, subject_qid,
               article_url: 'https://{lang}.wikipedia.org/w/index.php?oldid={rev}', article_title,
               license: 'CC-BY-SA-4.0', checked_on }
```
A stop with curated `visit_content` gets no `about`. Every produced object is registered with
`attestStopMedia(stop)` (bounded map keyed by `qid|media_id|lang`) so the published schema can verify it.

## Published schema (`server/planner/published-day-fields.js`)

Stop gains `wikidata_id: n('qid')`, `media: o('StopMedia')`, `subtitle: o('StopSubtitle')`, `about: o('StopAbout')`.
Dedicated scalar types that return BEFORE the generic `url()` sniff: `qid`, `mediaId`, `commonsFilePageUrl`,
`wikipediaPermalink`, `ccLicenseUrl`, `creditText`, `aboutText`, `subtitleText`. `validateObject('Stop')` refuses
media/about/subtitle whose `subject_qid` ≠ `wikidata_id` or that is not attested. A pre-copy step drops any media
object that breaks a scalar rule, so media can never refuse a whole share; forged objects are still refused.
`publicSourceUrls` does not grow.

## Image bytes (`server/place-media/media-bytes.js`, route in `server/app.js`)

`GET /media/c/:media_id/:w`, `w ∈ {250, 500, 960}`. Serves only media ids known to the service (404 otherwise,
400 for other widths). Upstream thumb from `file_url` → `/thumb/…/{w}px-Name`; ≤2 parallel upstream, 1.5 s timeout,
≤2 MB, content-type image/*. Disk cache `PARRANDA_CACHE_DIR/place-media-bytes/` with LRU cap
`PARRANDA_MEDIA_CACHE_MAX_MB` (default 1024). Headers: `Cache-Control: public, max-age=86400`, `ETag: "<media_id>-<w>"`,
`Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
Upstream down and not cached → fast 503. `public-access-guard.js`: prefix rule for `/media/`, count only upstream misses.
`sw.js`: network-first for `/media/`, ≤200 entries, delete on 404/410.

## Frontend (Linje stays)

- `frontend/src/lib/place-media.mjs` (+ `.d.mts`, generics `T extends object`): normalizers mirroring the schema,
  `mediaSrc(media, w)`, `dayHasPhotos(stops)`, credit strings.
- `StopPhoto.tsx`: 56×56 row tile (radius 10, `alt=""`, fades in 180 ms, none under reduced motion, paper-2 placeholder,
  `onError` → glyph tile); panel figure 3:2 full width (`onError` → the same 3:2 box with a quiet glyph, no credit;
  either image is tried once more after 12 s), `alt="Foto av {name}"`/"Photo of {name}", credit line 11 px:
  `Foto: {author} · {licence} · Wikimedia Commons` (each part a link, `rel="noopener noreferrer"`, ellipsis, tap expands
  with "beskuren"/"cropped").
- Rows get the tile only when the day has ≥1 photo; rows without one on such a day get a quiet glyph tile. A day with
  no photos renders exactly as today. Station and chevron stay.
- `StopAbout.tsx`: kicker (subtitle) + excerpt as a quote (2 px ember rule, `lang` attribute, 4-line clamp + "Mer"),
  credit `Utdrag ur Wikipedia ({språk}) · CC BY-SA 4.0` linked to the permalink and licence. Other-language excerpt
  behind a quiet button. Curated visit note wins.
- `DayCredits.tsx` in "About this day and map": every photo and excerpt with full credit, plus
  "Platsdata från Wikidata (CC0)". Shown only when the day has media. Same on the shared-day page.
- sv and en copy. Tokens from `frontend/src/styles/tokens.css`, light and dark.

## Refused in v1

Ratings, reviews, AI text, translations, stock/AI images, food photos not of the venue, keyword or geo image search,
Openverse/Flickr/Mapillary, Wikivoyage, hotlinking Wikimedia, a hero image or carousel, fact grids.

## As built in PR 1 (deviations and settings)

Where the implementation is stricter than or differs from the contract above:

- **Class QIDs corrected** (checked on wikidata.org): restaurant chain is Q18534542 (Q18534524 does not exist),
  "store Q11410" is *game* and is left out, second-hand shop is Q2925872 (Q1758825 is a list). Both class lists
  are longer than above (more chain/company/admin/transport/Wikimedia-meta classes rejected; winery, distillery,
  commercial establishment, chain location and market types accepted as venues) and read-only at runtime.
- `wbgetentities` is called without `languages=` so the name gate sees labels and aliases in every language;
  subtitles and excerpts stay sv/en (`sitefilter=svwiki|enwiki`). The REST-summary fallback is not built.
- Media fields arriving with a request are always dropped. A stop with two different attributed QIDs gets no
  identity. P5775 only for venue entities. A subtitle is given only in the request language.
- Commons author: "Own work" and Commons' "No machine-readable author/source provided. X assumed" placeholders
  are not credits; talk-page signature stamps ("Name 15:22, 28 March 2007 (UTC)", "Name (talk)") keep only the name.
- Hydration runs once at the exit of `composeAgnosticRouteOutput` (not inside each engine trial), so one request
  never spends the wait budget twice. Legacy (non-engine) days are not hydrated.
- Shared days: a bare `wikidata_id` must equal the stop's own QID, `about` with `visit_content` is refused,
  licence and licence URL must agree, an author is required unless PD/CC0, width >= 800.
- `/media/c/:media_id/:w`: only jpeg/png/webp with matching magic bytes; permanent refusals answer 404 (remembered
  10 min), transient ones 503, the guard's media allowance 429. Without `PARRANDA_CACHE_DIR` the byte cache is
  memory-only (64 MB). The route answers 404 for everything while the feature is off.

- **Review fixes (2026-11-25).** No Wikipedia page-image candidate: on svwiki a nature reserve's or park's infobox
  shows a typical species or a nearby building, and about 240 of the 306 page-image photos in the Sweden index showed a
  bird, plant, lichen or another place. Hatnote paragraphs are skipped and maintenance markers end the cut. "Unknown
  author" and other placeholders are no credit, and a footnote link such as "[1]" in `Credit` is no author. Records
  in an older index that break these rules (via `page_image`, a hatnote excerpt, a placeholder author) are dropped on
  load and fetched again on demand; re-running the build without `--refresh` rebuilds exactly those. Shared days that
  carry such objects lose them in the pre-copy step. A chain stop (`chain: true`, from the OSM `brand` /
  `brand:wikidata` tag) gets no media (gate reason `brand`): its wikidata tag often names the brand.
- **Upstream pacing.** `/media/` starts at most a burst of 6 upstream thumbnails, then one per 2 s, for the whole
  process; a start that would wait longer than the 3 s queue is a fast 503. No caller can provoke the upload.wikimedia.org
  429 that would open the breaker for every viewer. The per-client media allowance is 20 misses per guard window.
  The guard matches paths the way Express routes them (case-insensitive, trailing slash ignored), and with the guard on,
  a media miss that arrives without its admission check is refused (503) instead of going upstream uncounted.
  Remaining exposure: one client can still spend the shared pace for its window, so other viewers' cold photos wait or
  show the glyph until the cache warms; warming the byte cache in the background is still a follow-up.

Settings: `PARRANDA_PLACE_MEDIA_DIR` (feature switch; `index-v1.jsonl` + writable `learned-v1.jsonl`),
`PARRANDA_CACHE_DIR` (byte cache in `place-media-bytes/`), `PARRANDA_MEDIA_CACHE_MAX_MB` (default 1024),
`PARRANDA_PUBLIC_GUARD_MEDIA_MAX` (upstream misses per client per guard window, default 20).

Build an index: `node scripts/build-place-media.js --extract-dir <osm extract store> --out <dir> [--limit N] [--refresh]`
(serial, polite; Sweden: 7283 QIDs in 6–9 minutes, 2994 photos). Re-running without `--refresh` only fetches what is missing.

Known limit (measured 2026-11-24): upload.wikimedia.org answers 429 (Retry-After about 11 s) after roughly ten rapid
cold thumbnail requests from one IP; paced at one request per 2 s every thumb was served. The route now paces its
starts (above), so on a cold cache a day's later tiles may show the glyph first and fill in on their one retry.
Warming the byte cache at a polite pace is left for a follow-up.
