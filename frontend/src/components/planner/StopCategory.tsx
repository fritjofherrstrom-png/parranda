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
      className={`max-w-full wrap-anywhere rounded-parranda-tag bg-parranda-fill px-2 py-0.5 text-xs font-semibold ${muted ? "text-parranda-ink-meta" : "text-parranda-ink-soft"}`}
    >
      {label}
    </span>
  );
}
