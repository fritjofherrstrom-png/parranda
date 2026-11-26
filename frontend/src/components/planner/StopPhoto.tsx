import { useCallback, useEffect, useState, type MouseEvent } from "react";
/**
 * A stop's photo, in the two places Linje shows it (docs/PLACE_MEDIA.md):
 *   - the ROW TILE, 56×56 between the name column and the chevron. On a day
 *     with photos every row keeps the slot; a stop without one, or whose image
 *     fails, shows only its bare family sign there, so the rows never jump;
 *   - the PANEL FIGURE, 3:2 at the top of the open stop, with its credit. An
 *     image that fails keeps its 3:2 box with a quiet glyph and no credit, so
 *     the text under it never jumps.
 *
 * A failed image is tried once more after IMAGE_RETRY_MS: on a cold cache the
 * route answers a short 503 while Wikimedia throttles (Retry-After about 11 s),
 * and the photo is usually there on the second try.
 *
 * Every box has its size before the image arrives (no layout shift); the image
 * fades in over 180 ms, not at all under reduced motion. Images only come from
 * our own origin, `/media/c/{media_id}/{w}`.
 */
import { mediaSrc, mediaSrcSet, photoAlt, photoCredit, PANEL_WIDTH, TILE_WIDTH, type StopMedia } from "../../lib/place-media.mjs";
import { ChevronDownIcon } from "../shared/icons";
import type { Lang, Translate } from "./copy";
import { CategoryGlyph } from "./StopCategory";

const fade = "opacity-0 motion-safe:transition-opacity motion-safe:duration-180 motion-safe:ease-out data-[loaded]:opacity-100";

/**
 * The open stop's photo fades in and settles from a hair larger, inside its
 * clipped box, so it arrives instead of popping. `scale` is its own CSS
 * property in Tailwind 4, so it is named in the transition, not `transform`.
 */
const figureFade =
  "opacity-0 motion-safe:scale-[1.02] motion-safe:transition-[opacity,scale] motion-safe:duration-200 motion-safe:ease-out data-[loaded]:opacity-100 data-[loaded]:scale-100";

/**
 * The photo's own edge: a hairline drawn inside the box, over the image, so a
 * pale sky or a white façade does not dissolve into the paper around it.
 */
const innerEdge =
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border-line after:border-parranda-line-faint after:content-['']";

/** One more try after a failed image: a little longer than the upstream Retry-After. */
export const IMAGE_RETRY_MS = 12_000;

/** onLoad may fire before React attaches it (a cached image): read `complete` too. */
function useImageState() {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  useEffect(() => {
    if (!failed || attempt > 0) return undefined;
    const timer = setTimeout(() => {
      setLoaded(false);
      setFailed(false);
      setAttempt(1);
    }, IMAGE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [failed, attempt]);
  return {
    loaded,
    failed,
    /** A new key re-mounts the <img>, so the browser asks for it again. */
    attempt,
    imgProps: {
      ref,
      "data-loaded": loaded || undefined,
      onLoad: () => setLoaded(true),
      onError: () => setFailed(true),
    },
  };
}

/**
 * A row without a photo on a day that has photos: the same 56px slot holds the
 * bare family sign, no fill and no box. It is a category sign, not a stand-in
 * image; a grey square read as a photo that failed to load.
 */
function GlyphTile({ type }: { type: unknown }) {
  return (
    <span
      aria-hidden="true"
      data-stop-photo="glyph"
      className="flex h-14 w-14 shrink-0 items-center justify-center text-parranda-ink-meta"
    >
      <CategoryGlyph type={type} className="h-5 w-5" />
    </span>
  );
}

/** 56×56 row tile. Decorative (`alt=""`): the row's name already says what it is. */
export function StopPhotoTile({ media, type, muted = false }: { media: StopMedia | null; type: unknown; muted?: boolean }) {
  const { failed, attempt, imgProps } = useImageState();
  const src = media ? mediaSrc(media, TILE_WIDTH) : null;
  if (!src || failed) return <GlyphTile type={type} />;
  return (
    <span
      data-stop-photo="tile"
      className={`relative block h-14 w-14 shrink-0 overflow-hidden rounded-parranda-btn bg-parranda-fill ${innerEdge}` + (muted ? " opacity-70" : "")}
    >
      <img
        key={attempt}
        {...imgProps}
        src={src}
        alt=""
        width={56}
        height={56}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={`h-full w-full object-cover ${fade}`}
      />
    </span>
  );
}

const creditLink = "underline decoration-parranda-line-firm underline-offset-2 hover:text-parranda-ink";

/**
 * `Bild: {author} · {licence} · Wikimedia Commons`, each part a link. One line
 * with an ellipsis; a tap expands it in full and says the photo is cropped.
 */
export function PhotoCreditLine({ media, t, lang, full = false }: { media: StopMedia; t: Translate; lang: Lang; full?: boolean }) {
  const [open, setOpen] = useState(full);
  const credit = photoCredit(media, lang);
  const expanded = full || open;
  const toggle = (event: MouseEvent<HTMLElement>) => {
    if (full || (event.target as HTMLElement).closest("a")) return;
    setOpen((cur) => !cur);
  };
  return (
    <span className="flex min-w-0 items-start gap-1.5 text-11 leading-snug text-parranda-ink-meta">
      <span
        data-photo-credit=""
        onClick={toggle}
        className={"min-w-0 flex-1 " + (expanded ? "wrap-anywhere" : "truncate")}
      >
        {credit.lead}:{" "}
        {credit.author && (
          <>
            <a href={credit.authorHref} target="_blank" rel="noopener noreferrer" className={creditLink}>{credit.author}</a>
            {" · "}
          </>
        )}
        {credit.licenseHref ? (
          <a href={credit.licenseHref} target="_blank" rel="noopener noreferrer" className={creditLink}>{credit.license}</a>
        ) : (
          <span>{credit.license}</span>
        )}
        {" · "}
        <a href={credit.sourceHref} target="_blank" rel="noopener noreferrer" className={creditLink}>{credit.source}</a>
        {expanded && credit.modified && <>{" · "}{credit.modified}</>}
      </span>
      {!full && (
        <button
          type="button"
          aria-expanded={open}
          aria-label={t("Visa hela bildkrediten", "Show the full image credit")}
          onClick={() => setOpen((cur) => !cur)}
          className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center text-parranda-ink-meta transition-colors before:absolute before:-inset-3.5 before:content-[''] hover:text-parranda-ink"
        >
          <ChevronDownIcon className={"h-3 w-3 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out " + (open ? "rotate-180" : "")} />
        </button>
      )}
    </span>
  );
}

/**
 * On a phone the open stop's photo runs on to the screen's right edge: the
 * panel ends at the page gutter (16px), so 1rem more reaches the edge without
 * widening the page. Only the image bleeds; its credit stays in the column, so
 * the credit's expand control never sits on the screen edge. Wider screens keep
 * the photo inside.
 */
const bleed = "w-full";

/**
 * The open stop's 3:2 figure, full width of its column, with the credit under
 * it. If the image fails the box stays (a quiet glyph, no credit for nothing),
 * so the kicker, excerpt and facts under it do not jump.
 */
export function StopPhotoFigure({ media, name, type, t, lang }: { media: StopMedia; name: string; type?: unknown; t: Translate; lang: Lang }) {
  const { failed, attempt, imgProps } = useImageState();
  const src = mediaSrc(media, PANEL_WIDTH);
  const srcSet = mediaSrcSet(media);
  if (!src) return null;
  if (failed) {
    return (
      <div data-stop-photo="figure-fallback" aria-hidden="true" className="m-0 flex w-full max-w-lg flex-col gap-1">
        <span className={`flex aspect-[3/2] items-center justify-center rounded-parranda-btn bg-parranda-fill text-parranda-ink-meta ${bleed}`}>
          <CategoryGlyph type={type} className="h-6 w-6" />
        </span>
      </div>
    );
  }
  return (
    <figure data-stop-photo="figure" className="m-0 flex w-full max-w-lg flex-col gap-1">
      <span className={`relative block aspect-[3/2] overflow-hidden rounded-parranda-btn bg-parranda-fill ${bleed} ${innerEdge}`}>
        <img
          key={attempt}
          {...imgProps}
          src={src}
          srcSet={srcSet ?? undefined}
          sizes="(min-width: 640px) 512px, calc(100vw - 72px)"
          alt={photoAlt(name, lang)}
          width={media.width}
          height={media.height}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={`absolute inset-0 h-full w-full object-cover ${figureFade}`}
        />
      </span>
      <figcaption className="min-w-0">
        <PhotoCreditLine media={media} t={t} lang={lang} />
      </figcaption>
    </figure>
  );
}
