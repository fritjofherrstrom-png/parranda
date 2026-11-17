import { stopCategoryFamily } from "../../lib/stop-category.mjs";
import { stopTypeLabel, type StopCardFactsInput } from "../../lib/stop-card-facts.mjs";
import { typeLabel, type Lang } from "./copy";

// A source kind describes the place, never its route admission or requested fit.
// Unknown types stay unlabelled; second-hand trade stays broad unless its own
// source category supports a narrower label.
export function stopCategoryLabel(stop: StopCardFactsInput | null | undefined, lang: Lang): string {
  return stop?.type === "vintage-shop"
    ? stopTypeLabel(stop, lang)
    : typeLabel(stop?.type, lang);
}

export default function StopCategory({ type, label, muted = false }: { type: unknown; label: string; muted?: boolean }) {
  const family = stopCategoryFamily(type);
  return (
    <span
      data-stop-category={family || "other"}
      className={
        // Linje 2: what kind of place, said in words under its name with a
        // small mark; information, never a chip that reads like a control.
        "inline-flex max-w-full items-center gap-1.5 text-sm font-medium leading-snug " +
        (muted ? "text-parranda-ink-meta" : "text-parranda-ink-muted")
      }
    >
      {/* Linje 2 board: the kind in words only; the family stays as data. */}
      <span className="truncate">{label}</span>
    </span>
  );
}
