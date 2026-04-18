function getRomeTodayIsoDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function getMonthDay(dateString = getRomeTodayIsoDate()) {
  const date = new Date(`${dateString}T12:00:00+02:00`);
  return {
    month: date.getMonth() + 1,
    day: date.getDate(),
    weekday: date.getDay(),
  };
}

function getDateSignals(dateString = getRomeTodayIsoDate()) {
  const { month, day, weekday } = getMonthDay(dateString);
  const signals = [];

  if (month === 4 && day === 21) {
    signals.push({
      id: "natale-di-roma",
      title: "Natale di Roma",
      note:
        "21 april: Rom firar sin födelsedag. Välj gärna en rutt med kultur, historisk tyngd eller kvällspuls runt Centro, Aventinen och Trastevere.",
      vibeTags: ["kultur", "klassiker", "kväll"],
    });
  }

  if (month >= 6 && month <= 9) {
    signals.push({
      id: "estate-romana",
      title: "Sommarkväll i Rom",
      note:
        "Sommarsäsongen gör kvällar starkare än mitt på dagen. Utsikter, aperitivo och sena stopp väger därför lite tyngre.",
      vibeTags: ["sommar", "aperitivo", "kväll"],
    });
  }

  if (weekday === 5 || weekday === 6) {
    signals.push({
      id: "weekend-pulse",
      title: "Helgpuls",
      note:
        "Fredag och lördag ger mer drag i barer och torg. Boka populära cocktail- och pizzastopp i god tid om de är kvällsankare.",
      vibeTags: ["nattliv", "bokning", "barer"],
    });
  }

  if (weekday === 1) {
    signals.push({
      id: "monday-reset",
      title: "Mjuk måndag",
      note:
        "Tidiga veckokvällar fungerar ofta bättre som kultur, vin och lång middag än som ren maxad barrunda.",
      vibeTags: ["kultur", "vin", "low-key"],
    });
  }

  return signals;
}

const recurringPulseMoments = [
  {
    id: "thursday-aperitivo",
    kind: "stadspuls",
    kindLabel: "Stadspuls",
    title: "Torsdag är bäst som lång aperitivo, inte som stressig barrunda",
    note:
      "Bra kväll för två till tre smarta stopp i Monti, Testaccio eller Trastevere i stället för att försöka täcka hela stan.",
    areas: ["Monti", "Testaccio", "Trastevere"],
    tags: ["aperitivo", "vin", "kväll"],
    linked_wildcard_id: "monti-testaccio-evening",
    weekdays: [4],
    priority: 2,
  },
  {
    id: "weekend-street-pulse",
    kind: "lokal rytm",
    kindLabel: "Lokal rytm",
    title: "Fredag och lördag spiller kvällen ut på gator och piazzor",
    note:
      "Monti, Trastevere, Ostiense och Pigneto känns oftast starkast efter 18:30. Spara gärna huvudenergin till sent.",
    areas: ["Monti", "Trastevere", "Ostiense", "Pigneto"],
    tags: ["nattliv", "öl", "vin", "kväll"],
    linked_wildcard_id: "san-lorenzo-pigneto-party",
    weekdays: [5, 6],
    priority: 4,
  },
  {
    id: "sunday-soft-rome",
    kind: "lokal rytm",
    kindLabel: "Lokal rytm",
    title: "Söndag i Rom är bättre långsam än maxad",
    note:
      "Tänk mer utsikt, kyrkor, lång lunch och vin än aggressiv barrunda. Aventino, Prati, Borgo och Garbatella spelar ofta bättre då.",
    areas: ["Aventino", "Prati", "Borgo", "Garbatella"],
    tags: ["low-key", "kultur", "vin"],
    linked_wildcard_id: "aventino-trastevere-sunset",
    weekdays: [0],
    priority: 4,
  },
  {
    id: "monday-wine-culture",
    kind: "stadspuls",
    kindLabel: "Stadspuls",
    title: "Måndag vinner på kultur, vin och tydlig middag",
    note:
      "Tidiga veckan funkar smartare med kyrkor, rum och ett vinankare än med ren partyenergi från start.",
    areas: ["Monti", "Centro", "Prati"],
    tags: ["kultur", "vin", "low-key"],
    linked_wildcard_id: "prati-monti-smart",
    weekdays: [1],
    priority: 4,
  },
  {
    id: "summer-open-air",
    kind: "säsong",
    kindLabel: "Säsong",
    title: "Sommarkvällar gör piazzor och uteserveringar extra starka",
    note:
      "Under varmare månader blir det smartare att dra ned på mitt-på-dagen-planer och lägga tyngden efter solnedgång.",
    areas: ["Trastevere", "Monti", "Testaccio", "Pigneto"],
    tags: ["sommar", "aperitivo", "kväll"],
    linked_wildcard_id: "aventino-trastevere-sunset",
    months: [6, 7, 8, 9],
    priority: 3,
  },
  {
    id: "spring-and-autumn-walks",
    kind: "säsong",
    kindLabel: "Säsong",
    title: "Vår och tidig höst är gjorda för långa kvällspromenader",
    note:
      "Bra läge för att binda ihop två kvarter till fots i stället för att stanna på samma plats hela kvällen.",
    areas: ["Aventino", "Monti", "Testaccio", "Prati"],
    tags: ["promenad", "kultur", "vin"],
    linked_wildcard_id: "monti-testaccio-evening",
    months: [4, 5, 9, 10],
    priority: 2,
  },
];

const wildcardSuggestions = [
  {
    id: "monti-testaccio-evening",
    title: "Monti -> Testaccio efter mörker",
    summary:
      "Börja centralt med kultur eller ett första glas, låt middagen dra söderut och avsluta där Rom känns mer levt än uppvisat.",
    meta: "ca 7 km • mer kväll • vin + mat + natt",
    tags: ["Vin", "Mat", "Kväll"],
    preferredWeekdays: [4, 5, 6],
    preferredMonths: [4, 5, 6, 9, 10],
    baseScore: 4,
    snapshot: {
      start: { type: "preset", label: "Monti" },
      end: { type: "preset", label: "Testaccio" },
      walkingKmTarget: 7,
      distanceMode: "soft_target",
      optimizerMode: "wine-crawl",
      budgetTier: "standard",
      modifier: "evening",
      preferences: ["vin", "mat", "kultur", "hidden gems", "nattliv", "kväll"],
    },
  },
  {
    id: "garbatella-ostiense-soft",
    title: "Garbatella -> Ostiense utan turiststress",
    summary:
      "En mjuk söderkväll med gårdar, middag och bättre öl eller vin än i mer uppvisade kvarter.",
    meta: "ca 6 km • low-key • öl + vin + lokal känsla",
    tags: ["Low-key", "Öl", "Södra Rom"],
    preferredWeekdays: [0, 1, 2, 3, 4],
    baseScore: 3,
    snapshot: {
      start: { type: "preset", label: "Garbatella" },
      end: { type: "preset", label: "Ostiense" },
      walkingKmTarget: 6,
      distanceMode: "soft_target",
      optimizerMode: "bar-hop",
      budgetTier: "standard",
      modifier: "low_key",
      preferences: ["öl", "vin", "mat", "hidden gems", "low-key"],
    },
  },
  {
    id: "aventino-trastevere-sunset",
    title: "Aventino -> Trastevere i golden hour",
    summary:
      "Utsikt först, kvarterskänsla sedan och en trygg final bland vinbarer, gränder och sena småstopp.",
    meta: "ca 6 km • solnedgång • kultur + vin",
    tags: ["Sunset", "Kultur", "Vin"],
    preferredMonths: [4, 5, 6, 7, 8, 9, 10],
    baseScore: 3,
    snapshot: {
      start: { type: "preset", label: "Aventino" },
      end: { type: "preset", label: "Trastevere" },
      walkingKmTarget: 6,
      distanceMode: "soft_target",
      optimizerMode: "sunset-spots",
      budgetTier: "standard",
      modifier: "evening",
      preferences: ["utsikt", "vin", "kultur", "hidden gems", "kväll", "low-key"],
    },
  },
  {
    id: "san-lorenzo-pigneto-party",
    title: "San Lorenzo -> Pigneto när du vill ha mer puls",
    summary:
      "Billigare glas, mer folk, mindre finish och en kväll som faktiskt känns ute snarare än bokad i förväg.",
    meta: "ca 5 km • mer party • öl + cocktail + sent",
    tags: ["Party", "Öl", "Cocktail"],
    preferredWeekdays: [4, 5, 6],
    baseScore: 4,
    snapshot: {
      start: { type: "preset", label: "San Lorenzo" },
      end: { type: "preset", label: "Pigneto" },
      walkingKmTarget: 5,
      distanceMode: "soft_target",
      optimizerMode: "cocktail-night",
      budgetTier: "budget",
      modifier: "party",
      preferences: ["öl", "cocktail", "mat", "hidden gems", "nattliv", "party", "kväll"],
    },
  },
  {
    id: "prati-monti-smart",
    title: "Prati -> Monti när du vill ha smartare centro",
    summary:
      "Lugnare väststart, kultur mellan och vinfinal i Monti när du vill känna centrala Rom utan att fastna i de mest uppenbara flödena.",
    meta: "ca 7 km • kultur + vin • low-key",
    tags: ["Kultur", "Vin", "Centro"],
    preferredWeekdays: [1, 2, 3, 4],
    baseScore: 3,
    snapshot: {
      start: { type: "preset", label: "Prati" },
      end: { type: "preset", label: "Monti" },
      walkingKmTarget: 7,
      distanceMode: "soft_target",
      optimizerMode: "church-crawl",
      budgetTier: "standard",
      modifier: "culture",
      preferences: ["vin", "kultur", "kyrkor", "hidden gems", "low-key"],
    },
  },
  {
    id: "natale-di-roma-loop",
    title: "Centro -> Aventino -> Trastevere på Roms födelsedag",
    summary:
      "När 21 april firas vinner historisk tyngd, kvällsljus och kvarter nära den gamla stadskärnan över mer perifera sidospår.",
    meta: "ca 7 km • 21 april • klassiker rätt tajmade",
    tags: ["Speciell dag", "Kultur", "Kväll"],
    preferredMonthDays: ["4-21"],
    baseScore: 10,
    snapshot: {
      start: { type: "preset", label: "Colosseum" },
      end: { type: "preset", label: "Trastevere" },
      walkingKmTarget: 7,
      distanceMode: "soft_target",
      optimizerMode: "sunset-spots",
      budgetTier: "standard",
      modifier: "culture",
      preferences: ["kultur", "klassiker", "vin", "hidden gems", "kväll"],
    },
  },
];

function matchesRecurringMoment(moment, { month, day, weekday }) {
  if (moment.weekdays && !moment.weekdays.includes(weekday)) {
    return false;
  }

  if (moment.months && !moment.months.includes(month)) {
    return false;
  }

  if (moment.monthDays && !moment.monthDays.includes(`${month}-${day}`)) {
    return false;
  }

  return true;
}

function wildcardScheduleScore(wildcard, { month, day, weekday }) {
  let score = wildcard.baseScore || 0;

  if (wildcard.preferredWeekdays?.includes(weekday)) {
    score += 4;
  }

  if (wildcard.preferredMonths?.includes(month)) {
    score += 2;
  }

  if (wildcard.preferredMonthDays?.includes(`${month}-${day}`)) {
    score += 8;
  }

  if ((weekday === 5 || weekday === 6) && wildcard.snapshot.modifier === "party") {
    score += 2;
  }

  if (weekday === 0 && wildcard.snapshot.modifier === "low_key") {
    score += 2;
  }

  if (weekday === 1 && wildcard.snapshot.modifier === "culture") {
    score += 2;
  }

  if (month >= 6 && month <= 9 && wildcard.snapshot.optimizerMode === "sunset-spots") {
    score += 2;
  }

  return score;
}

function buildWildcardSnapshot(wildcard, dateString) {
  return {
    ...wildcard.snapshot,
    dates: [dateString],
    dateFrom: dateString,
    dateTo: dateString,
  };
}

function getWildcardSuggestions(dateString = getRomeTodayIsoDate()) {
  const dateInfo = getMonthDay(dateString);

  return wildcardSuggestions
    .map((wildcard) => ({
      ...wildcard,
      score: wildcardScheduleScore(wildcard, dateInfo),
      snapshot: buildWildcardSnapshot(wildcard, dateString),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map(({ score, ...wildcard }) => wildcard);
}

function buildCityPulseHeadline(dateString, moments) {
  const { month, day, weekday } = getMonthDay(dateString);

  if (month === 4 && day === 21) {
    return "I dag får Rom extra historisk puls och mer folk nära den gamla stadskärnan.";
  }

  if (weekday === 5 || weekday === 6) {
    return "I kväll lönar det sig att tänka sent, kvartersdrivet och mindre uppstyrt.";
  }

  if (weekday === 0) {
    return "I dag spelar Rom bättre långsamt än maxat.";
  }

  if (weekday === 1) {
    return "Tidiga veckan är smartare med kultur, vin och ett tydligt middagsankare.";
  }

  if (moments[0]?.note) {
    return moments[0].note;
  }

  return "Små datumgrejer, stadspuls och officiella tips kan göra stor skillnad för hur dagen faktiskt känns.";
}

function getCityPulse(dateString = getRomeTodayIsoDate()) {
  const normalizedDate = dateString || getRomeTodayIsoDate();
  const dateSignals = getDateSignals(normalizedDate);
  const recurring = recurringPulseMoments
    .filter((moment) => matchesRecurringMoment(moment, getMonthDay(normalizedDate)))
    .sort((left, right) => (right.priority || 0) - (left.priority || 0));

  const momentCards = [
    ...dateSignals.map((signal) => ({
      id: signal.id,
      kind: "speciell dag",
      kindLabel: "Speciell dag",
      title: signal.title,
      note: signal.note,
      areas: ["Centro", "Trastevere", "Aventino"],
      tags: signal.vibeTags || [],
      linked_wildcard_id: signal.id === "natale-di-roma" ? "natale-di-roma-loop" : null,
      priority: 5,
    })),
    ...recurring,
  ].slice(0, 4);

  return {
    date: normalizedDate,
    headline: buildCityPulseHeadline(normalizedDate, momentCards),
    note:
      "Lokala rytmer, speciella datum och små officiella tips som kan göra kvällen smartare än en vanlig topplista.",
    moments: momentCards,
    wildcards: getWildcardSuggestions(normalizedDate),
  };
}

module.exports = {
  getCityPulse,
  getDateSignals,
  getRomeTodayIsoDate,
  getWildcardSuggestions,
};
