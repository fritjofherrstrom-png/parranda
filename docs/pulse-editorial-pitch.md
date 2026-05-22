# Pulse editorial pitch — spec + post-merge QA notes

*Spec authored 2026-05-22, after PR-A (#131) and PR-B (#132) landed the
Pulse design revisions. This document defines `editorial_pitch` before
a future implementation PR adds it. **Docs only — no runtime change.***

## 1. Purpose

`editorial_pitch` is a short Parranda-authored sentence that sits between
the card title and the blurb on Pulse signal cards. It is the *Parranda
voice* on the card — the line that explains why this signal matters
*now*, in one breath, before the user has to read anything longer.

It is **not**:

- a provider title (raw Open Data BCN / Turismo Roma event name)
- a duplicate of `blurb` (the factual / contextual body copy)
- a duplicate of `why_it_matters` (the curated deeper explanation that
  only renders when truly curated — see Rule #1 from PR-A)
- generic marketing copy ("worth checking out", "don't miss it",
  "discover the city's hidden gems")
- localization noise (no "loading…", no first-paint placeholders)

It **is**:

- one sentence
- the editorial reason this signal is on the page right now
- specific enough that swapping it onto a different signal would feel
  wrong

The visual surface for this field is already live: the
`.pulse-entry-pitch` element (italic Cormorant Garamond, between title
and blurb) was added in PR-B and currently falls back through
`item.editorial_pitch || item.reason || ""`. When `editorial_pitch`
becomes a real server field, the fallback chain gracefully starts
preferring it.

## 2. Card copy hierarchy

A Pulse signal card carries up to seven distinct copy roles. They must
not collapse into each other.

| Role | Element | Source | Voice |
| --- | --- | --- | --- |
| Title | `.pulse-entry-title` / `.pulse-entry-title-button` | `item.title` — clean venue / event / place name | Provider / Parranda neutral |
| Location | `.pulse-entry-where` | `item.where` — venue or neighborhood | Neutral |
| **Editorial pitch** | `.pulse-entry-pitch` (italic, between title/where and blurb) | `item.editorial_pitch` — *new field* | **Parranda voice** |
| Blurb | `.pulse-entry-blurb` | `item.blurb` — factual / context body | Provider-derived or Parranda neutral |
| Why it matters | `.pulse-entry-reason` (only renders when curated) | `item.why_it_matters` — curated longer explanation | Parranda editorial |
| Tags | `.pulse-entry-tags` | `item.matches_vibes` mapped through `cityPulseVibeLabels` | Vocabulary |
| Source / provider | source chip on the kind label | `item.source.label` | Metadata, never the main voice |

Key tensions to preserve:

- **Title is a name, not a sentence.** "Casa del Jazz" or
  "Mercat dels Encants", not "Concert at Casa del Jazz".
- **Pitch is a sentence, not a name.** It always ends with a period.
  It always speaks in Parranda voice.
- **Blurb is body copy, not a hook.** It can be longer, can include
  practical detail (artists, time, address), can be provider-derived.
- **Why-it-matters is deeper and slower.** It explains a *thesis*; the
  pitch carries a *hook*. The two must read as written by the same
  editor, but not say the same thing.

## 3. Field rules

`editorial_pitch` must satisfy all of the following:

1. **One sentence.** Ends with `.`, `!`, or `?`. No semicolons-as-joins,
   no double-dash bridges. If a draft needs two sentences, it's too
   long.
2. **Length budget: 8–18 words.** Short enough to read at a glance,
   long enough to carry a point. Outside this range needs justification
   in the implementation PR.
3. **Never repeats the title.** A pitch that begins with the venue
   name verbatim is wasting its slot. Reference the title obliquely
   ("the room", "the night", "this stretch") when needed.
4. **Never repeats the blurb.** If `editorial_pitch === blurb`, the
   pitch is suppressed at render time. This is already enforced in
   the current `createPulseEntry` fallback; the future server field
   must preserve that guarantee.
5. **Never echoes the lede.** PR-B's masthead lede currently reuses
   `item.reason`. Once `editorial_pitch` exists, the card pitch should
   be *different from* the masthead lede even for the same signal —
   the lede is a paragraph; the pitch is a one-liner.
6. **No raw provider names.** "Open Data BCN", "Turismo Roma",
   "Ajuntament de Barcelona" are metadata. They live on the source
   chip. They do not appear in the pitch sentence unless the source
   *itself* is the editorial point (rare).
7. **No generic marketing phrases.** "Worth checking out", "don't
   miss", "a must-see", "discover", "explore", "unforgettable" — these
   are placeholder text masquerading as voice. The implementation PR
   should land with a lint or test that catches the most common ones.
8. **Works in both SV and EN.** Each pitch needs a Swedish and English
   form generated server-side. The two must mean the same thing but
   may differ in idiom (Swedish allows tighter compound nouns; English
   often needs a verb).
9. **City-agnostic.** A pitch should not contain hard-coded city
   names unless the pitch is *about* the city. "Wine is leading the
   room from Monteverde to Trastevere" names neighborhoods because
   the neighborhoods are the editorial point. "A great night out in
   Barcelona" names a city as filler — that's banned.
10. **Tense and tone.** Present tense, second-person implied. Avoid
    "you should" — let the pitch *describe* the moment so the user
    decides. "Wine carries this stretch better than aperitivo" works;
    "You should drink wine here" doesn't.

## 4. Examples

These are illustrative, not normative. The point is to show the
distinction between pitch (Parranda voice) and the other copy roles.

### Live concert / event

```
title:           Litro · L'Antidoto · Les Vignerons
where:           Monteverde · Trastevere
editorial_pitch: When you want wine to steer the evening.
blurb:           Three wine bars within a 25-minute walk; the room is
                 conversation-led, the lists are short and personal.
why_it_matters:  (curated only — e.g. "the kind of room locals stay in
                 instead of moving on")
```

### Market / flea / vintage signal

```
title:           Mercat dels Encants
where:           Plaça de les Glòries
editorial_pitch: The morning makes more sense if you start here.
blurb:           Open Tuesday, Thursday, Saturday, Sunday from 09:00;
                 second-hand goods, books, vintage clothing.
why_it_matters:  (curated only)
```

### Golden hour / weather-adjacent signal

```
title:           Gianicolo terrace
where:           Trastevere
editorial_pitch: A short climb pays off about an hour before sunset.
blurb:           Panoramic view over Rome; benches, no entry; quieter
                 the closer you are to dusk.
why_it_matters:  (curated only)
```

### Neighborhood pulse

```
title:           Garbatella and Ostiense
where:           South Rome
editorial_pitch: A better weekday evening than the centre, most weeks.
blurb:           Mixed wine, food, and slower bars; less tourism, more
                 conversation, easier walking lines.
why_it_matters:  (curated only)
```

### Venue-level signal

```
title:           Casa del Jazz
where:           San Saba
editorial_pitch: The kind of room that rewards arriving early.
blurb:           Live jazz programming most nights; outdoor courtyard
                 in summer; bar inside the villa.
why_it_matters:  (curated only)
```

### Fallback / unknown signal

When a generator emits a signal without a curated pitch, the pitch
field must be empty — not auto-filled. The card renders title +
where + blurb only. PR-B already suppresses an empty pitch element;
this rule preserves that behavior.

```
title:           28è Festival Internacional de Curtmetratges 'Mecal Pro'
where:           Activitats als Jardins del Museu Can Framis
editorial_pitch: (empty — no curated pitch authored for this signal)
blurb:           Concert at Activitats als Jardins del Museu Can Framis
                 i a Mecal Factory.
```

In this state the card carries title + where + blurb, with no pitch
element. That is the honest rendering. Generic filler ("A live event
worth catching", "Concert in Barcelona today") is **not** an
acceptable fallback.

## 5. Promotion / implementation notes

When a future PR adds `editorial_pitch` server-side, it should follow
this shape:

### Server-side

- **Contract:** `editorial_pitch` is an optional string field on
  Pulse signals. Missing or empty string means "no pitch" — the
  client already handles that.
- **Where it's emitted:** `server/pulse-engine/generators/*.js` and
  `server/app.js`'s `buildOfficialPulseItem` are the two
  signal-construction surfaces. Both should be updated, with
  per-signal-type pitch builders rather than a shared
  `buildGenericPitch`. Generic builders are how we get generic
  pitches.
- **Per-generator approach:**
  - `live-events.js` — pitch is derived from `event.match_tags` +
    `event.venue` editorial overlay. Distinct from `buildLiveEventReason`
    which currently fills `reason`. The new pitch field replaces what
    `reason` does on the card; `reason` can stay for the masthead
    lede if useful (or fold into pitch eventually).
  - `golden-hour.js` — pitch tied to the current window (active /
    upcoming / tonight). The existing `blurb` / `title` strings stay;
    the pitch adds the one-liner.
  - Future generators (markets, weather shifts, opening risk) follow
    the same pattern.
- **No public-API break.** `editorial_pitch` is additive; older
  clients ignore it; the existing fallback chain
  (`editorial_pitch || reason || ""`) keeps cards rendering when
  the field is absent.
- **City-agnostic.** No city-specific branches inside the shared
  generators. Per-city editorial overlays live in city packs
  (`server/cities/*/pulse-editorial.js` or similar) and are merged
  in via the existing editorial-generator surface — they are *data*,
  not branches in shared code.

### Tests

The implementation PR should ship with:

- **No-duplicate test:** assert no signal has `editorial_pitch ===
  blurb` (case-insensitive trim-equal).
- **No-provider-title test:** assert `editorial_pitch` does not
  start with the raw provider title (`event.title`) or include the
  raw provider source label (`event.source.label`).
- **No-generic-filler test:** assert `editorial_pitch` does not
  contain a small banned-phrase list ("worth checking", "don't miss",
  "must-see", "discover the", "explore the", "unforgettable",
  "hidden gem" as a standalone phrase).
- **Length test:** assert `editorial_pitch.split(/\s+/).length` is
  between 4 and 24 words (a slightly wider net than the 8–18 author
  guideline, to allow for edge cases without false positives).
- **Punctuation test:** assert the pitch ends in `.`, `!`, or `?`.
- **Locale test:** for every signal that has an SV pitch, assert
  there is also an EN pitch, and vice versa.

These tests should live in `tests/pulse-editorial-pitch.test.js` and
be data-driven so a new generator can't bypass them.

### Migration

- Land `editorial_pitch` as an additive field. The client already
  prefers it via the fallback chain in `createPulseEntry`.
- After one release with the field shipped and tested, the
  implementation PR can deprecate the `reason → pitch` fallback and
  require an explicit pitch for live event signals.
- The `reason` field stays for the masthead lede usage.

## 6. Post-merge QA notes (from #131 + #132)

These are observations from the browser sanity pass on #132. They
are **not blockers**, **not part of this spec's implementation
scope**, and **should not be fixed in the editorial-pitch
implementation PR**. They are recorded here so future Pulse work
can pick them up.

1. **City label localizes to SV in EN context.** In the lede and the
   pitch fallback for Rome, the city name renders as "Rom" even when
   `lang=en` (e.g. "Cultural event on today in Rom"). The server's
   `cityLabel` resolution doesn't language-switch for the Pulse engine
   on every code path. Pre-existing; not introduced by PR-B.
2. **Long event titles dominate the masthead H1.** Barcelona's
   "Concert at Activitats als Jardins del Museu Can Framis i a Mecal
   Factory" wraps to 4–5 lines on desktop. The `safe_headline` builder
   uses the full venue name. A future improvement could truncate
   excessively long venue names or prefer a shorter neighborhood
   label when the venue label exceeds ~40 chars.
3. **Lede and card pitch currently share `reason` source.** Both the
   masthead lede and the pulse-entry-pitch fall back through
   `item.reason`. When the same signal is the dominant one, the user
   sees the same sentence twice on the page. The `editorial_pitch`
   field fixes this directly: the lede continues to use `reason`,
   the card pitch uses the dedicated pitch field.
4. **`pulse.reasonFallback` key is still defined in `ui-i18n.js`.**
   PR-A stopped reading it; it stays in i18n for one release per the
   precedent set with `pulse.fits`. A future cleanup PR can remove
   it once consumers have stabilized.
5. **`buildPulseMetaLabel` is no longer used in the Pulse view.** PR-B
   repurposed `cityPulseMeta` as the signals-stat number, so the
   helper is dead in this surface. It may still serve other contexts;
   removal needs a usage audit before pruning.
6. **Today panel stat labels were briefly broken at first paint.**
   Fixed in commit `436929c` before merge. The signals label was
   reading from `pulse.firstPaintSignals` (loading text) as its
   runtime value. Worth a regression guard in the safety-net PR
   Codex is preparing.

## Open ambiguities for implementation

Items where the implementer should pause and confirm before coding:

- **Pitch authoring workflow:** Who writes pitches? Per-event hand
  authoring is unrealistic at scale. The likely answer is
  *category-driven templates* (a small set of pitches per
  `kind + match_tags` combination, varied per locale) — but this
  needs a product decision before it's encoded. The risk is that
  templates degrade into the generic filler the spec bans.
- **Pitch refresh cadence:** A pitch tied to "tonight" needs to
  expire when "tonight" is over. Static text in the catalog doesn't.
  The implementer should decide whether pitches are *signal-bound*
  (regenerated each engine run) or *catalog-bound* (authored once,
  reused). The spec assumes signal-bound; a catalog-bound choice
  changes the test surface.
- **Pitch + why-it-matters overlap:** Some cards will have both
  fields populated. The spec says they should not say the same
  thing, but doesn't pin the *thematic* boundary precisely (hook vs
  thesis). The implementer may want to lock that distinction with
  one or two side-by-side worked examples in this doc before
  shipping.

---

*Spec author: Claude Opus 4.7 · 2026-05-22*
