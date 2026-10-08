import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { LAST_KEY } from "../lib/anywhere-storage.mjs";
import { SearchIcon } from "./shared/icons";

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
  const dismissed = useRef(false);
  const sequence = useRef(0);
  const t = (sv: string, en: string) => lang === "sv" ? sv : en;
  // A region and its city can share a name and country; settlements stay unmarked.
  const kindLabel = (kind?: PlaceSuggestion["kind"]) =>
    kind === "region" ? t("Region", "Region") : kind === "district" ? t("Stadsdel", "District") : "";

  useEffect(() => {
    const generation = ++sequence.current;
    const query = value.trim();
    dismissed.current = false;
    setChoices([]); setActive(-1); setOpen(false); setStatus("idle");
    if (selected || composing || query.length < 3 || query.length > 200) return;
    const controller = new AbortController();
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
          body: JSON.stringify({ query, context_selection: previousSelection() }),
        });
        const data = await response.json();
        if (!current()) return;
        clearTimeout(timeout);
        if ((data.status === "busy" || response.status === 429) && !retried) {
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
  }, [value, lang, selected, composing]);

  function dismiss() { dismissed.current = true; setOpen(false); setActive(-1); }
  function choose(choice: PlaceSuggestion) { dismiss(); onSelect(choice); }
  const shown = open && choices.length > 0;
  useEffect(() => {
    if (!shown) return;
    const rect = inputRef.current?.getBoundingClientRect();
    const height = window.visualViewport?.height ?? window.innerHeight;
    const offset = window.visualViewport?.offsetTop ?? 0;
    if (rect) setAbove(height + offset - rect.bottom < 220 && rect.top - offset > 220);
  }, [shown, inputRef]);
  useEffect(() => {
    if (shown && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [shown, active, listId]);
  return (
    <div className="relative min-w-0 flex-1" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dismiss(); }}>
      <div className={"flex min-h-[3.75rem] items-center gap-3 rounded-parranda border-2 bg-parranda-ink/4 px-5 transition focus-within:border-parranda-ember focus-within:ring-3 focus-within:ring-parranda-glow/60 sm:min-h-16 " + (geoDenied ? "border-parranda-glow ring-3 ring-parranda-glow" : "border-parranda-ink")}>
        <SearchIcon className="h-5 w-5 shrink-0 text-parranda-ink/68" />
        <input id="landingCity" ref={inputRef} value={value} onChange={onChange}
          role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={shown ? listId : undefined}
          aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
          onFocus={() => { dismissed.current = false; setOpen(choices.length > 0); }}
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
          placeholder={t("T.ex. Lyon eller Kyoto", "e.g. Lyon or Kyoto")} autoComplete="off" autoFocus
          className="min-w-0 flex-1 bg-transparent text-lg text-parranda-ink outline-hidden placeholder:text-parranda-ink/68 focus-visible:outline-hidden sm:text-xl" />
      </div>
      {shown && <div className={"absolute inset-x-0 z-40 overflow-hidden rounded-parranda border border-parranda-ink/20 bg-parranda-paper shadow-xl " + (above ? "bottom-full mb-1" : "top-full mt-1")}>
        <ul id={listId} role="listbox" aria-label={t("Platsförslag", "Place suggestions")} className="max-h-72 overflow-y-auto py-1">
          {choices.map((choice, index) => <li key={choice.selection_id} id={`${listId}-${index}`} role="option" aria-selected={active === index}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(choice)} onMouseEnter={() => setActive(index)}
            className={"cursor-pointer px-5 py-3 text-parranda-ink " + (active === index ? "bg-parranda-ink/8" : "hover:bg-parranda-ink/4")}>
            <span className="block text-base font-bold">{choice.title}</span>
            {(choice.context || kindLabel(choice.kind)) && <span className="block text-sm text-parranda-ink/68">
              {[kindLabel(choice.kind), choice.context].filter(Boolean).join(" · ")}
            </span>}
          </li>)}
        </ul>
        {choices.some(choice => choice.attribution) && <div className="border-t border-parranda-ink/10 px-5 py-1.5 text-[11px] text-parranda-ink/60">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
        </div>}
      </div>}
      <span role="status" className={status === "unavailable" ? "mt-1 block text-xs text-parranda-ink/68" : "sr-only"}>
        {status === "loading" ? t("Söker platser …", "Finding places …") : status === "unavailable" ? t("Förslag kunde inte hämtas. Du kan ändå söka.", "Suggestions unavailable. You can still search.") : ""}
      </span>
    </div>
  );
}
