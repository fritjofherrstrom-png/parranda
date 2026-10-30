/**
 * "LET PARRANDA CHOOSE" — for a reader who doesn't know, or doesn't want, to
 * pick. Off: one offer to let Parranda choose the day's interests. On: what
 * Parranda chose for the day on screen, one status label per pick with its
 * reason (read from the server's evidence, never decided here), and one tap to
 * take over with those picks preselected in Adjust. Experimental: the planner
 * renders this only behind the `parranda_chooses` flag.
 */
import { buttonClass, Eyebrow, labelChip, panelCard } from "../shared/ui";
import type { ParrandaChoiceView } from "../../lib/parranda-choice.mjs";
import type { Translate } from "./copy";

export default function ParrandaChoice({
  t,
  active,
  view,
  composing,
  onChoose,
  onTakeOver,
}: {
  t: Translate;
  /** The reader has asked Parranda to choose. */
  active: boolean;
  /** Parranda's choice for the day on screen, when it carries one. */
  view: ParrandaChoiceView | null;
  /** A day is being composed for the current inputs. */
  composing: boolean;
  onChoose: () => void;
  /** Leave the mode, with these picks preselected. */
  onTakeOver: (keys: string[]) => void;
}) {
  if (!active) {
    return (
      <section aria-label={t("Låt Parranda välja", "Let Parranda choose")} className="flex flex-col items-start gap-2">
        <button type="button" onClick={onChoose} className={buttonClass("dashed", "min-h-11 px-4 text-sm")}>
          {t("Låt Parranda välja dagen", "Let Parranda choose the day")}
        </button>
        <p className="text-13 leading-snug text-parranda-ink-muted">
          {t(
            "Vet du inte vad du vill? Parranda väljer inriktning efter platserna, tiden och vädret. Du kan ta över när som helst.",
            "Not sure what you want? Parranda picks the day's direction from the places, the time and the weather. Take over any time.",
          )}
        </p>
      </section>
    );
  }

  const picks = view && !composing ? view.picks : [];
  const settled = Boolean(view) && !composing;
  return (
    <section aria-label={t("Parrandas val", "Parranda's choice")} className={`flex flex-col gap-3 p-4 ${panelCard}`}>
      <Eyebrow tone="glow">{settled && picks.length ? t("Parranda valde", "Parranda chose") : t("Parranda väljer", "Parranda chooses")}</Eyebrow>
      {!settled ? (
        <p className="text-13 leading-snug text-parranda-ink-muted">
          {composing
            ? t("Väljer efter platserna, tiden och vädret …", "Choosing from the places, the time and the weather …")
            : t("Parranda kunde inte välja för den här dagen.", "Parranda couldn't choose for this day.")}
        </p>
      ) : (
        <>
          {picks.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={t("Valda inriktningar", "Chosen directions")}>
              {picks.map((pick) => (
                <li key={pick.key} className={labelChip}>
                  <span className="font-bold text-parranda-ink">{pick.label}</span>
                  {pick.reason && <span>· {pick.reason}</span>}
                </li>
              ))}
            </ul>
          )}
          {view?.note && <p className="text-13 leading-snug text-parranda-ink-muted">{view.note}</p>}
        </>
      )}
      <button
        type="button"
        onClick={() => onTakeOver(picks.map((pick) => pick.key))}
        className={`${buttonClass("secondary", "min-h-11 px-4 text-sm")} self-start`}
      >
        {picks.length ? t("Ta över valen", "Take over the picks") : t("Välj själv", "Choose yourself")}
      </button>
    </section>
  );
}
