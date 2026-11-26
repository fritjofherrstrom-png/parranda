# Linje — Parranda's design system

The day is a line through the city: stops are stations, walks are segments,
a woven live event is a transfer. This page lists what the system provides
and the few rules that keep it honest and accessible. The code is the
source of truth; this is the map.

## Tokens — `src/styles/tokens.css`

| Kind | Tokens | Utilities |
|---|---|---|
| Colour roles (day and night) | `--p-color-ink`, `paper`, `terracotta`, `ember`, `clay`, `glow`, `live`, `on-live`, `on-terracotta` | `text-parranda-*`, `bg-parranda-*`, `border-parranda-*` |
| Ink strengths | `--p-ink-soft` .85, `-muted` .75, `-meta` .68 (text) · `-line-strong` .50, `-line-firm` .30, `-line` .20, `-line-faint` .12 (frames) · `-fill-strong` .14, `-fill` .08, `-fill-faint` .05 (behind content) | `text-parranda-ink-soft/muted/meta`, `border-parranda-line*`, `bg-parranda-fill*` |
| Radius | `--p-radius-card` 20, `--p-radius-button` 10, `--p-radius-tag` 7 | `rounded-parranda`, `rounded-parranda-btn`, `rounded-parranda-tag` |
| Surface | `--p-color-surface` (a step lighter than paper, both themes) | `bg-parranda-surface` with `shadow-card` |
| Line weight | `--p-line` (1.5px) | `border-line`, `border-t-line`, `border-l-line` |
| Elevation | `--p-shadow-control`, `-card`, `-marker`, `-pop`, `-sheet` | `shadow-control`, `shadow-card`, `shadow-pop`, `shadow-sheet` |
| Darkness | `--p-scrim` (behind a modal sheet), `--p-shade` (deepens terracotta under a white digit) | `bg-parranda-scrim`, `bg-parranda-shade` |
| Stacking | `--p-z-raised`, `-popover`, `-map-control`, `-map-tooltip`, `-map-overlay`, `-sheet`, low to high | `z-(--p-z-…)` |
| Text sizes | `text-10/11/13/15/17` in `tailwind.css` (rem) | a numbered size with no `--text-N` in `@theme` produces no CSS; a contract test fails on one |
| Motion | `--p-ease-out`, the curve inside the `parranda-panel-in` and `parranda-ring-once` keyframes | transitions use `ease-out`; entrances `motion-safe:animate-panel-in`, `motion-safe:animate-ring-once` |
| Type roles | `type-display`, `type-title`, `type-eyebrow`, `type-data` — one family, Archivo: wide for display, narrow (88 %) with lining tabular figures for labels and data, in the case they are written in | |

Never write an ink percentage (`parranda-ink/68`), an arbitrary opacity
(`/[0.07]`), raw black or white, a px text size, a raw or arbitrary z-index, a
black shadow, or a frame other than `border-line` in a component; a contract
test fails if one appears. Other roles keep Tailwind's opacity modifiers
(`bg-parranda-live/8`).

## Components — `src/components/shared/ui.tsx`

| Helper | Use for |
|---|---|
| `buttonClass(tone, size)` | Buttons and button-looking links. Tones: `primary` (the one filled action), `secondary` (a soft fill), `quiet` (words only; a fill under the pointer), `live`, `dashed` (optional, not part of the day). Press feedback is built in. |
| `pressable` | Press feedback for a button or pill: named-property transition, `motion-safe:active:scale-[0.97]`. In every helper below; write it yourself only on a hand-built control. |
| `pressRow` | Press feedback for a full-width row on paper: the fill deepens, nothing scales. |
| `controlPill44` | The 44px control pill: Change place, Adjust, Follow, See all live, Expand map. |
| `busyButton(busy, onClick)` | A button that is working. Spread it instead of `disabled`. |
| `pillClass(active)`, `choiceOn` / `choiceOff` | A choice among several (Live's Where, interests): ink when chosen, a soft fill when not. |
| `controlTone` | The colours and press of `controlPill44`, for a control that sizes itself. |
| `segmentGroup` + `segmentClass(active)` | Mutually exclusive choices drawn as one control (Today/Tomorrow, rhythm, When, Order). |
| `compactPillTarget` | A 36px control that keeps a 44px target. |
| `labelChip` | A fact or status, never a control: day facts, pick coverage, Live tags. |
| `inlineLinkTarget` + `ExternalLinkText` | A link inside running text that leaves Parranda. |
| `noticeCard`, `panelCard` | Notices and grouped panels. |
| `Eyebrow`, `DataLine` / `dataLine` | Section labels (`dot`: the live dot, which rings once) and narrow fact lines. |

## Type — five roles

Every element is one of these. `text-sm` and `font-extrabold` are retired
outside the primary action.

| Role | Classes | Used for |
|---|---|---|
| Title | `type-title`; section titles `type-title text-xl` | the day's h1, "Live in …" |
| Name | `text-17 font-bold leading-tight` | stop names, live event names, aside-row titles |
| Body | `text-15 leading-relaxed` (600 for a kicker or emphasis) | the facts sentence, the idea, an excerpt, a fit sentence |
| Meta | `type-data text-13 text-parranda-ink-meta` (`dataLine`); a number may be `text-parranda-ink` | date and weather, walk legs, subtitles, facts, the picks rhythm |
| Micro | `text-11 text-parranda-ink-meta` | photo and excerpt credits only |

Controls are `text-13 font-bold`. The one exception is the terracotta
action, `text-17 font-extrabold`. The landing keeps `type-display`.

## Surfaces — two recipes on paper

| Recipe | Classes | Used for |
|---|---|---|
| Panel | `panelCard`: `bg-parranda-surface shadow-card rounded-parranda` | the Adjust panel, the Live card when it has something to show, the Blitz result, notices (`noticeCard`) |
| Fill | `bg-parranda-fill`, `fill-strong` under the pointer | controls and aside rows (Blitz, and the Live card while it has no rows, state or offer: an empty panel would be the loudest thing below the line) |

Exceptions carry a meaning: a dashed `border-parranda-line-firm` frame is
"not in the day" (detours only); the woven live stop keeps its live tint; the
open stop sits on a `fill-faint` backdrop. A hairline (`border-t-line`,
`border-y-line`, `line-faint`) only divides, or edges a photo. No other
outlined boxes. Map controls (`.maplibregl-ctrl-group`, RouteMap's own
buttons) share the `map-control` utility: a raised `surface` on
`shadow-control` with a faint inset `line-faint` hairline, so the edge holds on
night tiles. The hairline is inset, so it adds no size, and there is no outer
frame.

## Buttons — one filled action per surface

| Rank | Look | Examples |
|---|---|---|
| Primary | `buttonClass("primary")`, terracotta; on the Live card `live` | Open route in Maps, Build my day; Plan with this event |
| Secondary | `buttonClass("secondary")`, a soft fill | Open in Maps, Website, Save, Share |
| Control pill | `controlPill44` (44px) | Change place, Adjust, Follow, See all live, Expand map |
| Quiet | `buttonClass("quiet")`, words with a fill under the pointer | Keep this one, Replace, Remove |
| Inline link | text with `inlineLinkTarget` | More |

## Photos

| Where | Shape |
|---|---|
| Stop row | 56×56 (`h-14 w-14`), 1:1, `rounded-parranda-btn` |
| Open stop | 3:2, full panel width, `rounded-parranda-btn`; it stays inside its column on every width |
| Both | an inner hairline: `after:absolute after:inset-0 after:rounded-[inherit] after:border-line after:border-parranda-line-faint after:content-['']`, so a pale sky never dissolves into paper |
| No photo, on a day with photos | the same 56px slot holds only the bare 20px family glyph in `ink-meta`: a sign, not a fake image |
| A day with no photos | no media column at all |

Never pad with stand-ins, a grey tile or a city's stock image: absence is honest.

## Motion

Everything moves under `motion-safe:`, and only named properties
transition: never bare `transition` or `transition-all`. Tailwind 4's
`scale-*`, `rotate-*` and `translate-*` set their own CSS properties, so
transition `scale` (or use `transition-transform`, which covers all three),
not `transform` alone.

| What | How |
|---|---|
| Press | `pressable` on buttons and pills (150ms, `active:scale-[0.97]`); `pressRow` on full-width rows (the fill deepens, no scale) |
| Enter | `motion-safe:animate-panel-in`: opacity and the last 4px, 180ms on `--p-ease-out`, when the Adjust panel or an open stop mounts. Enter only. |
| Chevrons | `transition-transform duration-200 ease-out`. A disclosure that opens in place points down and turns 180°; a row that runs an action points right and nudges `group-hover:translate-x-0.5`; stop rows turn 90°. |
| Once, not forever | `motion-safe:animate-ring-once`: a ring leaves a mark once (600ms) and fades: the current station, the live dot. A mark of another colour than ember sets `--p-ring-rgb`. No new infinite animation; the loading sheen, breathing stations, drawing ring and route redraw are the existing exceptions. |

## Rules

- **Ember is the route.** Ember draws the line, its stations and the live
  dot, and nothing else: no ember text, chevron, check, quote rule or frame.
- **Circles are stations.** The day's stations, the map's stop markers and
  the ring in the wordmark are the only circles. Everything you press or read
  as a label is a soft rectangle: controls `rounded-parranda-btn`, tags and
  fact chips `rounded-parranda-tag`, cards `rounded-parranda`.
- **Tonal, not outlined.** A control is a soft ink fill that deepens under the
  pointer; the hairline frame is for dashed "not part of the day" and Live's
  own outlines. Cards and notices sit on `surface` with `shadow-card`.

- **Selected is ink.** A chosen chip, pill or segment is filled with ink.
  Live blue is for Live content, not for selection. A status is a
  `labelChip`, so it never looks chosen.
- **Dashed means "not part of the day".** Do not use it for a mode or a choice.
- **Never clip a focus ring.** The ring is 3px, 3px outside the control.
  No `overflow-hidden` on a group or card around focusable controls: round
  the segment ends instead. `summary` is part of the focus contract.
- **Never disable a control under focus.** A working button uses
  `busyButton`; a finished one uses `aria-disabled`. `disabled` is only for
  something that was never available.
- **A modal makes the page behind it inert** (`lib/modal-focus.mjs`) and
  wraps Tab through the controls Tab can actually reach.
- **Text contrast.** Body text is ink; secondary text is `ink-soft`
  (notices, chips, errors), `ink-muted` (explanatory sentences, status) or
  `ink-meta` (data, eyebrows, meta), never lighter. The contract test checks
  each of them at 4.5:1 or better on a `fill-strong` panel in both themes.
  Text on terracotta is `on-terracotta`. Ember is for graphics and display
  type, not small text.
- **Marks are SVG.** External links end in `ExternalIcon`, never "↗", which
  Safari draws as an emoji.
- **Dates read one way.** "Weekday day month", then the venue-local clock.
- **Every target is 44px.** Use `min-h-11`, `compactPillTarget` or
  `inlineLinkTarget`.
