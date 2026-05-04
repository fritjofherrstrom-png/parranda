const saferCultureKinds = new Set(["church", "viewpoint", "square", "cemetery", "landmark"]);
const fragileCultureKinds = new Set(["museum"]);

function summarizeCultureStops(routeStops = []) {
  const cultureStops = routeStops.filter((stop) => (stop.tags || []).includes("kultur"));
  const fragileStops = cultureStops.filter(
    (stop) =>
      fragileCultureKinds.has(stop.kind) ||
      ((stop.tags || []).includes("museum") && !(stop.tags || []).includes("kyrkor")),
  );
  const saferStops = cultureStops.filter(
    (stop) =>
      saferCultureKinds.has(stop.kind) ||
      (stop.tags || []).includes("kyrkor") ||
      (stop.tags || []).includes("utsikt"),
  );
  const mondayClosedStops = fragileStops.filter((stop) => (stop.closedWeekdays || []).includes(1));

  return {
    cultureStops,
    fragileStops,
    saferStops,
    mondayClosedStops,
  };
}

module.exports = {
  calendar: [
    {
      id: "rome-ferragosto",
      title: "Ferragosto",
      month: 8,
      day: 15,
    },
  ],
  rules: [
    {
      id: "rome-monday-culture-risk",
      type: "weekday-opening-risk",
      match: {
        weekdays: [1],
        route_tags_any: ["kultur"],
      },
      evaluate(context) {
        const { cultureStops, fragileStops, saferStops, mondayClosedStops } = summarizeCultureStops(
          context.routeStops,
        );

        if (!cultureStops.length || !fragileStops.length) {
          return {};
        }

        if (!mondayClosedStops.length && saferStops.length > fragileStops.length) {
          return {};
        }

        const delta = mondayClosedStops.length ? -1.6 : -1;
        const noteText = mondayClosedStops.length
          ? "Måndagar kan göra kulturdelen skörare här, särskilt när några stopp har svag eller oklar måndagsöppning. Dubbelkolla öppettider innan du låser dagen."
          : "Måndagar kan göra kulturdelen skörare här när dagen lutar tungt mot känsligare inomhusstopp. Dubbelkolla öppettider innan du låser dagen.";

        return {
          score_adjustments: [
            {
              id: "monday-culture-risk",
              reason: "Måndagsrisk för känsligare kulturstopp",
              delta,
            },
          ],
          caution_notes: [
            {
              id: "monday-culture-caution",
              severity: "medium",
              text: noteText,
            },
          ],
          verify_opening_hours: [
            {
              id: "monday-culture-verify",
              scope: "culture-stops",
              reason: "Måndagsöppningar för känsliga kulturstopp bör dubbelkollas.",
            },
          ],
          prefer_tags: ["kyrkor", "utsikt"],
          avoid_tags: ["museum"],
        };
      },
    },
    {
      id: "rome-classics-crowd-suitability",
      type: "time-of-day-crowd-suitability",
      match: {
        route_tags_any: ["klassiker"],
      },
      effects: {
        score_adjustments: [
          {
            id: "classic-midday-pressure",
            reason: "Klassiska ankare känns ofta tyngre mitt på dagen",
            delta: -0.7,
          },
        ],
        route_context_notes: [
          {
            id: "classic-early-late-note",
            text: "Klassiska ankare i Rom känns ofta lättare tidigt eller sent än mitt på dagen.",
          },
        ],
      },
    },
    {
      id: "rome-ferragosto-rhythm",
      type: "calendar-holiday-effect",
      match: {
        calendar_ids: ["rome-ferragosto"],
      },
      evaluate(context) {
        const sensitiveStops = (context.routeStops || []).filter(
          (stop) => stop.kind === "museum" || stop.bookingRequired,
        );
        const delta = sensitiveStops.length > 0 ? -1.2 : -0.75;

        return {
          score_adjustments: [
            {
              id: "ferragosto-rhythm",
              reason: "Ferragosto kan ge mer skiftande öppningar och rytm i staden",
              delta,
            },
          ],
          caution_notes: [
            {
              id: "ferragosto-caution",
              severity: "medium",
              text: "Ferragosto kan ge helgrytm, ändrade öppningar och mer skiftande tempo i Rom. Dubbelkolla känsliga stopp innan du låser dagen.",
            },
          ],
          verify_opening_hours: [
            {
              id: "ferragosto-verify",
              scope: "holiday-sensitive-stops",
              reason: "Ferragosto kan ändra öppningar för känsliga stopp och större ankare.",
            },
          ],
          prefer_tags: ["utsikt", "nattliv"],
          live_context_notes: [
            {
              id: "ferragosto-live-context",
              text: "På Ferragosto kan live-lagret bli extra värdefullt när den vanliga öppningsrytmen skiftar.",
            },
          ],
        };
      },
    },
  ],
};
