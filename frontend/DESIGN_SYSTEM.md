# Linje — Parranda's design system

The day is a line through the city: stops are stations, walks are segments,
a woven live event is a transfer. This page lists what the system provides
and the few rules that keep it honest and accessible. The code is the
source of truth; this is the map.

## Tokens — `src/styles/tokens.css`

| Kind | Tokens | Utilities |
|---|---|---|
| Colour roles (day and night) | `--p-color-ink`, `paper`, `terracotta`, `ember`, `clay`, `glow`, `live`, `on-live` | `text-parranda-*`, `bg-parranda-*`, `border-parranda-*` |
| Radius | `--p-radius-card`, `--p-radius-button` | `rounded-parranda`, `rounded-parranda-btn` |
| Line weight | `--p-line` (1.5px) | `border-line`, `border-t-line`, `border-l-line` |
| Elevation | `--p-shadow-control`, `-marker`, `-pop`, `-sheet` | `shadow-control`, `shadow-pop`, `shadow-sheet` |
| Stacking | `--p-z-popover`, `-map-control`, `-map-tooltip`, `-sheet` | `z-(--p-z-…)` |
| Text sizes | `text-10/11/13/15/17` in `tailwind.css` (rem) | next to Tailwind's `text-xs`, `sm`, `base`, `lg` |
| Type roles | `type-display`, `type-title`, `type-eyebrow`, `type-data` | |

Never write a px text size, a raw z-index, a black shadow or a `1.5px` border
in a component; a contract test fails if one appears.

## Components — `src/components/shared/ui.tsx`

| Helper | Use for |
|---|---|
| `buttonClass(tone, size)` | Buttons and button-looking links. Tones: `primary` (the one filled action), `secondary`, `quiet`, `live`, `dashed` (optional, not part of the day). |
| `busyButton(busy, onClick)` | A button that is working. Spread it instead of `disabled`. |
| `pillClass(active)` | A chip-like choice (Live's Where). |
| `segmentGroup` + `segmentClass(active)` | Mutually exclusive choices drawn as one control (Today/Tomorrow, rhythm, When, Order). |
| `compactPillTarget` | A 36px pill that keeps a 44px target. |
| `labelChip` | A fact or status, never a control: day facts, pick coverage, Live tags. |
| `inlineLinkTarget` + `ExternalLinkText` | A link inside running text that leaves Parranda. |
| `noticeCard`, `panelCard` | Notices and grouped panels. |
| `Eyebrow`, `DataLine` / `dataLine` | Section labels and mono fact lines. |

## Rules

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
- **Text contrast.** Body text is ink; secondary text never goes below 65 %
  ink. Text on terracotta is solid white. Ember is for graphics and display
  type, not small text.
- **Marks are SVG.** External links end in `ExternalIcon`, never "↗", which
  Safari draws as an emoji.
- **Dates read one way.** "Weekday day month", then the venue-local clock.
- **Every target is 44px.** Use `min-h-11`, `compactPillTarget` or
  `inlineLinkTarget`.
