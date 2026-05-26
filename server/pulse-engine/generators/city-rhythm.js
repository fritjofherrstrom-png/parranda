/**
 * Shared computed city rhythm signals.
 *
 * These are deliberately small, city-agnostic timing cues. They are not
 * editorial picks, live events, venues, or source-backed recommendations.
 * The only input is the city's local clock, so every city can get a basic
 * Pulse floor without borrowing Rome/Barcelona content.
 */

const RHYTHM_WINDOWS = [
  {
    id: "morning-start",
    type: "local_timing_advice",
    startsAt: 7 * 60,
    endsAt: 10 * 60 + 59,
    score: 2.2,
    vibes: ["slow", "curious"],
    routeHints: {
      preferred_vibes: ["slow", "curious"],
      avoid_vibes: ["party"],
    },
    copy: {
      en: {
        title: "Start gently before the day tightens",
        kind: "City rhythm",
        kindLabel: "City rhythm",
        when: "Morning",
        reason: "The city-local morning window is better for one calm first move than an overloaded plan.",
        blurb: "Keep the first stop simple, then let the day open from there.",
        pitch: "One calm first move gives the day room to find its shape.",
      },
      sv: {
        title: "Börja mjukt innan dagen tätnar",
        kind: "Stadsrytm",
        kindLabel: "Stadsrytm",
        when: "Morgon",
        reason: "Stadens lokala morgonfönster passar bättre för ett lugnt första drag än en överlastad plan.",
        blurb: "Håll första stoppet enkelt och låt dagen öppna sig därifrån.",
        pitch: "Ett lugnt första drag ger dagen plats att hitta sin form.",
      },
    },
  },
  {
    id: "midday-compact",
    type: "local_timing_advice",
    startsAt: 11 * 60,
    endsAt: 14 * 60 + 59,
    score: 2.0,
    vibes: ["curious"],
    routeHints: {
      preferred_vibes: ["curious"],
    },
    copy: {
      en: {
        title: "Keep the middle of the day compact",
        kind: "City rhythm",
        kindLabel: "City rhythm",
        when: "Midday",
        reason: "City-local midday is usually the moment to reduce walking drift and keep the next move close.",
        blurb: "A tighter radius will usually feel better than chasing one more distant stop.",
        pitch: "A tighter radius keeps the plan useful when the day is at its busiest.",
      },
      sv: {
        title: "Håll mitt på dagen kompakt",
        kind: "Stadsrytm",
        kindLabel: "Stadsrytm",
        when: "Mitt på dagen",
        reason: "Stadens lokala mitt-på-dagen-läge är oftast rätt stund att minska gångdrift och hålla nästa drag nära.",
        blurb: "En tätare radie känns oftast bättre än att jaga ett stopp till på avstånd.",
        pitch: "En tätare radie håller planen användbar när dagen är som mest upptagen.",
      },
    },
  },
  {
    id: "evening-settle",
    type: "evening_window",
    startsAt: 17 * 60,
    endsAt: 21 * 60 + 59,
    score: 2.8,
    vibes: ["buzzy", "romantic"],
    routeHints: {
      preferred_vibes: ["buzzy", "romantic"],
      avoid_vibes: ["slow"],
    },
    copy: {
      en: {
        title: "The city is moving into evening mode",
        kind: "Evening window",
        kindLabel: "Evening window",
        when: "Evening",
        reason: "The city-local evening window is the better moment to tighten the route around food, bars, or one atmospheric walk.",
        blurb: "Pick a smaller area and let dinner, light, and nearby stops do more of the work.",
        pitch: "A smaller evening radius makes the next few hours feel intentional.",
      },
      sv: {
        title: "Staden går in i kvällsläge",
        kind: "Kvällsfönster",
        kindLabel: "Kvällsfönster",
        when: "Kväll",
        reason: "Stadens lokala kvällsfönster är rättare läge för att tajta rutten runt mat, barer eller en stämningsfull promenad.",
        blurb: "Välj ett mindre område och låt middag, ljus och närliggande stopp göra mer av jobbet.",
        pitch: "En mindre kvällsradie gör de närmaste timmarna mer avsiktliga.",
      },
    },
  },
  {
    id: "late-soft-landing",
    type: "evening_window",
    startsAt: 22 * 60,
    endsAt: 1 * 60 + 59,
    score: 2.1,
    vibes: ["buzzy", "slow"],
    routeHints: {
      preferred_vibes: ["buzzy", "slow"],
    },
    copy: {
      en: {
        title: "Late night needs a softer landing",
        kind: "Late window",
        kindLabel: "Late window",
        when: "Late",
        reason: "The city-local late window is better for one nearby continuation than a fresh cross-town plan.",
        blurb: "Stay close to where you already are and keep the next move easy to abandon.",
        pitch: "One nearby continuation is safer than restarting the night from scratch.",
      },
      sv: {
        title: "Sent läge behöver en mjukare landning",
        kind: "Sent fönster",
        kindLabel: "Sent fönster",
        when: "Sent",
        reason: "Stadens lokala sena fönster passar bättre för en närliggande fortsättning än en ny plan tvärs över stan.",
        blurb: "Stanna nära där du redan är och håll nästa drag lätt att avbryta.",
        pitch: "En närliggande fortsättning är tryggare än att starta om kvällen från noll.",
      },
    },
  },
];

function cityRhythmGenerator(context) {
  if (!context?.city?.key || !context?.date || !context?.cityNow) {
    return [];
  }

  if (context.cityNow.isoDate && context.cityNow.isoDate !== context.date) {
    return [];
  }

  const totalMinutes = Number(context.cityNow.hour) * 60 + Number(context.cityNow.minute || 0);
  const window = RHYTHM_WINDOWS.find((candidate) => isWithinWindow(totalMinutes, candidate));
  if (!window) return [];

  const lang = context.lang === "en" ? "en" : "sv";
  const copy = window.copy[lang];

  return [
    {
      id: `city-rhythm-${context.date}-${window.id}`,
      type: window.type,
      level: "city",
      title: copy.title,
      reason: copy.reason,
      editorial_pitch: copy.pitch,
      blurb: copy.blurb,
      kind: copy.kind,
      kindLabel: copy.kindLabel,
      when: copy.when,
      source: {
        kind: "computed",
        label: lang === "en" ? "city-local time" : "stadens lokala tid",
      },
      trust_level: "verified",
      freshness: "live",
      time_window: {
        hours: [Math.floor(window.startsAt / 60), Math.floor(window.endsAt / 60)],
      },
      route_hints: window.routeHints,
      matches_vibes: window.vibes,
      score: window.score,
    },
  ];
}

function isWithinWindow(totalMinutes, window) {
  if (window.startsAt <= window.endsAt) {
    return totalMinutes >= window.startsAt && totalMinutes <= window.endsAt;
  }
  return totalMinutes >= window.startsAt || totalMinutes <= window.endsAt;
}

cityRhythmGenerator.generatorId = "city-rhythm";

module.exports = cityRhythmGenerator;
module.exports.RHYTHM_WINDOWS = RHYTHM_WINDOWS;
