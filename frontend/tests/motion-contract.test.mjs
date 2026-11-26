/**
 * Secondary motion and sheet entry (UX principles 3 and 8), read from source.
 *
 * Icons that change meaning swap through a short blur instead of trading
 * places in one frame; the Live sheet rises into place instead of appearing
 * at once; the Adjust control just tapped rings a finite number of times.
 * Movement waits for prefers-reduced-motion: no-preference, fades are for
 * everyone, and nothing new repeats forever.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { componentSource } from "./helpers/planner-source.mjs";

const styles = readFileSync(new URL("../src/styles/tailwind.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

/**
 * Every rule inside every @starting-style block, one entry per rule, with
 * the @media context it sits in (nested @media joined with " and "). A
 * @starting-style nested inside a rule (CSS nesting) counts as a rule of
 * its own, with that parent's selector.
 */
function startingStyles(css) {
  const entries = [];
  const mediaOf = node => {
    const queries = [];
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && parent.name === "media") queries.unshift(parent.params.trim());
    }
    return queries.join(" and ");
  };
  postcss.parse(css).walkAtRules("starting-style", block => {
    const media = mediaOf(block);
    block.walkRules(rule => {
      entries.push({ media: mediaOf(rule), selector: rule.selector, rules: rule.toString() });
    });
    const own = block.nodes?.filter(node => node.type === "decl") ?? [];
    if (own.length) {
      let parent = block.parent;
      while (parent && parent.type !== "rule") parent = parent.parent;
      entries.push({ media, selector: parent?.selector ?? "", rules: own.map(String).join(";\n") });
    }
  });
  return entries;
}

const MOVES = /(^|[\s;{])(?:-webkit-)?(transform|translate|scale|rotate)\s*:/;

/** True only when every query in the media list asks for no-preference and none negates it. */
function waitsForNoPreference(media) {
  if (!media) return false;
  return media.split(",").every(query =>
    /prefers-reduced-motion:\s*no-preference/.test(query) && !/(^|\s)not\s/.test(query));
}

/** The @starting-style rules that move without waiting for no-preference. */
function unguardedMovement(css) {
  return startingStyles(css).filter(({ media, rules }) =>
    MOVES.test(rules) && !waitsForNoPreference(media));
}

test("the guard is not fooled by a negated, OR-listed or prefixed movement", () => {
  const negated = "@media not (prefers-reduced-motion: no-preference) { @starting-style { .a { transform: none } } }";
  const either = "@media (prefers-reduced-motion: no-preference), (min-width: 1px) { @starting-style { .a { scale: 0.5 } } }";
  const prefixed = "@starting-style { .a { -webkit-transform: translateY(4px) } }";
  for (const css of [negated, either, prefixed]) assert.equal(unguardedMovement(css).length, 1, css);
  const guarded = "@media (prefers-reduced-motion: no-preference) and (width >= 40rem) { @starting-style { .a { transform: translateY(4px) } } }";
  assert.equal(unguardedMovement(guarded).length, 0);
});

test("the @starting-style guard sees every rule in a block, not just the first", () => {
  const second = "@starting-style { .a { opacity: 0 } .b { transform: translateY(8px) } }";
  assert.deepEqual(unguardedMovement(second).map(({ selector }) => selector), [".b"]);
  const nested = "@media (prefers-reduced-motion: reduce) { @starting-style { .a { opacity: 0 } .b { scale: 0.5 } } }";
  assert.deepEqual(unguardedMovement(nested).map(({ selector }) => selector), [".b"], "a reduce block may only fade");
  const guarded = "@media (prefers-reduced-motion: no-preference) and (width >= 40rem) { @starting-style { .a { opacity: 0 } .b { rotate: 10deg } } }";
  assert.deepEqual(unguardedMovement(guarded), []);
  const outer = "@media (prefers-reduced-motion: no-preference) { @media (width >= 40rem) { @starting-style { .c { translate: 0 8px } } } }";
  assert.deepEqual(unguardedMovement(outer), [], "the parent @media context counts");
  const inRule = ".d { transition: transform 1s; @starting-style { transform: scale(0.5) } }";
  assert.deepEqual(unguardedMovement(inRule).map(({ selector }) => selector), [".d"], "a nested @starting-style is checked too");
});

test("every @starting-style movement waits for reduced-motion no-preference", () => {
  const starts = startingStyles(styles);
  assert.ok(starts.length >= 6, "the icon swap and the Live sheet entries are declared");
  assert.deepEqual(unguardedMovement(styles).map(({ media, rules }) => `${media} ${rules}`), [],
    "movement waits for no-preference");
  assert.doesNotMatch(styles, /transition-all|transition: all/);
});

test("an icon swap fades and unblurs for everyone and grows only without reduced motion", () => {
  assert.match(styles, /\.icon-swap \{\s*transition:\s*opacity 200ms var\(--p-ease-out\),\s*filter 200ms var\(--p-ease-out\),\s*transform 200ms var\(--p-ease-out\);/);
  const swaps = startingStyles(styles).filter(({ rules }) => /\.icon-swap/.test(rules));
  const fade = swaps.find(({ rules }) => /opacity: 0/.test(rules));
  assert.ok(fade && /filter: blur\(4px\)/.test(fade.rules), "the new mark comes out of a 4px blur");
  assert.doesNotMatch(fade.rules, /transform/, "the fade itself never moves");
  const grow = swaps.find(({ rules }) => /transform: scale\(0\.5\)/.test(rules));
  assert.ok(grow, "the mark grows from half size");
  assert.match(grow.media, /prefers-reduced-motion: no-preference/, "the growth is guarded");
});

test("IconSwap animates a change, not the first render, and wraps Save, Share and the map toggle", () => {
  const icons = componentSource("shared/icons.tsx");
  const swap = icons.split("export function IconSwap")[1]?.split(/\nexport |\nfunction /)[0] ?? "";
  assert.match(swap, /key=\{state\}/, "a new state mounts a new mark, so @starting-style plays");
  assert.match(swap, /const first = useRef\(state\)/);
  assert.match(swap, /changed\.current \? " icon-swap" : ""/, "the class appears only after a change");
  assert.match(swap, /aria-hidden="true"/);

  const header = componentSource("planner/DayHeader.tsx");
  assert.match(header, /<IconSwap state=\{isSaved \? "saved" : "save"\}><StarIcon filled=\{isSaved\} className=\{`h-4 w-4 \$\{isSaved \? "text-parranda-clay" : ""\}`\.trim\(\)\} \/><\/IconSwap>/,
    "the Save star swaps and keeps its clay fill");
  assert.match(header, /<IconSwap state=\{shareCopied \? "copied" : "share"\}>\{shareCopied \? <CheckIcon [^}]*\/> : <ShareIcon \/>\}<\/IconSwap>/);
  // The swap changes only the mark: the label, the Save focus target and the
  // always-mounted status note stay as they were.
  assert.match(header, /ref=\{saveRef\}/);
  assert.match(header, /\{isSaved \? t\("Sparad", "Saved"\) : t\("Spara", "Save"\)\}/);
  assert.match(header, /<p role="status"[^>]*>\s*\{showSharingNote \? sharingNote : null\}/);

  const map = componentSource("planner/RouteMap.tsx");
  assert.match(map, /<IconSwap state=\{mapExpanded \? "collapse" : "expand"\}>\{mapExpanded \? <CollapseIcon [^}]*\/> : <ExpandIcon [^}]*\/>\}<\/IconSwap>/);
});

test("the Live sheet rises on the drawer curve, fades for reduced motion, and keeps its centring", () => {
  assert.match(tokens, /--p-ease-drawer: cubic-bezier\(0\.32, 0\.72, 0, 1\);/);
  const sheet = componentSource("planner/LiveSheet.tsx");
  assert.match(sheet, /className="live-sheet-scrim /);
  assert.match(sheet, /className="live-sheet-panel [^"]*max-h-\[85dvh\]/, "the cap follows the visible height");
  assert.match(sheet, /live-sheet-panel [^"]*sm:left-1\/2 [^"]*sm:-translate-x-1\/2/, "desktop centring uses Tailwind 4's own translate property");
  assert.doesNotMatch(sheet, /\d+vh\]/);

  assert.match(styles, /\.live-sheet-scrim \{\s*transition: opacity 300ms var\(--p-ease-out\);/);
  assert.match(styles, /\.live-sheet-panel \{\s*transition:\s*transform 400ms var\(--p-ease-drawer\),\s*opacity 300ms var\(--p-ease-out\);/);
  // The panel animates `transform`, never `translate`, so it composes with
  // the centring instead of replacing it, and declares no resting transform.
  assert.doesNotMatch(styles, /\.live-sheet-panel \{[^}]*\btranslate:/);
  const entries = startingStyles(styles).filter(({ rules }) => /\.live-sheet-panel/.test(rules));
  assert.ok(entries.some(({ media, rules }) => /reduce/.test(media) && /opacity: 0/.test(rules) && !/transform/.test(rules)), "reduced motion fades in");
  assert.ok(entries.some(({ media, rules }) => /no-preference\)$/.test(media) && /translateY\(100%\)/.test(rules)), "a phone sheet rises from the edge");
  assert.ok(entries.some(({ media, rules }) => /\(width >= 40rem\)/.test(media) && /translateY\(24px\)/.test(rules) && /opacity: 0/.test(rules)), "a wide sheet lifts into place");
});

test("the Live sheet's wide entry switches at the same sm breakpoint as its layout", () => {
  // The panel's layout switches with `sm:` (Tailwind 4: `@media (width >=
  // 40rem)`, which follows the browser's default font size). A pixel query
  // would pair the phone sheet with the desktop lift at a larger font size.
  const sheet = componentSource("planner/LiveSheet.tsx");
  assert.match(sheet, /live-sheet-panel [^"]*\bsm:/, "the panel lays out with the sm breakpoint");
  assert.doesNotMatch(styles, /--breakpoint-sm/, "sm stays Tailwind's 40rem");
  const wide = startingStyles(styles).filter(({ selector, media }) => selector === ".live-sheet-panel" && /width|min-width/.test(media));
  assert.equal(wide.length, 1, "one wide-screen entry");
  assert.match(wide[0].media, /^\(prefers-reduced-motion: no-preference\) and \(width >= 40rem\)$/);
  for (const { media } of startingStyles(styles)) assert.doesNotMatch(media, /\d+px/, `no pixel breakpoint in an entry: ${media}`);
});

test("the pending ring is finite and visible from its first frames", () => {
  const token = styles.match(/--animate-ring-pending: ([^;]+);/)?.[1];
  assert.ok(token, "the pending ring token exists");
  assert.match(token, /^parranda-ring \S+ var\(--p-ease-out\) (\d+)$/);
  assert.doesNotMatch(token, /infinite/);
  assert.ok(Number(token.match(/(\d+)$/)[1]) <= 3, "it plays a few times, never forever");
  const keyframe = styles.match(/@keyframes parranda-ring \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(keyframe, /0% \{\s*box-shadow: 0 0 0 2px rgb\(var\(--p-color-ember\) \/ 0\.45\);/, "the ring starts visible");
  assert.match(keyframe, /100% \{\s*box-shadow: 0 0 0 7px rgb\(var\(--p-color-ember\) \/ 0\);/);
});
