/** Describe only the published route's server-owned walking verdict. */
export function walkingTargetNote(negotiation, lang = "sv") {
  const walking = negotiation?.walking;
  if (negotiation?.route_present !== true ||
      walking?.status !== "shorter_than_requested_band" ||
      !Number.isFinite(walking?.target_km) ||
      !Number.isFinite(walking?.estimated_km) ||
      !Number.isFinite(walking?.target_floor_km)) return "";

  const locale = lang === "en" ? "en-GB" : "sv-SE";
  const km = value => Number(value).toLocaleString(locale, { maximumFractionDigits: 1 });
  return lang === "en"
    ? `You chose ${km(walking.target_km)} km. This route is about ${km(walking.estimated_km)} km, below the ${km(walking.target_floor_km)} km target range. A longer visitable route has not been confirmed from the current sources; changing the walking goal can also change the stops and produce a shorter day.`
    : `Du valde ${km(walking.target_km)} km. Den här rutten är cirka ${km(walking.estimated_km)} km, under målspannets ${km(walking.target_floor_km)} km. En längre besökbar rutt är inte bekräftad med nuvarande källor; ett ändrat gångmål kan också byta stopp och ge en kortare dag.`;
}
