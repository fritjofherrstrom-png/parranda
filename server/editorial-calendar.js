const {
  diffIsoDatesInDays,
  formatIsoDatePart,
  getIsoMonthDay,
} = require("./lib/iso-date");

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
  return getIsoMonthDay(dateString);
}

function formatRomeDatePart(dateString, options) {
  return formatIsoDatePart(dateString, "sv-SE", options);
}

function getPulseDateLabels(dateString = getRomeTodayIsoDate()) {
  return {
    weekdayLabel: formatRomeDatePart(dateString, { weekday: "long" }),
    dateLabel: formatRomeDatePart(dateString, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  };
}

function getDayDistanceToFixedDate(dateString, targetMonth, targetDay) {
  const yearMatch = String(dateString || "").match(/^(\d{4})-/);
  const currentYear = yearMatch ? Number(yearMatch[1]) : new Date().getUTCFullYear();
  const targetDate = `${currentYear}-${String(targetMonth).padStart(2, "0")}-${String(
    targetDay,
  ).padStart(2, "0")}`;
  return diffIsoDatesInDays(dateString, targetDate);
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

const editorialPulseItems = [
  {
    id: "city-thursday-gnocchi",
    level: "city",
    kind: "Tradition",
    title: "Torsdag är gnocchi-dag",
    where: "Romerska trattorior över hela stan",
    when: "Lunch och middag",
    blurb:
      "Giovedi gnocchi, venerdi pesce, sabato trippa. På de riktiga ställena lever den rytmen fortfarande, och torsdag är dagen då köken redan vet vad de vill att du ska beställa.",
    why_it_matters:
      "Låt maten följa dagen. En smart torsdag i Rom känns mer lokal när du beställer det köket faktiskt lagat för just i dag.",
    matches_vibes: ["curious", "slow"],
    route_hints: {
      preferred_tags: ["mat", "vin", "kultur"],
      preferred_vibes: ["culture", "low_key"],
      avoid_vibes: ["party"],
      modifier_bias: { culture: 1.2, low_key: 1.6 },
    },
    weekdays: [4],
    priority: 5,
    linked_wildcard_id: "prati-monti-smart",
  },
  {
    id: "city-weekend-streets",
    level: "city",
    kind: "Stadens rytm",
    title: "Helgkvällar spiller ut på gator och piazzor",
    where: "Monti, Testaccio, Ostiense och Pigneto",
    when: "Efter 19:00",
    blurb:
      "Fredag och lördag blir Rom mindre rumsbundet och mer kvartersdrivet. Kvällen bygger fart sent, och piazzor, småbarer och mellanrummen gör mer än en perfekt bokningslista.",
    why_it_matters:
      "Spara huvudenergin till sent. Två rätt kvarter slår nästan alltid en överlastad kväll där du försöker hinna för mycket.",
    matches_vibes: ["buzzy"],
    route_hints: {
      preferred_area_tokens: ["monti", "testaccio", "ostiense", "pigneto", "san-lorenzo"],
      preferred_macros: ["center", "south", "east"],
      preferred_tags: ["nattliv", "cocktail", "öl", "vin"],
      preferred_vibes: ["evening", "party"],
      avoid_vibes: ["low_key"],
      modifier_bias: { evening: 1.8, party: 2.2 },
    },
    weekdays: [5, 6],
    priority: 5,
    linked_wildcard_id: "san-lorenzo-pigneto-party",
  },
  {
    id: "city-monday-soft",
    level: "city",
    kind: "Stadens rytm",
    title: "Måndag vinner på kultur, vin och tydlig middag",
    where: "Centro, Prati och lugnare vinstråk",
    when: "Från eftermiddag till kväll",
    blurb:
      "Tidiga veckan är sällan rätt läge för maxad barrunda från start. Rom blir smartare när du låter ett kulturstopp, ett vinankare och en bra middag bära dagen.",
    why_it_matters:
      "Du får en mer självklar dag om du spelar med veckans tempo i stället för att tvinga fram helgkänsla.",
    matches_vibes: ["curious", "slow"],
    route_hints: {
      preferred_tags: ["kultur", "kyrkor", "vin"],
      preferred_vibes: ["culture", "low_key"],
      avoid_vibes: ["party"],
      modifier_bias: { culture: 1.8, low_key: 1.6 },
    },
    weekdays: [1],
    priority: 5,
    linked_wildcard_id: "prati-monti-smart",
  },
  {
    id: "city-spring-walks",
    level: "city",
    kind: "Säsong",
    title: "April och maj är gjorda för längre kvällspromenader",
    where: "Hela Rom",
    when: "Golden hour till sent",
    blurb:
      "Ljuset håller längre, värmen är fortfarande vänlig och två starka kvarter i samma dag känns plötsligt självklara till fots.",
    why_it_matters:
      "Det här är säsongen då rutten gärna får vara snygg, lite bredare och mer komponerad än bara effektiv.",
    matches_vibes: ["romantic", "slow"],
    route_hints: {
      preferred_tags: ["utsikt", "kultur", "vin"],
      preferred_vibes: ["evening", "low_key"],
      modifier_bias: { evening: 1.2, low_key: 1.2 },
    },
    months: [4, 5],
    priority: 3,
    linked_wildcard_id: "monti-testaccio-evening",
  },
  {
    id: "city-summer-open-air",
    level: "city",
    kind: "Säsong",
    title: "Sommarkvällar gör piazzor, tak och uteserveringar extra starka",
    where: "Centro, Trastevere och västliga kvällsstråk",
    when: "Efter 18:30",
    blurb:
      "När värmen sitter kvar sent vill Rom hellre spelas i skymning än mitt på dagen. Utomhusstopp och lång aperitivo bär mer än täta dagsprogram.",
    why_it_matters:
      "Låt kvällen ta vikt. Du får en bättre dag om du avsiktligt lämnar luft åt de sena timmarna.",
    matches_vibes: ["romantic", "buzzy"],
    route_hints: {
      preferred_tags: ["utsikt", "vin", "cocktail", "nattliv"],
      preferred_vibes: ["evening"],
      modifier_bias: { evening: 1.6, party: 0.8 },
    },
    months: [6, 7, 8, 9],
    priority: 3,
    linked_wildcard_id: "aventino-trastevere-sunset",
  },
  {
    id: "city-general-rhythm",
    level: "city",
    kind: "Stadens rytm",
    title: "Rom känns bäst när dagen byggs i kvarter, inte i checklistor",
    where: "Hela staden",
    when: "Hela dagen",
    blurb:
      "Det lokala spelet sitter sällan i att hinna flest platser, utan i att låta två eller tre tydliga områden bära rytmen och promenaden mellan dem göra jobbet.",
    why_it_matters:
      "Det är så en dag går från transportsträcka till upplevelse. Parranda ska hjälpa dig läsa det tempot snabbare.",
    matches_vibes: ["slow", "curious"],
    route_hints: {
      preferred_vibes: ["culture", "low_key"],
      avoid_vibes: ["party"],
    },
    priority: 1,
    linked_wildcard_id: "monti-testaccio-evening",
  },
  {
    id: "hood-trastevere-crowded",
    level: "neighborhood",
    kind: "Kvarterspuls",
    title: "Trastevere är sällan smartast som första stopp på helgkvällar",
    where: "Piazza Santa Maria och de tätaste stråken",
    when: "Från 20:00",
    blurb:
      "Fortfarande vackert, men ofta mer kökänsla än lokal rytm om du börjar där när alla andra gör samma sak. Det spelar oftast bättre som senare drift än som hela planen.",
    why_it_matters:
      "Börja hellre i Monti, Testaccio eller Pigneto och låt Trastevere bli final, omväg eller ett sent glas när kvällen redan satt sig.",
    matches_vibes: ["buzzy"],
    route_hints: {
      preferred_area_tokens: ["monti", "testaccio", "ostiense", "pigneto", "san-lorenzo"],
      preferred_macros: ["center", "south", "east"],
      avoid_area_tokens: ["trastevere"],
      preferred_vibes: ["evening", "party"],
      modifier_bias: { party: 1.6, evening: 1.4 },
    },
    weekdays: [5, 6],
    priority: 5,
    linked_wildcard_id: "monti-testaccio-evening",
  },
  {
    id: "hood-east-rome-energy",
    level: "neighborhood",
    kind: "Kvarterspuls",
    title: "Pigneto och San Lorenzo bär en yngre och råare kväll än centro",
    where: "Östra Rom",
    when: "Efter 19:30",
    blurb:
      "Billigare glas, mindre finish och mer direkt energi. Det är kvarter för kvällar som ska kännas ute på riktigt, inte bara snyggt planerade i förväg.",
    why_it_matters:
      "När du väljer mer party, öl eller bara vill ha mindre polish är östra Rom ofta en bättre huvudscen än de mest uppenbara centrala dragen.",
    matches_vibes: ["buzzy"],
    route_hints: {
      preferred_area_tokens: ["pigneto", "san-lorenzo", "esquilino", "san-giovanni"],
      preferred_macros: ["east"],
      preferred_tags: ["nattliv", "öl", "cocktail", "party"],
      preferred_vibes: ["party", "evening"],
      modifier_bias: { party: 2.4, evening: 1.2 },
    },
    weekdays: [4, 5, 6],
    priority: 5,
    linked_wildcard_id: "san-lorenzo-pigneto-party",
  },
  {
    id: "hood-south-rome-low-key",
    level: "neighborhood",
    kind: "Kvarterspuls",
    title: "Garbatella och Ostiense ger ofta en bättre vardagskväll än centrum",
    where: "Södra Rom",
    when: "Tidiga kvällar",
    blurb:
      "Mindre show, bättre samtal och fler stopp som känns levda snarare än serverade. Södra Rom är starkt när du vill ha personlighet utan helgbrus.",
    why_it_matters:
      "Perfekt när du valt mer low-key, mer vin eller bara vill att dagen ska kännas lokalt självklar i stället för turistiskt självsäker.",
    matches_vibes: ["slow", "curious"],
    route_hints: {
      preferred_area_tokens: ["garbatella", "ostiense", "testaccio", "aventino"],
      preferred_macros: ["south"],
      preferred_tags: ["vin", "öl", "mat", "hidden gems"],
      preferred_vibes: ["low_key"],
      avoid_vibes: ["party"],
      modifier_bias: { low_key: 2.2 },
    },
    weekdays: [1, 2, 3, 4],
    priority: 4,
    linked_wildcard_id: "garbatella-ostiense-soft",
  },
  {
    id: "hood-sunday-soft",
    level: "neighborhood",
    kind: "Kvarterspuls",
    title: "Aventino och Prati spelar bättre långsamt på söndagar",
    where: "Västra och södra kanten av centro",
    when: "Dag till tidig kväll",
    blurb:
      "Mer promenad, kyrkor, utsikt och vin än ren barserie. Ett bättre val när du vill få ihop platskänsla utan att dagen känns pressad.",
    why_it_matters:
      "Söndag i Rom blir ofta starkare när du låter tempot sjunka och låter ett par eleganta stopp bära helheten.",
    matches_vibes: ["romantic", "slow"],
    route_hints: {
      preferred_area_tokens: ["aventino", "prati", "borgo", "gianicolo"],
      preferred_macros: ["south", "west"],
      preferred_tags: ["kultur", "kyrkor", "vin", "utsikt"],
      preferred_vibes: ["culture", "low_key"],
      avoid_vibes: ["party"],
      modifier_bias: { culture: 1.2, low_key: 1.8 },
    },
    weekdays: [0],
    priority: 5,
    linked_wildcard_id: "aventino-trastevere-sunset",
  },
  {
    id: "hood-monti-start",
    level: "neighborhood",
    kind: "Kvarterspuls",
    title: "Monti är ofta bättre som smart start än som hela svaret",
    where: "Monti",
    when: "Eftermiddag till första glaset",
    blurb:
      "Bra läge för kulturstart, smågator och ett första glas, men ännu bättre när du sedan låter kvällen glida vidare till ett andra kvarter med tydligare egen puls.",
    why_it_matters:
      "Monti fungerar bäst när du använder det som öppning, inte som ursäkt att stanna still hela dagen.",
    matches_vibes: ["curious"],
    route_hints: {
      preferred_area_tokens: ["monti"],
      preferred_macros: ["center"],
      preferred_tags: ["kultur", "vin", "hidden gems"],
      preferred_vibes: ["culture", "evening"],
      modifier_bias: { culture: 0.8, evening: 0.8 },
    },
    priority: 2,
    linked_wildcard_id: "monti-testaccio-evening",
  },
  {
    id: "venue-wine-axis",
    level: "venue",
    kind: "Ställesnivå",
    title: "Litro, L'Antidoto eller Les Vignerons om du vill låta vinet styra kvällen",
    where: "Monteverde och Trastevere",
    when: "Sen eftermiddag till sent",
    blurb:
      "Mer samtal, mindre brus och bättre chans att låta middagen glida ihop med dagens första riktiga glas. Den här typen av stopp bär en vinig kväll bättre än ännu en generisk aperitivo.",
    why_it_matters:
      "När du vill ha mer vin, mer stämning och mindre pose är det här ofta rätt riktning att luta dagen åt.",
    matches_vibes: ["romantic", "slow"],
    route_hints: {
      preferred_tags: ["vin", "mat", "hidden gems"],
      preferred_vibes: ["low_key", "evening"],
      avoid_vibes: ["party"],
      modifier_bias: { low_key: 1.6, evening: 0.8 },
    },
    priority: 4,
    place_query: "Litro Rome",
    linked_wildcard_id: "monti-testaccio-evening",
  },
  {
    id: "venue-beer-axis",
    level: "venue",
    kind: "Ställesnivå",
    title: "Ma Che Siete Venuti a Fà, L'Oasi della Birra eller Bar San Calisto bär ett genuint ölspår",
    where: "Trastevere och Testaccio",
    when: "Kväll",
    blurb:
      "Olika stilnivåer, samma idé: stopp där ölen faktiskt är viktig och där rummet gör jobbet utan att kännas som en kuliss för besökare.",
    why_it_matters:
      "Bra när du valt mer öl, bar hopping eller bara vill att kvällen ska kännas mindre generisk och mer förankrad i riktiga ställen.",
    matches_vibes: ["buzzy"],
    route_hints: {
      preferred_tags: ["öl", "nattliv", "hidden gems"],
      preferred_area_tokens: ["testaccio", "ostiense", "trastevere"],
      preferred_vibes: ["party", "evening"],
      modifier_bias: { party: 1.6, evening: 1.2 },
    },
    weekdays: [4, 5, 6],
    priority: 4,
    place_query: "Ma Che Siete Venuti a Fà Rome",
    linked_wildcard_id: "garbatella-ostiense-soft",
  },
  {
    id: "venue-culture-axis",
    level: "venue",
    kind: "Ställesnivå",
    title: "Centrale Montemartini eller Santa Prassede när du vill ge dagen ett rum med tyngd",
    where: "Ostiense och Esquilino",
    when: "Dagtid till tidig kväll",
    blurb:
      "Smart kultur, stark atmosfär och noll behov av de mest slitna köerna. Den sortens stopp får ofta hela rutten att kännas mer genomtänkt.",
    why_it_matters:
      "En enda välvald kulturpunkt gör ofta mer för dagen än tre halvdana klassiker på rad.",
    matches_vibes: ["curious"],
    route_hints: {
      preferred_tags: ["kultur", "kyrkor", "hidden gems"],
      preferred_area_tokens: ["ostiense", "esquilino", "monti", "san-giovanni"],
      preferred_vibes: ["culture", "low_key"],
      modifier_bias: { culture: 2.2, low_key: 0.8 },
    },
    priority: 3,
    place_query: "Centrale Montemartini Rome",
    linked_wildcard_id: "prati-monti-smart",
  },
  {
    id: "venue-sunset-axis",
    level: "venue",
    kind: "Ställesnivå",
    title: "Giardino degli Aranci eller Gianicolo när du behöver ett snyggt kvällsskifte",
    where: "Aventino och ovanför Trastevere",
    when: "Golden hour",
    blurb:
      "Det handlar mindre om att jaga den största vyn och mer om att ge dagen ett andningshål innan kvällen skiftar tempo.",
    why_it_matters:
      "Perfekt när du vill att rutten ska kännas komponerad och självklar, inte bara effektiv.",
    matches_vibes: ["romantic", "slow"],
    route_hints: {
      preferred_tags: ["utsikt", "vin", "kultur"],
      preferred_area_tokens: ["aventino", "gianicolo", "trastevere", "prati"],
      preferred_vibes: ["evening", "low_key"],
      modifier_bias: { evening: 1.4, low_key: 1.1 },
    },
    months: [4, 5, 6, 7, 8, 9, 10],
    priority: 3,
    place_query: "Giardino degli Aranci Rome",
    linked_wildcard_id: "aventino-trastevere-sunset",
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

function matchesEditorialItem(item, { month, day, weekday }) {
  if (item.weekdays && !item.weekdays.includes(weekday)) {
    return false;
  }

  if (item.months && !item.months.includes(month)) {
    return false;
  }

  if (item.monthDays && !item.monthDays.includes(`${month}-${day}`)) {
    return false;
  }

  return true;
}

function buildNatalePulseItem(dateString = getRomeTodayIsoDate()) {
  const dayDistance = getDayDistanceToFixedDate(dateString, 4, 21);

  if (dayDistance < 0 || dayDistance > 3) {
    return null;
  }

  return {
    id: dayDistance === 0 ? "natale-di-roma-today" : "natale-di-roma-soon",
    level: "city",
    kind: "Stadens rytm",
    title: dayDistance === 0 ? "Natale di Roma är här" : "Upptakt till Natale di Roma",
    where: "Centro, Aventino och kring Fori Imperiali",
    when:
      dayDistance === 0 ? "I dag" : dayDistance === 1 ? "I morgon" : `Om ${dayDistance} dagar`,
    blurb:
      dayDistance === 0
        ? "Rom firar sin födelsedag på riktigt. Historisk tyngd, större folkliv och mer laddning nära den gamla stadskärnan gör dagen ovanligt speciell."
        : "Roms födelsedag infaller 21 april, och dagarna före känns staden lite mer självmedveten. Förväntan syns tydligast nära de historiska kärnorna.",
    why_it_matters:
      dayDistance === 0
        ? "Om du är här i dag är det värt att låta historisk tyngd och kvällsljus bära större del av rutten än vanligt."
        : "Om du kan styra dagarna är det här ett av de få tillfällen då Rom firar sig själv snarare än bara visas upp.",
    matches_vibes: ["curious", "slow"],
    route_hints: {
      preferred_tags: ["kultur", "kyrkor", "utsikt"],
      preferred_macros: ["center", "south", "west"],
      preferred_vibes: ["culture", "evening"],
      avoid_vibes: ["party"],
      modifier_bias: { culture: 2.4, evening: 1.2 },
    },
    priority: 6,
    linked_wildcard_id: "natale-di-roma-loop",
  };
}

function buildEditionItems(dateString = getRomeTodayIsoDate()) {
  const dateInfo = getMonthDay(dateString);
  const editorial = editorialPulseItems
    .filter((item) => matchesEditorialItem(item, dateInfo))
    .sort((left, right) => (right.priority || 0) - (left.priority || 0));
  const specialItems = [buildNatalePulseItem(dateString)].filter(Boolean);
  const allItems = [...specialItems, ...editorial];

  const byLevel = {
    city: allItems.filter((item) => item.level === "city").slice(0, 2),
    neighborhood: allItems.filter((item) => item.level === "neighborhood").slice(0, 2),
    venue: allItems.filter((item) => item.level === "venue").slice(0, 2),
  };

  return [...byLevel.city, ...byLevel.neighborhood, ...byLevel.venue];
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

function buildCityPulseSubhead(dateString) {
  const dayDistanceToNatale = getDayDistanceToFixedDate(dateString, 4, 21);
  const { month, weekday } = getMonthDay(dateString);

  if (dayDistanceToNatale >= 0 && dayDistanceToNatale <= 3) {
    return dayDistanceToNatale === 0
      ? "I dag känns Rom lite mer romerskt än vanligt. Låt rutten spela med den extra historiska pulsen."
      : "Stadens födelsedag närmar sig. Små rytmer, kvällsljus och rätt kvarter väger extra tungt just nu.";
  }

  if (weekday === 5 || weekday === 6) {
    return "Helgen bär bäst när du låter kvällen få tid, väljer färre kvarter och lägger större vikt på sen energi än på tidig effektivitet.";
  }

  if (weekday === 1) {
    return "Tidiga veckan blir smartare när du väljer ett tydligt kultur- eller vinspår i stället för att försöka forcera fram lördagsläge.";
  }

  if (month >= 4 && month <= 5) {
    return "Vårkvällarna gör Rom extra promenadvänligt. Två starka kvarter till fots slår nästan alltid ännu en splittrad checklista.";
  }

  return "Det här är lagret mellan statisk city guide och riktig lokal känsla: små signaler som gör att dagen sitter bättre innan du ens börjar gå.";
}

function getCityPulse(dateString = getRomeTodayIsoDate()) {
  const normalizedDate = dateString || getRomeTodayIsoDate();
  const dateLabels = getPulseDateLabels(normalizedDate);
  const dateSignals = getDateSignals(normalizedDate);
  const recurring = recurringPulseMoments
    .filter((moment) => matchesRecurringMoment(moment, getMonthDay(normalizedDate)))
    .sort((left, right) => (right.priority || 0) - (left.priority || 0));
  const editionItems = buildEditionItems(normalizedDate);

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
    weekday_label: dateLabels.weekdayLabel,
    date_label: dateLabels.dateLabel,
    headline: buildCityPulseHeadline(normalizedDate, momentCards),
    subhead: buildCityPulseSubhead(normalizedDate),
    note:
      "Kuraterad temporal intelligence för Rom: stadens rytm, kvarterspuls och ställesnivå i samma utgåva.",
    footer_note:
      "En lokal hade burit med sig mycket av det här utan att tänka på det. Det är den känslan Parranda försöker ge dig snabbare.",
    items: editionItems,
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
