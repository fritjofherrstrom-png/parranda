import type { ReactNode } from "react";
import { stopCategoryFamily, type StopCategoryFamily } from "../../lib/stop-category.mjs";
import { stopTypeLabel, type StopCardFactsInput } from "../../lib/stop-card-facts.mjs";
import { CultureIcon, DrinkIcon, FoodIcon, NatureIcon, ShopIcon, SightIcon } from "../shared/icons";
import { typeLabel, type Lang } from "./copy";

const CATEGORY_ICONS: Record<StopCategoryFamily, (props: { className?: string }) => ReactNode> = {
  food: FoodIcon,
  drink: DrinkIcon,
  culture: CultureIcon,
  nature: NatureIcon,
  sight: SightIcon,
  shop: ShopIcon,
};

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
  const Symbol = family ? CATEGORY_ICONS[family] : null;
  return (
    <span
      data-stop-category={family || "other"}
      className={
        "inline-flex max-w-full items-center gap-1.5 rounded-full bg-parranda-fill py-1 pl-2 pr-2.5 text-xs font-semibold leading-none " +
        (muted ? "text-parranda-ink-meta" : "text-parranda-ink")
      }
    >
      {Symbol && <Symbol className="h-3.5 w-3.5 text-parranda-ink-muted" />}
      <span className="truncate">{label}</span>
    </span>
  );
}
