const baseItems = [
  {
    id: "old-town",
    name: "Old Town",
    kind: "district",
    lat: 19.4326,
    lng: -99.1332,
    area: "Old Town",
    tags: ["kultur", "mat", "vin", "hidden gems", "low-key"],
    weatherTags: ["all-weather", "evening"],
    closedWeekdays: [],
    searchTerms: ["old town", "historic center", "old-town"],
    priceLevel: "$$",
    bestTime: "11:00 till sen kväll",
    vibe: "ett lugnt kärnstråk där dagen kan börja utan att kännas turiststyrd",
    groupSize: "2-5 personer",
    bookingRequired: false,
    openingSummary: "Fungerar från sen förmiddag till kväll",
    longDescription:
      "Old Town är det naturliga navet när Test City ska kännas sammanhållen och promenadvänlig.",
    perfectFor: ["mjuk start", "vin", "kultur"],
    featureNotes: ["bra loopbas", "nära flera sidospår"],
    happyHourNote: null,
    clusterToken: "old-town",
    anchorWeight: 3.2,
    goodAsStart: 3.1,
    goodAsFinal: 2.6,
    dwellType: "wander",
    duplicateFamily: "district",
  },
  {
    id: "harbor-steps",
    name: "Harbor Steps",
    kind: "viewpoint",
    lat: 19.4348,
    lng: -99.1452,
    area: "Riverfront",
    tags: ["utsikt", "vin", "hidden gems", "low-key"],
    weatherTags: ["sun", "golden-hour"],
    closedWeekdays: [],
    searchTerms: ["harbor steps", "river steps", "harbor"],
    priceLevel: "gratis",
    bestTime: "golden hour",
    vibe: "ett lugnt utsiktsstopp som ger rutten lite luft och kvällsljus",
    groupSize: "2-4 personer",
    bookingRequired: false,
    openingSummary: "Bäst när ljuset hjälper till",
    longDescription:
      "Harbor Steps är ett stilla pausankare när du vill att dagen ska kännas komponerad snarare än maxad.",
    perfectFor: ["utsikt", "lugn kväll", "kort paus"],
    featureNotes: ["bra med vinspår", "fungerar som sen paus"],
    happyHourNote: null,
    clusterToken: "riverfront",
    anchorWeight: 2.3,
    goodAsStart: 1.5,
    goodAsFinal: 2.7,
    dwellType: "pause",
    duplicateFamily: "viewpoint",
  },
  {
    id: "market-hall",
    name: "Market Hall",
    kind: "market",
    lat: 19.4298,
    lng: -99.1294,
    area: "Market Quarter",
    tags: ["mat", "öl", "hidden gems", "low-key"],
    weatherTags: ["all-weather"],
    closedWeekdays: [0],
    searchTerms: ["market hall", "market quarter", "food hall"],
    priceLevel: "$",
    bestTime: "11:30 till 15:00",
    vibe: "matnav med lokal rytm och låg tröskel",
    groupSize: "2-6 personer",
    bookingRequired: false,
    openingSummary: "Starkast runt lunch och tidig eftermiddag",
    longDescription:
      "Market Hall ger Test City ett tydligt matankare utan att dra rutten in i generisk turistmat.",
    perfectFor: ["lunch", "prisvänlig start", "lokal mat"],
    featureNotes: ["bra budgetstopp", "bär dagen mitt på dagen"],
    happyHourNote: null,
    clusterToken: "market-quarter",
    anchorWeight: 2.8,
    goodAsStart: 2.9,
    goodAsFinal: 1.4,
    dwellType: "meal-anchor",
    duplicateFamily: "market",
  },
  {
    id: "north-archive",
    name: "North Archive",
    kind: "museum",
    lat: 19.4389,
    lng: -99.1318,
    area: "North",
    tags: ["kultur", "hidden gems", "low-key"],
    weatherTags: ["rain", "hot", "all-weather"],
    closedWeekdays: [1],
    searchTerms: ["north archive", "archive", "north quarter"],
    priceLevel: "$$",
    bestTime: "11:00 till 17:00",
    vibe: "ett mindre kulturstopp som gör norra stråket värt att gå in i",
    groupSize: "1-4 personer",
    bookingRequired: false,
    openingSummary: "Dagtid, särskilt bra vid regn eller hetta",
    longDescription:
      "North Archive fungerar som ett lätt kulturankare när rutten behöver lite innehåll och riktning.",
    perfectFor: ["kultur", "regnig dag", "mjuk mittpunkt"],
    featureNotes: ["bra på dagtid", "fungerar i lättare dagar"],
    happyHourNote: null,
    clusterToken: "north",
    anchorWeight: 2.2,
    goodAsStart: 1.8,
    goodAsFinal: 1.6,
    dwellType: "culture-anchor",
    duplicateFamily: "culture",
  },
  {
    id: "south-courtyard",
    name: "South Courtyard",
    kind: "wine-bar",
    lat: 19.4267,
    lng: -99.1364,
    area: "South",
    tags: ["vin", "mat", "nattliv"],
    weatherTags: ["all-weather", "evening"],
    closedWeekdays: [],
    searchTerms: ["south courtyard", "courtyard bar", "south quarter"],
    priceLevel: "$$",
    bestTime: "18:00 till sent",
    vibe: "ett kvällsstopp som kan ge dagen en mjuk final utan att kännas showigt",
    groupSize: "2-5 personer",
    bookingRequired: false,
    openingSummary: "Bäst från tidig kväll och framåt",
    longDescription:
      "South Courtyard fungerar som final när du vill att dagen ska landa i något socialt och användbart.",
    perfectFor: ["vinfinal", "middag", "lugn kvällsenergi"],
    featureNotes: ["bra final", "fungerar efter Market Hall"],
    happyHourNote: "Smart första glas om du vill växla från dag till kväll utan att byta tempo helt.",
    clusterToken: "south",
    anchorWeight: 3.1,
    goodAsStart: 1.4,
    goodAsFinal: 3.2,
    dwellType: "drink-stop",
    duplicateFamily: "wine",
  },
];

const routeTemplates = [
  {
    id: "test-city-old-town-loop",
    title: "Old Town loop",
    summary: "En sammanhängande testloop genom stadskärna, mat och kvällsstopp.",
    stops: ["old-town", "north-archive", "market-hall", "south-courtyard", "harbor-steps", "old-town"],
    defaultKm: 6,
    preferenceTags: ["kultur", "mat", "vin", "hidden gems", "low-key"],
    optimizerModes: ["wine-crawl", "culture"],
    weatherProfile: { sun: 1, rain: 1, hot: 0, evening: 1 },
    weekdayBoost: { 4: 1, 5: 1, 6: 1 },
    vibeProfile: { evening: 2, culture: 2, lowKey: 2, party: 0 },
    hiddenMentions: [],
    barMentions: [],
  },
  {
    id: "test-city-riverfront-loop",
    title: "Riverfront evening loop",
    summary: "En lättare kvällsrunda där utsikt och vin får bära mer av tempot.",
    stops: ["old-town", "harbor-steps", "south-courtyard", "market-hall", "old-town"],
    defaultKm: 5,
    preferenceTags: ["vin", "utsikt", "mat", "low-key"],
    optimizerModes: ["sunset-spots", "wine-crawl"],
    weatherProfile: { sun: 2, rain: 0, hot: -1, evening: 2 },
    weekdayBoost: { 5: 1, 6: 1 },
    vibeProfile: { evening: 2, culture: 1, lowKey: 2, party: 0 },
    hiddenMentions: [],
    barMentions: [],
  },
];

const allItems = [...baseItems];

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findItemByName(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return null;
  }

  return (
    allItems.find((item) => normalize(item.id) === normalized) ||
    allItems.find((item) => normalize(item.name) === normalized) ||
    allItems.find((item) => item.searchTerms.some((term) => normalize(term) === normalized)) ||
    null
  );
}

module.exports = {
  routeTemplates,
  allItems,
  findItemByName,
};
