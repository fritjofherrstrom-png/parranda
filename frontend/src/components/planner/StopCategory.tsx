import { stopCategoryFamily } from "../../lib/stop-category.mjs";
import { stopTypeLabel, type StopCardFactsInput } from "../../lib/stop-card-facts.mjs";
import { CultureIcon, DrinkIcon, FoodIcon, NatureIcon, ShopIcon, SightIcon } from "../shared/icons";
import { typeLabel, type Lang } from "./copy";

// A source kind describes the place, never its route admission or requested fit.
// Unknown types stay unlabelled; second-hand trade stays broad unless its own
// source category supports a narrower label.
export function stopCategoryLabel(stop: StopCardFactsInput | null | undefined, lang: Lang): string {
  return stop?.type === "vintage-shop"
    ? stopTypeLabel(stop, lang)
    : typeLabel(stop?.type, lang);
}

const FAMILY_ICONS = {
  food: FoodIcon,
  drink: DrinkIcon,
  culture: CultureIcon,
  nature: NatureIcon,
  sight: SightIcon,
  shop: ShopIcon,
} as const;

/**
 * The family's sign (a plate, a leaf, a columned front). A kind without a
 * family gets no sign at all: never a guessed one, and never a stand-in dot,
 * because circles on this page are the line's stations.
 */
export function CategoryGlyph({ type, className }: { type: unknown; className: string }) {
  const family = stopCategoryFamily(type) as keyof typeof FAMILY_ICONS | null;
  const Glyph = family ? FAMILY_ICONS[family] : null;
  return Glyph ? <Glyph className={className} /> : null;
}

/**
 * What kind of place, as one quiet fact under its name: the family's sign,
 * then the kind. A fact, not a chip: a filled tag under every stop read as a
 * column of buttons. `glyph={false}` when the row's own tile already holds the
 * sign, so it is never drawn twice. `muted` (a stop already behind you) keeps
 * the same meta tone; the name beside it does the dimming.
 */
export default function StopCategory({ type, label, glyph = true }: {
  type: unknown;
  label: string;
  muted?: boolean;
  glyph?: boolean;
}) {
  const family = stopCategoryFamily(type);
  return (
    <span
      data-stop-category={family || "other"}
      className="type-data inline-flex max-w-full items-center gap-1.5 text-13 text-parranda-ink-meta"
    >
      {glyph && <CategoryGlyph type={type} className="h-3.5 w-3.5" />}
      <span className="min-w-0 wrap-anywhere">{label}</span>
    </span>
  );
}
