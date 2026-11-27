import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { LAST_KEY } from "../lib/anywhere-storage.mjs";
import { isPlaceSearchQueryEligible } from "../../../shared/place-search-query.mjs";
import { SearchIcon } from "./shared/icons";
import { buttonClass, dataLine } from "./shared/ui";

export interface PlaceSuggestion {
  title: string;
  context: string;
  query: string;
  selection_id: string;
  kind?: "settlement" | "district" | "region";
  place_ref?: string;
  city_key?: string;
  attribution?: string;
}

function previousSelection(): string | undefined {
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    const token = raw ? JSON.parse(raw)?.inputs?.placeSelection : null;
    return typeof token === "string" && token.length <= 8192 ? token : undefined;
  } catch { return undefined; }
}

/** How long a lookup may run before the field says it is still looking. */
const WAIT_SHOWN_MS = 300;

/** The visible wait from sm up: a one-line popover where the list will open.
    Below sm the same live region stays sr-only and a short in-flow label
    inside the box shows the wait instead (see phoneWait). */
const waitLine = `max-sm:sr-only sm:pointer-events-none sm:absolute sm:inset-x-0 sm:z-(--p-z-popover) sm:block sm:rounded-parranda-btn sm:bg-parranda-surface sm:px-5 sm:py-2.5 sm:shadow-pop ${dataLine} motion-safe:sm:animate-panel-in`;

/** The phone's visible wait: a flex sibling after the input, so the input
    narrows and the typed text is never painted over. */
const phoneWait = `shrink-0 whitespace-nowrap ${dataLine} motion-safe:animate-panel-in sm:hidden`;

/** Prefix search stays at the field. Choosing a row commits identity, not navigation. */
export default function PlaceSearchField({ value, lang, selected, inputRef, onChange, onSelect, geoDenied }: {
  value: string;
  lang: "sv" | "en";
  selected: PlaceSuggestion | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSelect: (choice: PlaceSuggestion) => void;
  geoDenied: boolean;
}) {
  const listId = useId();
  const [choices, setChoices] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [above, setAbove] = useState(false);
  const [composing, setComposing] = useState(false);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [selectedOverflows, setSelectedOverflows] = useState(false);
  // A lookup that answers quickly shows nothing; one still pending after
  // WAIT_SHOWN_MS says so at the field, so a slow network is
  // never silence after typing.
  const [waitShown, setWaitShown] = useState(false);
  // Set once the current lookup has been pending WAIT_SHOWN_MS, whether or
  // not the field had focus then, so focusing mid-lookup can show the wait.
  const pendingLong = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);
  // Only a pointer that really moves picks a suggestion. When the list
  // scrolls under a resting pointer (arrow keys), the browser reports the
  // pointer over a new row with no movement; that must not undo the
  // keyboard's choice.
  const pointerPicks = (event: { movementX: number; movementY: number }, index: number) => {
    if (!event.movementX && !event.movementY) return;
    setActive(index);
  };
  const dismissed = useRef(false);
  const sequence = useRef(0);
  // Set by the reader's own Try again; the server then asks its provider even if it is resting.
  const explicitRetry = useRef(false);
  const t = (sv: string, en: string) => lang === "sv" ? sv : en;
  // A region and its city can share a name and country; settlements stay unmarked.
  const kindLabel = (kind?: PlaceSuggestion["kind"]) =>
    kind === "region" ? t("Region", "Region") : kind === "district" ? t("Stadsdel", "District") : "";

  useEffect(() => {
    const generation = ++sequence.current;
    const query = value.trim();
    dismissed.current = false;
    setChoices([]); setActive(-1); setOpen(false); setStatus("idle");
    if (selected || composing || !isPlaceSearchQueryEligible(query)) return;
    const controller = new AbortController();
    const explicit = explicitRetry.current;
    explicitRetry.current = false;
    let timer: ReturnType<typeof setTimeout>;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const current = () => generation === sequence.current && !controller.signal.aborted;
    async function search(retried = false) {
      if (!current()) return;
      setStatus("loading");
      // A hung response must leave the ordinary free-text submit usable.
      timeout = setTimeout(() => { if (current()) { setStatus("unavailable"); controller.abort(); } }, 6000);
      try {
        const response = await fetch(`/api/place-suggestions?lang=${lang}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ query, context_selection: previousSelection(), ...(explicit && !retried ? { retry: true } : {}) }),
        });
        const data = await response.json();
        if (!current()) return;
        clearTimeout(timeout);
        // A provider deadline is a transient unavailable response too. Retry
        // once for this query; repeated failures stay explicit and actionable.
        // The server says when a retry cannot help (its provider is resting).
        if ((data.status === "busy" || response.status === 429 || (response.ok && data.status === "unavailable" && data.retryable !== false)) && !retried) {
          timer = setTimeout(() => search(true), Math.max(500, Math.min(2000, Number(data.retry_after_ms) || 1000)));
          return;
        }
        if (!response.ok || data.status !== "ready") { setStatus("unavailable"); return; }
        const rows: PlaceSuggestion[] = (Array.isArray(data.choices) ? data.choices : []).filter((row: PlaceSuggestion) =>
          typeof row?.title === "string" && row.title.trim().length > 0 && typeof row?.context === "string" && typeof row?.query === "string" && row.query.trim().length > 0 && row.query.length <= 200 &&
          typeof row?.selection_id === "string" && row.selection_id.length > 0 && row.selection_id.length <= 8192).slice(0, 5);
        setChoices(rows); setStatus("ready"); setOpen(rows.length > 0 && !dismissed.current);
      } catch { if (current()) setStatus("unavailable"); }
      finally { clearTimeout(timeout); }
    }
    timer = setTimeout(() => search(), 200);
    return () => { controller.abort(); clearTimeout(timer); clearTimeout(timeout); };
  }, [value, lang, selected, composing, retryGeneration]);

  useEffect(() => {
    setWaitShown(false);
    pendingLong.current = false;
    if (status !== "loading") return;
    const timer = setTimeout(() => {
      pendingLong.current = true;
      if (!dismissed.current && document.activeElement === inputRef.current) setWaitShown(true);
    }, WAIT_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [status, inputRef]);

  function dismiss() { dismissed.current = true; setOpen(false); setActive(-1); setWaitShown(false); }
  function choose(choice: PlaceSuggestion) { dismiss(); onSelect(choice); }
  const shown = open && choices.length > 0;
  const waiting = waitShown && status === "loading" && !shown;
  // Measured again whenever either layer appears, including the wait line
  // handing over to the list, and before paint, so neither opens on a stale side.
  useLayoutEffect(() => {
    if (!shown && !waiting) return;
    const rect = inputRef.current?.getBoundingClientRect();
    const height = window.visualViewport?.height ?? window.innerHeight;
    const offset = window.visualViewport?.offsetTop ?? 0;
    if (rect) setAbove(height + offset - rect.bottom < 220 && rect.top - offset > 220);
  }, [shown, waiting, inputRef]);
  // On a phone the wait narrows the input, which by itself leaves the caret
  // where it was, now behind the label. A caret at the end stays in view.
  // A caret moved back inside the text is left where the reader put it, even
  // if the narrowing hides it until the lookup answers (accepted, Nov 2026).
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!waiting || !input || document.activeElement !== input) return;
    if (input.selectionStart === input.value.length && input.selectionEnd === input.value.length) input.scrollLeft = input.scrollWidth;
  }, [waiting, inputRef]);
  // Typing a place is the landing's one task, so a reader with a mouse and
  // keyboard starts in the field. On touch an autofocused field raises the
  // on-screen keyboard over the page (it once caught a tap meant for
  // Continue), so there the field waits for a tap.
  useEffect(() => {
    if (window.matchMedia?.("(pointer: fine)").matches) inputRef.current?.focus({ preventScroll: true });
  }, [inputRef]);
  useEffect(() => {
    if (!shown || active < 0) return;
    const list = listRef.current;
    const option = document.getElementById(`${listId}-${active}`);
    if (!list || !option) return;
    // Only scroll the results, not the whole page around the focused field.
    const listRect = list.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    // Round outward: scrollTop snaps to whole pixels, and a fractional
    // row edge would otherwise stay a sub-pixel outside the list.
    if (optionRect.top < listRect.top) list.scrollTop += Math.floor(optionRect.top - listRect.top);
    else if (optionRect.bottom > listRect.bottom) list.scrollTop += Math.ceil(optionRect.bottom - listRect.bottom);
  }, [shown, active, listId]);
  useEffect(() => {
    const input = inputRef.current;
    if (!selected || !input) { setSelectedOverflows(false); return; }
    let active = true;
    const measure = () => {
      if (active) setSelectedOverflows(input.clientWidth > 0 && input.scrollWidth > input.clientWidth + 1);
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(input);
    void document.fonts?.ready.then(measure);
    return () => { active = false; observer?.disconnect(); };
  }, [selected, value, inputRef]);
  return (
    <div className="relative min-w-0 flex-1" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dismiss(); }}>
      {/* One edge at a time: a quiet border at rest, an accent while typing.
          A blocked location marks the field as the next way in. */}
      {/* The whole box is the field: a press on the pin or the padding puts
          the caret in the input. preventDefault keeps focus from leaving
          first (no blur, so no dismiss); the click repeats the focus for a
          touch browser that only raises its keyboard from a click. */}
      <div onMouseDown={event => { if (event.target !== inputRef.current) { event.preventDefault(); inputRef.current?.focus(); } }}
        onClick={event => { if (event.target !== inputRef.current) inputRef.current?.focus(); }}
        className={"flex min-h-14 cursor-text items-center gap-3 rounded-parranda-btn border-line bg-parranda-surface px-4 focus-within:ring-1 focus-within:ring-parranda-clay transition-[background-color,border-color] duration-150 ease-out " +
        (geoDenied ? "border-parranda-glow focus-within:border-parranda-ember" : "border-parranda-line-strong hover:not-focus-within:border-parranda-ink focus-within:border-parranda-clay")}>
        <SearchIcon className="h-4.5 w-4.5 text-parranda-ink-muted" />
        <input id="landingCity" ref={inputRef} value={value} onChange={onChange}
          role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={shown ? listId : undefined}
          aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
          onFocus={() => { dismissed.current = false; setOpen(choices.length > 0); if (pendingLong.current && status === "loading") setWaitShown(true); }}
          onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") { event.preventDefault(); dismiss(); }
            if (choices.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault(); dismissed.current = false; setOpen(true);
              setActive(index => event.key === "ArrowDown" ? (index + 1) % choices.length : (index <= 0 ? choices.length - 1 : index - 1));
            }
            if (shown && active >= 0 && event.key === "Enter") { event.preventDefault(); choose(choices[active]); }
          }}
          autoComplete="off"
          placeholder={t("Stad eller plats", "City or place")}
          className="min-w-0 flex-1 self-stretch bg-transparent text-17 text-parranda-ink outline-hidden placeholder:text-parranda-ink-meta focus-visible:outline-hidden" />
        {waiting && <span aria-hidden="true" data-place-wait="" className={phoneWait}>{t("Söker …", "Finding …")}</span>}
      </div>
      {selected && selectedOverflows && <span aria-hidden="true" className="mt-2 block text-15 leading-snug text-parranda-ink-muted [overflow-wrap:anywhere] sm:hidden">{value}</span>}
      {shown && <div className={"relative z-(--p-z-popover) mt-2 rounded-parranda bg-parranda-surface shadow-pop motion-safe:animate-panel-in sm:absolute sm:inset-x-0 " + (above ? "sm:bottom-full sm:mb-2 sm:mt-0" : "sm:top-full")}>
        <ul ref={listRef} id={listId} role="listbox" aria-label={t("Platsförslag", "Place suggestions")} className="max-h-[min(18rem,40svh)] overflow-y-auto overscroll-contain p-1">
          {choices.map((choice, index) => <li key={choice.selection_id} id={`${listId}-${index}`} role="option" aria-selected={active === index}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(choice)} onMouseMove={event => pointerPicks(event, index)}
            className={"cursor-pointer rounded-parranda-btn px-4 py-3 text-parranda-ink transition-[background-color] duration-150 ease-out active:bg-parranda-fill-strong " + (active === index ? "bg-parranda-fill" : "hover:bg-parranda-fill-faint")}>
            <span className="block text-17 font-bold leading-tight [overflow-wrap:anywhere]">{choice.title}</span>
            {(choice.context || kindLabel(choice.kind)) && <span className="mt-1 block text-13 text-parranda-ink-meta [overflow-wrap:anywhere]">
              {[kindLabel(choice.kind), choice.context].filter(Boolean).join(" · ")}
            </span>}
          </li>)}
        </ul>
        {choices.some(choice => choice.attribution) && <div className="border-t-line border-parranda-line-faint px-5 py-2 text-11 text-parranda-ink-meta">
          {[...new Set(choices.map(choice => choice.attribution === "GeoNames" ? "geonames" : choice.attribution ? "osm" : null).filter(Boolean))].map((source, index) =>
            <span key={source}>{index > 0 && " · "}{source === "geonames"
              ? <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames (CC BY 4.0)</a>
              : <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}</span>)}
        </div>}
      </div>}
      {/* One live region: a slow lookup only makes the same sentence visible,
          so it is never announced twice, and it floats, so nothing moves. From
          sm up it floats where the popover list will open. On a phone the
          list arrives in flow above Build my day, and a floating line there
          would cover that button, so this region stays sr-only and the short
          aria-hidden label inside the box shows the wait, narrowing the input
          rather than covering its text. An unavailable lookup's sentence wins. */}
      <span role="status" className={status === "unavailable" ? "mt-2 block text-13 text-parranda-ink-meta"
        : waiting ? `${waitLine} ` + (above ? "sm:top-auto sm:bottom-full sm:mb-2 sm:mt-0" : "sm:top-full sm:mt-2")
        : "sr-only"}>
        {status === "loading" ? t("Söker platser …", "Finding places …") : status === "unavailable" ? t("Förslag saknas just nu. Du kan ändå söka med Bygg min dag.", "Suggestions are unavailable. You can still search with Build my day.") : ""}
      </span>
      {status === "unavailable" && <button type="button"
        onClick={() => { explicitRetry.current = true; setRetryGeneration(generation => generation + 1); inputRef.current?.focus(); }}
        className={buttonClass("quiet", "-ml-3 min-h-11 px-3 text-13 underline underline-offset-2")}>
        {t("Försök igen", "Try again")}
      </button>}
    </div>
  );
}
