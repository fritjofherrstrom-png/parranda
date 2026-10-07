/**
 * Without a primary route, the broader place structure remains useful — but it
 * is explicitly candidates, never a second itinerary: no station numbers, no
 * line, no daypart headings, no walks between clusters. Those read as an order,
 * and only primary_route.main_stops is a route.
 */
import type { ReactNode } from "react";
import { mapsPlaceUrl } from "../../lib/maps-links.mjs";
import { ExternalIcon, KeepIcon, MinusIcon, PlusIcon } from "../shared/icons";
import { buttonClass, Eyebrow, panelCard } from "../shared/ui";
import { INTENT_LABELS, label, type Lang, type Translate } from "./copy";
import { canCommitTo, type Commitments } from "./commitments";
import type { DistrictArea } from "./types";

export default function CandidateAreas({
  t,
  lang,
  map,
  structureOnly,
  areas,
  missingIntents,
  mapsPlaceContext,
  expandedCandidateKey,
  setExpandedCandidateKey,
  commitments,
  releaseCommitment,
  commit,
}: {
  t: Translate;
  lang: Lang;
  map: ReactNode;
  structureOnly: boolean;
  areas: DistrictArea[];
  missingIntents: string[];
  mapsPlaceContext: string | null | undefined;
  expandedCandidateKey: string | null;
  setExpandedCandidateKey: (key: string | null) => void;
  commitments: Commitments;
  releaseCommitment: (identity: string) => void;
  commit: (identity: string, kind: "exclude" | "pin", commitLabel: string) => void;
}) {
  return (
    <section className={`flex flex-col gap-4 p-4 sm:p-5 ${panelCard}`}>
      <div>
        <Eyebrow>{t("Kandidater nära platsen", "Candidates near this place")}</Eyebrow>
        {structureOnly && (
          <p className="mt-1.5 text-sm text-parranda-ink/75">
            {t(
              "Parranda hittade platskandidater, men inte en tillräckligt stark rutt ännu.",
              "Parranda found place candidates, but not a reliable route yet.",
            )}
          </p>
        )}
      </div>

      {map}

      <ul className="flex flex-col gap-3">
        {areas.map((area, index) => (
          <li key={index} className="rounded-parranda border-[1.5px] border-parranda-ink/12 bg-parranda-paper p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {(area.covers ?? []).map((axis) => (
                <span key={axis} className="rounded-full bg-parranda-ink px-2.5 py-0.5 text-xs font-bold text-parranda-paper">
                  {label(INTENT_LABELS, axis, lang)}
                </span>
              ))}
              <span className="type-data ml-auto text-[11px] text-parranda-ink/68">
                {(area.stop_ids?.length ?? area.stops?.length ?? 0)} {t("träffar", "places")}
              </span>
            </div>
            {Array.isArray(area.stops) && area.stops.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1 text-sm text-parranda-ink">
                {area.stops.map((stop, si) => {
                  const url = mapsPlaceUrl(stop, mapsPlaceContext);
                  const name = (stop.name || area.stop_names?.[si] || "").trim();
                  if (!name) return null;
                  const candidateKey = `cluster:${index}:${stop.id || stop.candidate_id || stop.place_id || si}`;
                  const candidateId = String(stop?.id ?? stop?.place_id ?? stop?.candidate_id ?? "").trim();
                  const candidatePanelId = `candidate-panel-cluster-${index}-${si}`;
                  const expanded = expandedCandidateKey === candidateKey;
                  const facts = [...new Set([stop.address, stop.area].map((value) => String(value || "").trim()).filter(Boolean))];
                  return (
                    <li key={stop.id ?? si} className="rounded-parranda-btn border-[1.5px] border-parranda-ink/10 px-3 py-1">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={candidatePanelId}
                        onClick={() => setExpandedCandidateKey(expanded ? null : candidateKey)}
                        className="flex min-h-11 w-full items-center justify-between gap-3 text-left font-bold transition hover:text-parranda-clay"
                      >
                        <span>{name}</span>
                        {expanded ? <MinusIcon className="h-4 w-4 shrink-0 text-parranda-ember" /> : <PlusIcon className="h-4 w-4 shrink-0 text-parranda-ink/68" />}
                      </button>
                      {expanded && (
                        <div id={candidatePanelId} className="border-t border-parranda-ink/12 pb-2 pt-2">
                          {facts.length > 0 && <p className="text-xs text-parranda-ink/68">{facts.join(" · ")}</p>}
                          {url && (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={buttonClass("primary", "mt-2 min-h-11 w-full px-4 text-sm sm:w-auto")}
                            >
                              {t("Öppna platsen i Maps", "Open place in Maps")}
                              <ExternalIcon />
                            </a>
                          )}
                          {candidateId && (commitments[candidateId]?.kind === "pin" || canCommitTo(stop)) && (
                            <button
                              type="button"
                              onClick={() =>
                                commitments[candidateId]?.kind === "pin"
                                  ? releaseCommitment(candidateId)
                                  : commit(candidateId, "pin", name)
                              }
                              className={`mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-parranda-btn border-[1.5px] px-4 text-sm font-bold transition sm:ml-2 sm:w-auto ${
                                commitments[candidateId]?.kind === "pin"
                                  ? "border-parranda-ember/60 bg-parranda-ember/10 text-parranda-ink hover:border-parranda-ember"
                                  : "border-parranda-ink/20 text-parranda-ink hover:border-parranda-ink/50"
                              }`}
                            >
                              <KeepIcon className="h-4 w-4 text-parranda-ember" />
                              {commitments[candidateId]?.kind === "pin"
                                ? t("Med i dagen — släpp", "In my day — release")
                                : t("Lägg till i min dag", "Add to my day")}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (area.stop_names ?? []).length > 0 ? (
              <p className="mt-2 text-sm text-parranda-ink">{(area.stop_names ?? []).join(" · ")}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {/* The evening event is NOT presented here: a woven event renders once,
          as the route extension on the line; a non-woven anchor event
          surfaces in Live's tonight bucket. */}

      {missingIntents.length > 0 && (
        <p className="text-sm text-parranda-ink/72">
          {t("Ingen av kandidaterna täcker:", "None of these candidates cover:")} {missingIntents.map((k) => label(INTENT_LABELS, k, lang)).join(", ")}
        </p>
      )}
    </section>
  );
}
