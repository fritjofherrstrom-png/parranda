const places = [
  {
    name: "Garbatella",
    category: "kvarter",
    score: "9.8/10",
    area: "Sydost om centrum",
    crowd: "Lugn till medium",
    description:
      "Ett av de mest älskade bostadsområdena i Rom, med gårdar, trappor, grönska och en nästan småstadslik känsla mitt i storstaden.",
    bestFor: "Bäst för: långsam kvällspromenad",
    time: "Vibe: sen eftermiddag",
    localNote:
      "Gå hit för kvarterskänslan i sig, inte för att bocka av en specifik sevärdhet.",
    tags: ["lokal känsla", "arkitektur", "underskattat"],
    mapQuery: "Garbatella Rome",
    featured: true,
    lat: 41.8617,
    lng: 12.4798,
  },
  {
    name: "Ostiense",
    category: "nattliv",
    score: "9.7/10",
    area: "Södra Rom",
    crowd: "Medium",
    description:
      "Industriell, kreativ och rå på rätt sätt. Här blandas muralkonst, naturvin, sen middag och gammal industrimiljö.",
    bestFor: "Bäst för: aperitivo + sen middag",
    time: "Vibe: kväll",
    localNote:
      "Perfekt ihop med Garbatella om du vill ha en kväll som känns samtida snarare än nostalgisk.",
    tags: ["street art", "hippt", "kväll"],
    mapQuery: "Ostiense Rome",
    featured: true,
    lat: 41.8721,
    lng: 12.4787,
  },
  {
    name: "Parco degli Acquedotti",
    category: "gömt",
    score: "9.8/10",
    area: "Sydöst, utanför centrum",
    crowd: "Lugn",
    description:
      "Gigantiska antika akvedukter, öppna fält och kvällsljus som känns mer film än stadssemester.",
    bestFor: "Bäst för: golden hour",
    time: "Vibe: solnedgång",
    localNote:
      "Inte centralt, men precis därför en av de starkaste upplevelserna om du vill känna att Rom öppnar upp sig.",
    tags: ["episkt", "natur", "annorlunda"],
    mapQuery: "Parco degli Acquedotti Rome",
    featured: true,
    lat: 41.8495,
    lng: 12.5566,
  },
  {
    name: "Pigneto",
    category: "nattliv",
    score: "9.5/10",
    area: "Östra Rom",
    crowd: "Medium till livligt",
    description:
      "Alternativt, kreativt och mindre polerat än centrum. Ett bra område för barer, skivbutiker och folk som faktiskt bor i stan.",
    bestFor: "Bäst för: barhopp",
    time: "Vibe: kväll",
    localNote: "Gå hit när du vill åt cool energi och mindre vykorts-Rom.",
    tags: ["alternativt", "lokalt", "kreativt"],
    mapQuery: "Pigneto Rome",
    lat: 41.8886,
    lng: 12.5342,
  },
  {
    name: "Testaccio Market",
    category: "mat",
    score: "9.4/10",
    area: "Testaccio",
    crowd: "Medium",
    description:
      "En smartare matstart än att äta runt de stora torgen. Romerska smaker, avslappnad känsla och mer vardagsliv.",
    bestFor: "Bäst för: lunch",
    time: "Vibe: dagtid",
    localNote:
      "Bra första stopp om du vill äta ordentligt innan du rör dig vidare söderut i staden.",
    tags: ["street food", "lokalt", "prisvärt"],
    mapQuery: "Mercato Testaccio Rome",
    lat: 41.8761,
    lng: 12.4753,
  },
  {
    name: "Tor Marancia Murals",
    category: "gömt",
    score: "9.3/10",
    area: "Södra Rom",
    crowd: "Lugn",
    description:
      "Ett bostadsområde där väggarna blivit en egen konstupplevelse. Mer urban berättelse än klassisk sightseeing.",
    bestFor: "Bäst för: street art",
    time: "Vibe: eftermiddag",
    localNote:
      "Känns bäst om du går långsamt och låter området vara upplevelsen, inte bara bakgrunden.",
    tags: ["murals", "urban", "ovanligt"],
    mapQuery: "Tor Marancia murals Rome",
    lat: 41.8525,
    lng: 12.4922,
  },
  {
    name: "Via Appia Antica",
    category: "gömt",
    score: "9.4/10",
    area: "Sydöst",
    crowd: "Lugn",
    description:
      "Tallar, ruiner, gammal stenväg och en nästan absurd känsla av lugn för att vara i Rom.",
    bestFor: "Bäst för: cykel eller promenad",
    time: "Vibe: morgon",
    localNote:
      "Idealisk när du vill bort från stadspulsen utan att lämna själva Romupplevelsen.",
    tags: ["historiskt", "grönt", "stillsamt"],
    mapQuery: "Via Appia Antica Rome",
    lat: 41.8584,
    lng: 12.5197,
  },
  {
    name: "Quartiere Coppedè",
    category: "gömt",
    score: "9.2/10",
    area: "Trieste",
    crowd: "Lugn",
    description:
      "Ett märkligt, nästan sagolikt område där arkitekturen känns helt fel för Rom och därför helt rätt.",
    bestFor: "Bäst för: foto och detaljspaning",
    time: "Vibe: eftermiddag",
    localNote:
      "Perfekt om du gillar när en stad plötsligt blir excentrisk och lite hemlig.",
    tags: ["arkitektur", "fantasy", "udda"],
    mapQuery: "Quartiere Coppedè Rome",
    lat: 41.9252,
    lng: 12.5154,
  },
  {
    name: "Centrale Montemartini",
    category: "gömt",
    score: "9.3/10",
    area: "Ostiense",
    crowd: "Lugn",
    description:
      "Klassiska skulpturer inuti ett gammalt kraftverk. En av de mest oväntade kulturupplevelserna i staden.",
    bestFor: "Bäst för: oväntad kultur",
    time: "Vibe: dagtid",
    localNote:
      "Bra för dig som gillar när gammalt Rom möter industriell estetik på ett smart sätt.",
    tags: ["museum", "industriellt", "smart tips"],
    mapQuery: "Centrale Montemartini Rome",
    lat: 41.8738,
    lng: 12.4824,
  },
  {
    name: "San Lorenzo",
    category: "kvarter",
    score: "9.1/10",
    area: "Östra Rom",
    crowd: "Livligt",
    description:
      "Ruffare, yngre och mer direkt. Här finns studentenergi, barer, sena middagar och noll behov av att se perfekt ut.",
    bestFor: "Bäst för: spontan kväll",
    time: "Vibe: natt",
    localNote:
      "Bra om du vill ha något mindre romantiserat och mer levande på riktigt.",
    tags: ["studentigt", "rått", "socialt"],
    mapQuery: "San Lorenzo Rome",
    lat: 41.8991,
    lng: 12.5132,
  },
  {
    name: "Giardino degli Aranci",
    category: "utsikt",
    score: "9.5/10",
    area: "Aventinen",
    crowd: "Medium",
    description:
      "En mjuk, klassisk utsikt där Rom känns varmt, stilla och nästan omöjligt vackert.",
    bestFor: "Bäst för: romantisk paus",
    time: "Vibe: golden hour",
    localNote: "Mer poetisk än dramatisk. Gå hit när tempot behöver sjunka.",
    tags: ["romantiskt", "panorama", "lugnt"],
    mapQuery: "Giardino degli Aranci Rome",
    lat: 41.8855,
    lng: 12.4789,
  },
  {
    name: "Gianicolo",
    category: "utsikt",
    score: "9.6/10",
    area: "Ovanför Trastevere",
    crowd: "Medium",
    description:
      "Stor, svepande utsikt över staden och ett säkert kort när du vill avsluta kvällen snyggt.",
    bestFor: "Bäst för: nattutsikt",
    time: "Vibe: sen kväll",
    localNote:
      "Funkar bäst efter middag när ljusen tänds och staden känns större än kartan.",
    tags: ["vy", "drömmigt", "kväll"],
    mapQuery: "Janiculum Terrace Rome",
    lat: 41.8896,
    lng: 12.4583,
  },
  {
    name: "Trastevere Side Streets",
    category: "kvarter",
    score: "9.0/10",
    area: "Trastevere",
    crowd: "Livligt",
    description:
      "Inte huvudstråken, utan sidogatorna. Där känns området fortfarande mer som ett kvarter än en scen.",
    bestFor: "Bäst för: sen promenad",
    time: "Vibe: kväll",
    localNote:
      "Undvik att fastna på de mest fotade gatorna och låt dig i stället dras bort från centrum av kvarteret.",
    tags: ["gränder", "kväll", "klassisk känsla"],
    mapQuery: "Trastevere Rome",
    lat: 41.8885,
    lng: 12.4678,
  },
  {
    name: "Monti Backstreets",
    category: "mat",
    score: "8.9/10",
    area: "Centralt",
    crowd: "Medium till livligt",
    description:
      "Fortfarande ett bra område om du väljer rätt smågator och går dit för stämningen snarare än för hype.",
    bestFor: "Bäst för: aperitivo",
    time: "Vibe: eftermiddag",
    localNote:
      "Mer användbart som kvällsstart än som dagens huvudupplevelse.",
    tags: ["vinbar", "centralt", "coolt"],
    mapQuery: "Monti Rome",
    lat: 41.8946,
    lng: 12.4951,
  },
  {
    name: "Trevi Fountain at Dawn",
    category: "klassiker",
    score: "9.1/10",
    area: "Historiska centrum",
    crowd: "Lugn tidigt",
    description:
      "En turistklassiker som faktiskt blir magisk om du går dit innan staden vaknat ordentligt.",
    bestFor: "Bäst för: tidig morgon",
    time: "Vibe: gryning",
    localNote:
      "Bra exempel på hur du gör klassiker smartare: byt bara tidpunkt, inte plats.",
    tags: ["klassiker", "tyst", "morgon"],
    mapQuery: "Trevi Fountain Rome",
    lat: 41.9009,
    lng: 12.4833,
  },
  {
    name: "Colosseum by Night",
    category: "klassiker",
    score: "9.2/10",
    area: "Centralt",
    crowd: "Medium",
    description:
      "Monumentalt och fortfarande värt det, bara inte mitt på dagen. Efter mörker blir upplevelsen större och lugnare.",
    bestFor: "Bäst för: wow-känsla",
    time: "Vibe: sen kväll",
    localNote:
      "Ett klassiskt stopp som funkar bäst som del av en kväll, inte som ensam destination.",
    tags: ["episk", "historiskt", "kväll"],
    mapQuery: "Colosseum Rome",
    lat: 41.8902,
    lng: 12.4922,
  },
  {
    name: "Piazza Navona Late",
    category: "klassiker",
    score: "8.8/10",
    area: "Historiska centrum",
    crowd: "Medium",
    description:
      "Fortfarande teatraliskt vackert, men betydligt mer njutbart när trycket har lättat.",
    bestFor: "Bäst för: sen kvällspromenad",
    time: "Vibe: kväll",
    localNote:
      "Hit går du för rummet, ljuset och fontänerna, inte för att stanna länge.",
    tags: ["barock", "centralt", "klassiskt"],
    mapQuery: "Piazza Navona Rome",
    lat: 41.8992,
    lng: 12.4731,
  },
  {
    name: "Esquilino Food Corners",
    category: "mat",
    score: "9.0/10",
    area: "Esquilino",
    crowd: "Medium",
    description:
      "Mer blandat, mer levande och mindre polerat. Ett bra område när du vill åt en annan rytm än de vanliga turistkvarteren.",
    bestFor: "Bäst för: vardaglig matjakt",
    time: "Vibe: lunch till tidig kväll",
    localNote:
      "Bra för dig som gillar när en stad känns blandad, rörlig och samtida.",
    tags: ["mångfald", "mat", "lokalt liv"],
    mapQuery: "Esquilino Rome",
    lat: 41.8976,
    lng: 12.5036,
  },
  {
    name: "Villa Doria Pamphilj",
    category: "gömt",
    score: "9.1/10",
    area: "Västra Rom",
    crowd: "Lugn",
    description:
      "Stor park, mycket luft och nästan chockerande lite turistkänsla jämfört med resten av staden.",
    bestFor: "Bäst för: pausdag",
    time: "Vibe: morgon eller sen eftermiddag",
    localNote:
      "För när du behöver byta sten och trafik mot träd, grusgångar och lite rymd.",
    tags: ["grönt", "återhämtning", "lokalt"],
    mapQuery: "Villa Doria Pamphilj Rome",
    lat: 41.8878,
    lng: 12.4387,
  },
];

const trastevereBars = [
  {
    name: "Bar San Calisto",
    type: "ikonisk bar",
    score: "9.7/10",
    description:
      "Ett av de mest klassiska och fortfarande mest levande stoppen i Trastevere. Mer folk, mer brus och mer riktig kväll än designad vinbar.",
    focus: "Beställ: öl eller enkel aperitivo",
    why: "Gå hit för energin, blandningen av folk och känslan av att Rom fortfarande får vara lite rörigt.",
    time: "Bäst: tidig kväll till sent",
    mapQuery: "Bar San Calisto Rome",
  },
  {
    name: "Freni e Frizioni",
    type: "aperitivo",
    score: "9.2/10",
    description:
      "Mer känt än hemligt, men fortfarande ett smart drag om du vill starta kvällen med bra läge, puls och enkel övergång till resten av Trastevere.",
    focus: "Beställ: spritz eller vin innan middagen",
    why: "Bra första ankare om du vill att kvällen ska kännas social direkt.",
    time: "Bäst: sen eftermiddag",
    mapQuery: "Freni e Frizioni Rome",
  },
  {
    name: "Ma Che Siete Venuti a Fà",
    type: "craft beer",
    score: "9.5/10",
    description:
      "För öldrickaren är det här ett av de säkraste stoppen i området. Mer nördigt, mer fokuserat och perfekt när du vill byta från allmän stämning till riktigt bra öl.",
    focus: "Beställ: fatöl och stanna en stund",
    why: "Bra mittpunkt i kvällen om öl är minst lika viktigt som utsikten.",
    time: "Bäst: kväll",
    mapQuery: "Ma Che Siete Venuti a Fà Rome",
  },
  {
    name: "Les Vignerons",
    type: "vinbar",
    score: "9.4/10",
    description:
      "Mer vinfokuserat, mer stilla och bättre för samtal än för stoj. Funkar utmärkt om ni vill ha en vuxnare del av kvällen utan att bli stela.",
    focus: "Beställ: glasvis vin och småplock",
    why: "Ett bra motdrag till de stökigare stoppen i området.",
    time: "Bäst: tidig kväll",
    mapQuery: "Les Vignerons Rome",
  },
  {
    name: "L'Antidoto",
    type: "natural wine",
    score: "9.3/10",
    description:
      "Ett smartare val för dig som gillar naturvin, mindre poser och ett ställe som känns mer kuraterat än turistiskt.",
    focus: "Beställ: naturvin eller något oväntat på glas",
    why: "Perfekt när du vill ha kvalitet och personlighet snarare än bara volym.",
    time: "Bäst: eftermiddag till kväll",
    mapQuery: "L'Antidoto Rome",
  },
  {
    name: "Enoteca Ferrara",
    type: "vin + middag",
    score: "8.9/10",
    description:
      "Lite mer polish och ett bra drag om du vill låta middagen och vinet glida ihop till ett längre kvällsstopp.",
    focus: "Beställ: vin med matankare",
    why: "Bra val när gruppen vill ha något mer strukturerat men fortfarande inne i Trastevere-pulsen.",
    time: "Bäst: middagstid",
    mapQuery: "Enoteca Ferrara Rome",
  },
];

const trastevereDay = [
  {
    time: "10:30",
    label: "Kulturstart",
    title: "Santa Cecilia eller Villa Farnesina",
    description:
      "Börja dagen med något som ger Trastevere tyngd direkt: stillheten i Santa Cecilia eller renässansvibben i Villa Farnesina.",
    note: "Poängen är att börja vackert och lugnt innan kvarteret blir socialt.",
  },
  {
    time: "12:15",
    label: "Promenad",
    title: "Sidogator, små piazzor och långsam lunch",
    description:
      "Strosa genom gränderna bort från de mest fotade hörnen och landa i en lugnare lunch utan att lämna området.",
    note: "Satsa på en lunch där ett första glas vin känns naturligt, inte på snabb avbockning.",
  },
  {
    time: "15:30",
    label: "Eftermiddag",
    title: "L'Antidoto eller Les Vignerons",
    description:
      "Här växlar dagen från kultur till dryck. Ta ett glas naturvin eller klassiskt vin och låt tempot vara långsamt.",
    note: "Perfekt paus mellan dagspromenad och kvällsdel.",
  },
  {
    time: "18:00",
    label: "Aperitivo",
    title: "Piazza Trilussa och Freni e Frizioni",
    description:
      "Gå ut mot floden, se kvarteret vakna och ta en aperitivo när Trastevere börjar få kvällskropp.",
    note: "Bra läge för att känna när du ska stanna kvar och när du ska glida vidare.",
  },
  {
    time: "20:00",
    label: "Öl + middag",
    title: "Ma Che Siete Venuti a Fà eller Bar San Calisto",
    description:
      "Nu kan kvällen bli antingen mer ölkär och fokuserad eller mer brusig och klassiskt Trastevere-rörig.",
    note: "Välj ölbaren om drycken styr, San Calisto om du vill åt ren stämning.",
  },
  {
    time: "23:00",
    label: "Slutscen",
    title: "Sen promenad upp mot Gianicolo",
    description:
      "Avsluta med att långsamt lämna barerna bakom dig och gå upp mot utsikten. Det ger dagen ett slut som känns större än kvarteret självt.",
    note: "Ingen stress. Det är just promenaden efter allt som gör kvällen komplett.",
  },
];

const districtGuides = [
  {
    id: "monti",
    label: "Monti",
    eyebrow: "MONTI MODE",
    title: "Monti som kulturstart, vinfinal och bättre senkväll",
    description:
      "Monti är som bäst när du använder området som en smart scen för kyrkor, långa glas och en kväll som kan bli både low-key och sen utan att tappa riktning.",
    selectorNote: "Centralt, kulturvänligt och bättre än sitt rykte om du väljer rätt.",
    startLabel: "Monti",
    endLabel: "Monti",
    plannerPoints: [
      {
        label: "Monti",
        area: "Monti",
        lat: 41.8946,
        lng: 12.4951,
      },
    ],
    mapFocus: {
      label: "Monti",
      type: "district",
      area: "Monti",
      lat: 41.8946,
      lng: 12.4951,
      summary: "Centralt kvarter för vin, kultur och ett bättre kvällsupplägg.",
      long_description:
        "Monti funkar bäst när du väljer rätt smågator, låter kyrkor och piazzor ge rytm åt dagen och sparar de mer showiga stoppen till sent.",
      tags: ["vin", "kultur", "centralt", "kväll"],
    },
    stats: [
      { value: "6", label: "smarta stopp" },
      { value: "1", label: "kompakt heldag" },
      { value: "mix", label: "kultur + vin + natt" },
    ],
    stopsTitle: "Monti när det ska kännas smart, inte bara centralt",
    stopsNote:
      "Bygg Monti runt riktiga ankare och bättre glas, inte runt de mest överfotade hörnen.",
    dayTitle: "En Monti-dag med mosaiker, piazza-aperitivo och sen cocktail",
    dayNote:
      "Förmiddag i stilla rum, sen eftermiddag på piazzan och kvällsval beroende på om du vill hålla det vinigt eller gå större.",
    actionTitle: "Monti funkar perfekt som både start och slut när du vill hålla dagen tight",
    actionCopy:
      "Sätt Monti som bas i planeraren om du vill att dagen ska kännas central men fortfarande kuraterad, kvällsvänlig och tydlig.",
    stopCards: [
      {
        name: "Santa Prassede",
        type: "mosaiker",
        score: "9.4/10",
        description:
          "Ett av de bästa kulturstoppen i området om du vill börja med något stilla, gyllene och faktiskt minnesvärt.",
        focus: "Gå hit: som första kulturankare",
        why: "Ger dagen ett djup direkt utan att du behöver lägga en halv dag på ett museum.",
        time: "Bäst: förmiddag",
        mapQuery: "Santa Prassede Rome",
        drawerQuery: "Santa Prassede",
      },
      {
        name: "San Pietro in Vincoli",
        type: "kyrkankare",
        score: "9.1/10",
        description:
          "Ett smart stopp när du vill ge Monti lite större historisk tyngd men fortfarande hålla dagen promenadvänlig.",
        focus: "Gå hit: före lunch eller på regnig dag",
        why: "Bra motvikt om resten av upplägget ska bli mer vin och kväll.",
        time: "Bäst: dagtid",
        mapQuery: "San Pietro in Vincoli Rome",
        drawerQuery: "San Pietro in Vincoli",
      },
      {
        name: "Piazza della Madonna dei Monti",
        type: "aperitivo-puls",
        score: "9.0/10",
        description:
          "Inte för att stanna hela kvällen, utan för att ge området ett naturligt mellanläge mellan kultur och glas.",
        focus: "Gå hit: runt första aperitivon",
        why: "Ett smart mötesgolv där du kan känna om kvällen ska bli större eller hålla sig mjuk.",
        time: "Bäst: sen eftermiddag",
        mapQuery: "Piazza Madonna dei Monti Rome",
        drawerQuery: "Piazza della Madonna dei Monti",
      },
      {
        name: "Ai Tre Scalini",
        type: "vinbar",
        score: "9.3/10",
        description:
          "Montis kanske säkraste vinankare om du vill att glaset ska få styra tempot utan att kvällen blir stel.",
        focus: "Beställ: vin och småplock",
        why: "Perfekt om du vill göra Monti mer lågmält, vuxet och samtalsvänligt.",
        time: "Bäst: tidig kväll",
        mapQuery: "Ai Tre Scalini Rome",
        drawerQuery: "Ai Tre Scalini",
      },
      {
        name: "Blackmarket Hall",
        type: "sen kväll",
        score: "9.1/10",
        description:
          "Ett tydligt kvällsdrag när Monti ska gå från vinigt kvarter till mer destination och mer natt.",
        focus: "Beställ: cocktail eller något mörkare sent",
        why: "Bra val när du vill att kvällen ska kännas mer som program än bara promenad.",
        time: "Bäst: kväll till sent",
        mapQuery: "Blackmarket Hall Rome",
        drawerQuery: "Blackmarket Hall",
      },
      {
        name: "Drink Kong",
        type: "after dark",
        score: "9.2/10",
        description:
          "För när du faktiskt vill låta Monti leda in i något mer maxat och cocktaildrivet.",
        focus: "Beställ: signaturdrink och boka smart",
        why: "Rätt när du vill avsluta större än ett vanligt sista glas.",
        time: "Bäst: sent",
        mapQuery: "Drink Kong Rome",
        drawerQuery: "Drink Kong",
      },
    ],
    dayStops: [
      {
        time: "10:30",
        label: "Kulturstart",
        title: "Santa Prassede först, Monti sedan",
        description:
          "Börja dagen med mosaiker och lugn innan Monti vaknar som kvarter.",
        note: "Det gör att resten av dagen känns smartare, inte bara mer central.",
      },
      {
        time: "12:15",
        label: "Mjuk fortsättning",
        title: "San Pietro in Vincoli och smågatorna ned igen",
        description:
          "Lägg ett andra kulturstopp om du vill ha tyngd, annars låter du bara promenaden bära mellan kyrka och lunch.",
        note: "Poängen är rytm, inte maximal avbockning.",
      },
      {
        time: "14:00",
        label: "Lunch",
        title: "Lång lunch i Monti",
        description:
          "Ta lunch på en sidogata och låt området kännas levt snarare än uppvisat.",
        note: "Spara de showigare stoppen till senare.",
      },
      {
        time: "17:30",
        label: "Aperitivo",
        title: "Piazza della Madonna dei Monti",
        description:
          "Låt piazzan sätta kvällstonen innan du bestämmer om dagen ska bli mer vin eller mer natt.",
        note: "Bra läge att känna av gruppens energi.",
      },
      {
        time: "19:15",
        label: "Vinankare",
        title: "Ai Tre Scalini",
        description:
          "Här gör du Monti på rätt sätt om du vill hålla det varmt, lokalt och glasfokuserat.",
        note: "Bra huvudstopp innan eventuell cocktailfinal.",
      },
      {
        time: "22:15",
        label: "Slutscen",
        title: "Blackmarket Hall eller Drink Kong",
        description:
          "Avsluta beroende på om kvällen ska vara mörkare och mer loungeig eller renare cocktailmission.",
        note: "Monti funkar bäst när du inte behöver välja allt samtidigt.",
      },
    ],
  },
  {
    id: "trastevere",
    label: "Trastevere",
    eyebrow: "TRASTEVERE MODE",
    title: "Genuina barer, lång kväll och den perfekta dagen i Trastevere",
    description:
      "Trastevere är fortfarande starkt, men nu som en av flera stadsdelsguider. Här är fokus öl, vin, kultur och nattliv utan att kvarteret känns poserande.",
    selectorNote: "Genuina barer, klassisk kvällsfinal och enklaste vägen till brusig energi.",
    startLabel: "Trastevere",
    endLabel: "Trastevere",
    plannerPoints: [
      {
        label: "Trastevere",
        area: "Trastevere",
        lat: 41.8885,
        lng: 12.4678,
      },
    ],
    mapFocus: {
      label: "Trastevere",
      type: "district",
      area: "Trastevere",
      lat: 41.8885,
      lng: 12.4678,
      summary: "Kvällsnav för vin, öl, gränder och trygg final.",
      long_description:
        "Trastevere fungerar bäst som kvällsområde, återkomstpunkt och säkert kort när du vill ge dagen en riktig barfinal.",
      tags: ["öl", "vin", "gränder", "nattliv"],
    },
    stats: [
      { value: "6", label: "starka bardrag" },
      { value: "1", label: "heldag till fots" },
      { value: "100%", label: "kvällspuls" },
    ],
    stopsTitle: "Högt, lågt och framför allt genuint",
    stopsNote:
      "Fokus på ställen som fungerar för öl, vin och kvällsliv utan att kännas som rena turistkulisser.",
    dayTitle: "En hel Trastevere-dag för öl, vin, kultur och natt",
    dayNote:
      "Sen start, mycket promenad, inga stressiga förflyttningar och en kurva som blir bättre ju mörkare det blir.",
    actionTitle: "Trastevere är bäst när du vill ge en hel dag en trygg och livlig final",
    actionCopy:
      "Använd kvarteret som start, mål eller båda om du vill att rutten ska landa i ett område som klarar både vin, öl och sena svängar.",
    stopCards: trastevereBars,
    dayStops: trastevereDay,
  },
  {
    id: "testaccio-ostiense",
    label: "Testaccio + Ostiense",
    eyebrow: "SOUTH ROME MODE",
    title: "Matankare, industrikultur och glas som känns mer lokala än centrala",
    description:
      "Testaccio och Ostiense är det södra spåret när dagen ska drivas av mat, industrikultur och bättre öl- och vinstopp än i vykorts-Rom.",
    selectorNote: "Matdrivet, levande och bäst när du vill bort från centrumkulissen.",
    startLabel: "Testaccio",
    endLabel: "Ostiense",
    plannerPoints: [
      {
        label: "Testaccio",
        area: "Testaccio",
        lat: 41.8767,
        lng: 12.4752,
      },
      {
        label: "Ostiense",
        area: "Ostiense",
        lat: 41.8721,
        lng: 12.4787,
      },
    ],
    mapFocus: {
      label: "Testaccio",
      type: "district",
      area: "Testaccio",
      lat: 41.8767,
      lng: 12.4752,
      summary: "Södra Rom för mat, öl, industrikultur och bättre lokal rytm.",
      long_description:
        "Börja i Testaccio om du vill låta dagen byggas på riktig mat och röra dig mot Ostiense när kvällen ska bli mer öl- eller vinfokuserad.",
      tags: ["mat", "öl", "vin", "lokalt"],
    },
    stats: [
      { value: "6", label: "säkra söderstopp" },
      { value: "1", label: "naturlig sydloop" },
      { value: "lunch->sent", label: "bästa spannet" },
    ],
    stopsTitle: "Södra Rom när mat och lokal rytm ska bära dagen",
    stopsNote:
      "Här blir dagen bäst om du accepterar att marknad, industrimiljö och glas är starkare än klassiska sevärdhetsmåsten.",
    dayTitle: "Testaccio till Ostiense på riktigt",
    dayNote:
      "Låt lunch vara tung, eftermiddagen kulturell och kvällen byggd på bra öl, naturvin eller pizza utan att stressa.",
    actionTitle: "Det här är läget för dig som vill att Rom ska kännas mer vardag, mindre vykort",
    actionCopy:
      "Skicka in Testaccio och Ostiense till planeraren om du vill ha ett upplägg som är starkt på mat, kväll och lokal känsla snarare än klassiska fotopunkter.",
    stopCards: [
      {
        name: "Testaccio Market",
        type: "matankare",
        score: "9.4/10",
        description:
          "Börja här om du vill att dagen ska få en riktig romersk matbas utan turistteater.",
        focus: "Beställ: lunch eller smarta småstopp",
        why: "Ett av de bästa sätten att göra södra Rom begripligt från första timmen.",
        time: "Bäst: lunch",
        mapQuery: "Mercato Testaccio Rome",
        drawerQuery: "Testaccio Market",
      },
      {
        name: "Mattatoio",
        type: "industrikultur",
        score: "9.0/10",
        description:
          "Ger området ett råare kulturankare som gör att dagen känns samtida och mindre förutsägbar.",
        focus: "Gå hit: efter lunch eller vid regn",
        why: "Bra när du vill att kulturen ska kännas smartare än ännu ett klassiskt museum.",
        time: "Bäst: dagtid",
        mapQuery: "Mattatoio Rome",
        drawerQuery: "Mattatoio",
      },
      {
        name: "Centrale Montemartini",
        type: "museum",
        score: "9.3/10",
        description:
          "En av stadens mest oväntade kulturkrockar med skulpturer och kraftverksestetik i samma rum.",
        focus: "Gå hit: som extra kulturspår",
        why: "Perfekt om dagen behöver ett riktigt wow utan att bli turistig.",
        time: "Bäst: eftermiddag",
        mapQuery: "Centrale Montemartini Rome",
        drawerQuery: "Centrale Montemartini",
      },
      {
        name: "L'Oasi della Birra",
        type: "öl + vin",
        score: "9.1/10",
        description:
          "Skönt ofixat och ett mycket starkt stopp när du vill växla från matfokus till glasfokus utan att tappa lokalkänslan.",
        focus: "Beställ: öl eller vin efter humör",
        why: "Bra mittpunkt mellan Testaccio och Ostiense.",
        time: "Bäst: tidig kväll",
        mapQuery: "L'Oasi della Birra Rome",
        drawerQuery: "L'Oasi della Birra",
      },
      {
        name: "Latta - Fermenti e Miscele",
        type: "craft beer",
        score: "9.0/10",
        description:
          "Ett smartare ölstopp i Ostiense när kvällen ska bli mer specialiserad utan att förlora värmen.",
        focus: "Beställ: fatöl och stanna längre än planerat",
        why: "Passar perfekt om öl verkligen är en del av varför ni går hit.",
        time: "Bäst: kväll",
        mapQuery: "Latta Fermenti e Miscele Rome",
        drawerQuery: "Latta - Fermenti e Miscele",
      },
      {
        name: "Da Remo",
        type: "pizza-ikon",
        score: "9.2/10",
        description:
          "När en söderdag ska få ett riktigt matankare som folk faktiskt går omvägar för.",
        focus: "Beställ: pizza och boka smart om ni kan",
        why: "Bra när kvällen ska bli både matstark och social.",
        time: "Bäst: middagstid",
        mapQuery: "Da Remo Rome",
        drawerQuery: "Da Remo",
      },
    ],
    dayStops: [
      {
        time: "11:00",
        label: "Start",
        title: "Testaccio Market",
        description:
          "Börja med lunch eller smarta småstopp i marknaden så att dagen får en riktig bas direkt.",
        note: "Södra Rom gör sig bäst när maten får vara tidigt huvudnummer.",
      },
      {
        time: "13:30",
        label: "Kultur",
        title: "Mattatoio eller Centrale Montemartini",
        description:
          "Välj rå industrikultur eller kraftverksmuseum beroende på hur mycket djup du vill lägga in.",
        note: "Båda gör dagen betydligt mer minnesvärd än en rak lunch-till-bar-loop.",
      },
      {
        time: "16:30",
        label: "Mellanrytm",
        title: "Promenad via Piramide mot Ostiense",
        description:
          "Låt promenaden bära mellan södra områdena i stället för att hoppa direkt till kväll.",
        note: "Det är övergången som gör att kvällen inte känns påklistrad.",
      },
      {
        time: "18:00",
        label: "Första glaset",
        title: "L'Oasi della Birra",
        description:
          "Perfekt första kvällsstopp om gruppen är splittrad mellan öl, vin och bara bra stämning.",
        note: "Bra för att kalibrera om ni vill stanna söderut hela natten.",
      },
      {
        time: "20:00",
        label: "Kväll",
        title: "Latta eller Da Remo",
        description:
          "Nu väljer du om kvällen ska bli mer ölcentrerad eller mer pizzatung med stadig lokal energi.",
        note: "Det fina här är att båda valen känns rätt i området.",
      },
      {
        time: "22:45",
        label: "Final",
        title: "Stanna i Ostiense eller glid tillbaka långsamt",
        description:
          "Avsluta där energin känns starkast, inte där kartan säger att det är mest centralt.",
        note: "Södra Rom belönar dem som inte har bråttom tillbaka.",
      },
    ],
  },
  {
    id: "pigneto-san-lorenzo",
    label: "Pigneto + San Lorenzo",
    eyebrow: "EAST SIDE MODE",
    title: "Kreativ kvällsrunda, billigare glas och mer social energi",
    description:
      "Pigneto och San Lorenzo är rätt när du vill ha yngre energi, barer med mindre filter och ett östligt Rom som känns levt snarare än serverat.",
    selectorNote: "Mindre polerat och bäst när du vill ha mer folk än finish.",
    startLabel: "San Lorenzo",
    endLabel: "Pigneto",
    plannerPoints: [
      {
        label: "San Lorenzo",
        area: "San Lorenzo",
        lat: 41.8991,
        lng: 12.5132,
      },
      {
        label: "Pigneto",
        area: "Pigneto",
        lat: 41.8886,
        lng: 12.5342,
      },
    ],
    mapFocus: {
      label: "Pigneto",
      type: "district",
      area: "Pigneto",
      lat: 41.8886,
      lng: 12.5342,
      summary: "Östra Rom för kreativ puls, sena glas och mindre polerade kvarter.",
      long_description:
        "San Lorenzo fungerar som råare uppvärmning och Pigneto som mer kreativ final när kvällen ska bli både social och lokalt förankrad.",
      tags: ["party", "öl", "vin", "lokalt nattliv"],
    },
    stats: [
      { value: "5", label: "starka kvällsstopp" },
      { value: "1", label: "östra kvällsupplägget" },
      { value: "$ -> $$", label: "vänligare budget" },
    ],
    stopsTitle: "Östra Rom när du vill ha kreativ puls snarare än scenografi",
    stopsNote:
      "Det här området är bäst när du accepterar lite mer brus, lite mindre polish och mycket mer faktisk kvällsenergi.",
    dayTitle: "San Lorenzo till Pigneto utan att tappa tråden",
    dayNote:
      "Börja i råare tempo, bygg in ett eller två riktiga glasstopp och låt Pigneto ta över när kvällen verkligen startar.",
    actionTitle: "Det här läget är starkt för party, budgetsmart öl och socialt flöde",
    actionCopy:
      "Välj San Lorenzo till Pigneto i planeraren om du vill att appen ska ge dig en tydligare östlig kväll än de centrala standardstråken.",
    stopCards: [
      {
        name: "San Lorenzo",
        type: "kvällsbas",
        score: "8.9/10",
        description:
          "Råare, studentigare och bättre än sitt första intryck om du vill åt billigare glas och fler faktiska locals.",
        focus: "Gå hit: för uppvärmning och första ölen",
        why: "Bra som start när gruppen vill känna att kvällen redan pågår.",
        time: "Bäst: tidig kväll",
        mapQuery: "San Lorenzo Rome",
        drawerQuery: "San Lorenzo",
      },
      {
        name: "Piazza dei Sanniti",
        type: "socialt ankare",
        score: "8.8/10",
        description:
          "Inte vackrast i stan, men mycket användbar som enkel mötesplats innan ni splittras eller glider vidare.",
        focus: "Gå hit: som naturlig samlingspunkt",
        why: "Bra i grupp när kvällen behöver ett enkelt första golv.",
        time: "Bäst: kväll",
        mapQuery: "Piazza dei Sanniti Rome",
        drawerQuery: "Piazza dei Sanniti",
      },
      {
        name: "Pigneto",
        type: "kreativt kvarter",
        score: "9.3/10",
        description:
          "Ett av de tydligaste områdena när du vill lämna vykorts-Rom bakom dig och låta kvällen bli mer fri.",
        focus: "Gå hit: när huvudkvällen ska börja",
        why: "Pigneto bär flera olika slags kvällar utan att förlora sin personlighet.",
        time: "Bäst: sen eftermiddag till sent",
        mapQuery: "Pigneto Rome",
        drawerQuery: "Pigneto",
      },
      {
        name: "Necci dal 1924",
        type: "garden drinks",
        score: "9.1/10",
        description:
          "Ett av de bästa stoppen när du vill ge Pigneto lite form utan att göra det för tillrättalagt.",
        focus: "Beställ: vin eller lättare drink",
        why: "Bra brygga mellan lågmäld start och senare barrunda.",
        time: "Bäst: sen eftermiddag",
        mapQuery: "Necci dal 1924 Rome",
        drawerQuery: "Necci dal 1924",
      },
      {
        name: "Bottiglieria Pigneto",
        type: "vinbar",
        score: "9.2/10",
        description:
          "Vinigt, kreativt och perfekt om du vill att kvällen ska behålla ett lite mer kuraterat spår mitt i allt det sociala.",
        focus: "Beställ: glasvis och stanna till",
        why: "Ett väldigt bra stopp om gruppen vill hålla kvalitetskänslan uppe.",
        time: "Bäst: kväll",
        mapQuery: "Bottiglieria Pigneto Rome",
        drawerQuery: "Bottiglieria Pigneto",
      },
    ],
    dayStops: [
      {
        time: "17:30",
        label: "Uppvärmning",
        title: "San Lorenzo först",
        description:
          "Börja i det råare kvarteret med första ölen eller ett enkelt glas där kvällsenergin redan finns.",
        note: "Bra för att undvika att Pigneto känns färdigt för tidigt.",
      },
      {
        time: "18:45",
        label: "Mötesgolv",
        title: "Piazza dei Sanniti",
        description:
          "Samla gruppen, känn av humöret och bestäm om kvällen ska bli mer budgetsmart eller mer vinig.",
        note: "Det behöver inte vara vackert för att vara funktionellt.",
      },
      {
        time: "20:00",
        label: "Övergång",
        title: "Promenad eller kort hopp mot Pigneto",
        description:
          "Flytta er österut när kvällen faktiskt behöver börja, inte innan dess.",
        note: "Rytmen mellan områdena är halva grejen.",
      },
      {
        time: "20:45",
        label: "Första riktiga stoppet",
        title: "Necci dal 1924",
        description:
          "Låt Necci ge kvällen lite form innan den blir helt flytande.",
        note: "Perfekt om ni vill inleda Pigneto lite mjukare.",
      },
      {
        time: "22:00",
        label: "Vinkurva",
        title: "Bottiglieria Pigneto",
        description:
          "Ta en mer kuraterad sväng innan ni bestämmer om kvällen ska stanna där eller glida vidare.",
        note: "Bra motdrag till ren party-energi.",
      },
      {
        time: "23:30",
        label: "Fri final",
        title: "Pigneto sidogator",
        description:
          "Avsluta där energin känns bäst. I det här området får kvarteret själv vara sista stoppet.",
        note: "Östra Rom blir bäst när du slutar jaga en perfekt kuliss.",
      },
    ],
  },
];

const romeRoutes = [
  {
    id: "classic-loop",
    title: "Trastevere -> Ghetto -> Monti -> Colosseum -> Trastevere",
    vibe: "klassiker smart gjort",
    length: "ca 10 km",
    anchor: "Ankare: Colosseum by night + San Clemente",
    walk: "Start/slut i Trastevere, lugn heldag",
    summary:
      "För dig som vill ha ett stort Rom-ankare men där resten av dagen fortfarande känns mänsklig, barvänlig och mycket mer lokal än turistisk.",
    path:
      "Start: kaffe i Trastevere • Slut: vin eller öl tillbaka i Trastevere",
    routeLink:
      "https://www.google.com/maps/dir/Trastevere,+Rome/Jewish+Ghetto,+Rome/San+Clemente+al+Laterano,+Rome/Colosseum,+Rome/Trastevere,+Rome/",
    stops: [
      "10:30 Börja i Trastevere med lugn kaffe och första svängen genom sidogatorna.",
      "11:30 Korsa floden via Isola Tiberina och ta den smarta vägen genom Ghetto i stället för att gå rakt på turiststråken.",
      "13:00 Lägg lunch och smågator i Monti, där dagen fortfarande känns lätt och öppen.",
      "15:00 Gå in i San Pietro in Vincoli eller ännu hellre San Clemente om du vill ge dagen ett riktigt kyrkoankare.",
      "17:30 Ta ett första glas runt Monti innan kvällspulsen drar i gång på riktigt.",
      "20:30 Se Colosseum först när ljuset blivit mjukare och gå sedan långsamt hem mot Trastevere igen.",
    ],
    hiddenMentions: [
      "Isola Tiberina",
      "Teatro di Marcello",
      "San Clemente",
      "Montis bakgator",
    ],
    barMentions: [
      "aperitivo runt Via del Boschetto",
      "Freni e Frizioni på vägen hem",
      "Les Vignerons som lugn final",
    ],
    matches: [
      "Monti Backstreets",
      "Colosseum by Night",
      "Trevi Fountain at Dawn",
      "Piazza Navona Late",
      "Isola Tiberina",
      "San Clemente",
      "San Pietro in Vincoli",
      "Jewish Ghetto",
      "Trastevere Side Streets",
    ],
    matcherPitch:
      "Den här dagen är bäst när du vill ha ett klassiskt Rom-ögonblick men fortfarande landa hemma i Trastevere med rätt kvällskänsla.",
  },
  {
    id: "south-loop",
    title: "Trastevere -> Aventinen -> Testaccio -> Ostiense -> Trastevere",
    vibe: "mat + lokal energi",
    length: "ca 9 km",
    anchor: "Ankare: Giardino degli Aranci + Testaccio",
    walk: "Sydlig loop med många naturliga pauser",
    summary:
      "Det här är dagen för dig som vill ha utsikt, marknadsmat, södra Rom och en kväll som känns mer kvarter än kuliss.",
    path:
      "Start: tidig Trastevere-promenad • Slut: vinbar eller öl tillbaka över floden",
    routeLink:
      "https://www.google.com/maps/dir/Trastevere,+Rome/Giardino+degli+Aranci,+Rome/Testaccio+Market,+Rome/Centrale+Montemartini,+Rome/Trastevere,+Rome/",
    stops: [
      "10:30 Starta i Trastevere och gå söderut mot Aventinen innan staden blivit för varm och tät.",
      "11:15 Ta in Giardino degli Aranci och låt utsikten sätta dagens första ton.",
      "12:30 Gå ned mot Testaccio och gör lunch till ett riktigt matankare i eller runt marknaden.",
      "15:00 Fortsätt via Piramide och Cimitero Acattolico eller direkt mot Ostiense beroende på humör.",
      "17:00 Lägg aperitivo eller tidigt glas i Ostiense när området börjar få kvällsenergi.",
      "20:00 Gå långsamt tillbaka till Trastevere för middag och välj sedan bar efter hur mycket natt du vill ha kvar.",
    ],
    hiddenMentions: [
      "Santa Sabina",
      "Cimitero Acattolico",
      "Piramide",
      "Centrale Montemartini",
    ],
    barMentions: [
      "L'Antidoto efter hemkomst",
      "Bar San Calisto om du vill ha mer brus",
      "ett sista glas i Ostiense innan du vänder hem",
    ],
    matches: [
      "Giardino degli Aranci",
      "Testaccio Market",
      "Ostiense",
      "Centrale Montemartini",
      "Tor Marancia Murals",
      "Garbatella",
      "Piramide",
      "Cimitero Acattolico",
    ],
    matcherPitch:
      "Välj den här om du är sugen på mat, södra stadsdelar och en dag som känns lokal redan från lunch.",
  },
  {
    id: "centro-wine-loop",
    title: "Trastevere -> Campo -> Navona -> kyrkor + vin -> Trastevere",
    vibe: "vin, kyrkor och centro gjort rätt",
    length: "ca 8 km",
    anchor: "Ankare: Navona sent + kyrkloop i centro",
    walk: "Centrumdag utan stress och utan omvägar",
    summary:
      "Perfekt om du vill ha det mer centralt men fortfarande bygga dagen på vackra rum, smarta kyrkor, långsam mat och barer först när det är dags.",
    path:
      "Start: Trastevere före bruset • Slut: över Ponte Sisto tillbaka till barerna",
    routeLink:
      "https://www.google.com/maps/dir/Trastevere,+Rome/Campo+de'+Fiori,+Rome/Sant'Agostino,+Rome/Piazza+Navona,+Rome/Trastevere,+Rome/",
    stops: [
      "10:45 Börja i Trastevere och korsa floden över Ponte Sisto innan Campo de' Fiori är som mest högljutt.",
      "12:00 Lägg in dagens första kyrka, gärna Sant'Agostino eller Santa Maria sopra Minerva beroende på hur långt du vill gå.",
      "13:30 Ta lunch i Parione- eller Navona-kvarteren, men på sidogatorna snarare än mitt på torget.",
      "16:00 Fortsätt med en andra kulturpaus eller ett första glas vin i centro när tempot sjunker.",
      "19:30 Se Piazza Navona först på kvällen och använd den som stämningsankare, inte som hel dagsaktivitet.",
      "22:00 Gå tillbaka till Trastevere för den riktiga barfinalen när centrum börjat kännas färdigt.",
    ],
    hiddenMentions: [
      "Ponte Sisto i rätt ljus",
      "Sant'Agostino",
      "Santa Maria sopra Minerva",
      "smågatorna runt Parione",
    ],
    barMentions: [
      "Freni e Frizioni när du är tillbaka",
      "Enoteca Ferrara om middagen ska glida över i vin",
      "Bar San Calisto om du vill avsluta mer stimmigt",
    ],
    matches: [
      "Piazza Navona Late",
      "Campo de' Fiori",
      "Sant'Agostino",
      "Santa Maria sopra Minerva",
      "Freni e Frizioni",
      "Enoteca Ferrara",
      "Trastevere Side Streets",
    ],
    matcherPitch:
      "Det här är rätt dag när du vill åt centro men slippa känna att du bara följt huvudströmmen hela vägen.",
  },
  {
    id: "gianicolo-borgo-loop",
    title: "Trastevere -> Gianicolo -> Borgo/Prati -> Castel Sant'Angelo -> Trastevere",
    vibe: "scenisk och långsam",
    length: "ca 9 km",
    anchor: "Ankare: Gianicolo + Castel Sant'Angelo",
    walk: "Mycket promenad men låg stress",
    summary:
      "För dig som vill ha utsikt, kultur och en långsam dag som känns nästan filmisk, men ändå slutar i Trastevere med rätt sorts nattliv.",
    path:
      "Start: Trasteveres lugna morgon • Slut: Bar San Calisto, Ma Che eller Les Vignerons",
    routeLink:
      "https://www.google.com/maps/dir/Trastevere,+Rome/Fontana+dell'Acqua+Paola,+Rome/Castel+Sant'Angelo,+Rome/Prati,+Rome/Trastevere,+Rome/",
    stops: [
      "10:30 Börja i Trastevere och lägg in Villa Farnesina eller Museo di Roma in Trastevere om du vill starta med riktig kultur.",
      "12:00 Klättra upp mot Gianicolo och Fontanone när ljuset fortfarande jobbar för dig.",
      "14:00 Gå ned mot Borgo eller Prati för lunch och en paus från de mer tätpackade delarna av centro.",
      "16:30 Låt Castel Sant'Angelo bli dagens stora sceniska ankare, helst utan att fastna där för länge.",
      "18:30 Börja gå hemåt över bron och välj om du vill sakta ned eller bygga fart inför kvällen.",
      "21:00 Tillbaka i Trastevere väljer du bar beroende på om kvällen ska bli vin, öl eller bara mer brus.",
    ],
    hiddenMentions: [
      "Villa Farnesina",
      "Fontanone",
      "lugna gator i Borgo",
      "Ponte Vittorio på vägen hem",
    ],
    barMentions: [
      "Ma Che Siete Venuti a Fà för öl",
      "Les Vignerons för lugnare vinfinal",
      "Bar San Calisto för sista energin",
    ],
    matches: [
      "Gianicolo",
      "Villa Farnesina",
      "Museum of Rome in Trastevere",
      "Castel Sant'Angelo",
      "Ma Che Siete Venuti a Fà",
      "Bar San Calisto",
      "Les Vignerons",
    ],
    matcherPitch:
      "Det här är bästa dagen när du vill att staden ska kännas stor och vacker, men ändå landa i Trastevere igen före nattens sista glas.",
  },
];

const cardsGrid = document.getElementById("cardsGrid");
const spotlightGrid = document.getElementById("spotlightGrid");
const favoritesStrip = document.getElementById("favoritesStrip");
const favoriteCountChip = document.getElementById("favoriteCountChip");
const mapPlaceName = document.getElementById("mapPlaceName");
const mapPlaceMeta = document.getElementById("mapPlaceMeta");
const mapPlaceDescription = document.getElementById("mapPlaceDescription");
const mapPlaceNote = document.getElementById("mapPlaceNote");
const mapPlaceTags = document.getElementById("mapPlaceTags");
const mapPlaceLink = document.getElementById("mapPlaceLink");
const mapFavoriteButton = document.getElementById("mapFavoriteButton");
const installButton = document.getElementById("installButton");
const heroPlannerButton = document.getElementById("heroPlannerButton");
const heroLiveButton = document.getElementById("heroLiveButton");
const heroWildcardLabel = document.getElementById("heroWildcardLabel");
const heroWildcardTitle = document.getElementById("heroWildcardTitle");
const heroWildcardSummary = document.getElementById("heroWildcardSummary");
const heroWildcardMeta = document.getElementById("heroWildcardMeta");
const heroWildcardTags = document.getElementById("heroWildcardTags");
const heroWildcardApplyButton = document.getElementById("heroWildcardApplyButton");
const heroWildcardShuffleButton = document.getElementById("heroWildcardShuffleButton");
const cityPulseStart = document.getElementById("cityPulseStart");
const cityPulseTeaser = document.getElementById("cityPulseTeaser");
const cityPulseTeaserLabel = document.getElementById("cityPulseTeaserLabel");
const cityPulseTeaserTitle = document.getElementById("cityPulseTeaserTitle");
const cityPulseTeaserSummary = document.getElementById("cityPulseTeaserSummary");
const cityPulseTeaserButton = document.getElementById("cityPulseTeaserButton");
const cityPulseEditionLabel = document.getElementById("cityPulseEditionLabel");
const cityPulseHeadline = document.getElementById("cityPulseHeadline");
const cityPulseSubhead = document.getElementById("cityPulseSubhead");
const cityPulseEditionDate = document.getElementById("cityPulseEditionDate");
const cityPulseMeta = document.getElementById("cityPulseMeta");
const cityPulseWeatherValue = document.getElementById("cityPulseWeatherValue");
const cityPulseWeatherBrief = document.getElementById("cityPulseWeatherBrief");
const cityPulseClothingValue = document.getElementById("cityPulseClothingValue");
const cityPulseClothingAdvice = document.getElementById("cityPulseClothingAdvice");
const cityPulseDayChips = document.getElementById("cityPulseDayChips");
const cityPulseTimelineBrief = document.getElementById("cityPulseTimelineBrief");
const cityPulseTimeline = document.getElementById("cityPulseTimeline");
const cityPulseScopeFilters = document.getElementById("cityPulseScopeFilters");
const cityPulseRadiusFilters = document.getElementById("cityPulseRadiusFilters");
const cityPulseTimeFilters = document.getElementById("cityPulseTimeFilters");
const cityPulseFilters = document.getElementById("cityPulseFilters");
const cityPulseLevels = document.getElementById("cityPulseLevels");
const cityPulseUtilityNote = document.getElementById("cityPulseUtilityNote");
const cityPulseFooter = document.getElementById("cityPulseFooter");
const showFavoritesButton = document.getElementById("showFavoritesButton");
const showAllButton = document.getElementById("showAllButton");
const districtEyebrow = document.getElementById("districtEyebrow");
const districtTitle = document.getElementById("districtTitle");
const districtDescription = document.getElementById("districtDescription");
const districtStatsGrid = document.getElementById("districtStatsGrid");
const districtSelector = document.getElementById("districtSelector");
const districtStopsEyebrow = document.getElementById("districtStopsEyebrow");
const districtStopsTitle = document.getElementById("districtStopsTitle");
const districtStopsNote = document.getElementById("districtStopsNote");
const districtStopsGrid = document.getElementById("districtStopsGrid");
const districtDayEyebrow = document.getElementById("districtDayEyebrow");
const districtDayTitle = document.getElementById("districtDayTitle");
const districtDayNote = document.getElementById("districtDayNote");
const districtTimeline = document.getElementById("districtTimeline");
const districtActionTitle = document.getElementById("districtActionTitle");
const districtActionCopy = document.getElementById("districtActionCopy");
const districtSetStartButton = document.getElementById("districtSetStartButton");
const districtSetEndButton = document.getElementById("districtSetEndButton");
const districtPlanButton = document.getElementById("districtPlanButton");
const districtMapButton = document.getElementById("districtMapButton");
const routePlannerStart = document.getElementById("routePlannerStart");
const routePlannerOpenButton = document.getElementById("routePlannerOpenButton");
const closePlannerModalButton = document.getElementById("closePlannerModalButton");
const plannerModalBackdrop = document.getElementById("plannerModalBackdrop");
const plannerLaunchSummary = document.getElementById("plannerLaunchSummary");
const plannerModeAutoButton = document.getElementById("plannerModeAutoButton");
const plannerModeManualButton = document.getElementById("plannerModeManualButton");
const plannerModeLead = document.getElementById("plannerModeLead");
const plannerFineTuneDetails = document.getElementById("plannerFineTuneDetails");
const plannerHomeBaseShell = document.getElementById("plannerHomeBaseShell");
const plannerManualShell = document.getElementById("plannerManualShell");
const routeResults = document.getElementById("routeResults");
const savedRoutesSection = document.getElementById("savedRoutesSection");
const savedRoutesGrid = document.getElementById("savedRoutesGrid");
const routePlannerForm = document.getElementById("routePlannerForm");
const homeBaseModeSelect = document.getElementById("homeBaseModeSelect");
const homeBaseModeHint = document.getElementById("homeBaseModeHint");
const homeBasePresetSelect = document.getElementById("homeBasePresetSelect");
const homeBaseDistrictButtons = document.getElementById("homeBaseDistrictButtons");
const homeBaseDistrictSubButtons = document.getElementById("homeBaseDistrictSubButtons");
const homeBaseCustomInput = document.getElementById("homeBaseCustomInput");
const useCurrentPlaceAsHomeBaseButton = document.getElementById("useCurrentPlaceAsHomeBaseButton");
const useGeolocationAsHomeBaseButton = document.getElementById("useGeolocationAsHomeBaseButton");
const homeBaseActionRow = useCurrentPlaceAsHomeBaseButton?.closest(".route-lab-actions") || null;
const startModeSelect = document.getElementById("startModeSelect");
const endModeSelect = document.getElementById("endModeSelect");
const startModeHint = document.getElementById("startModeHint");
const endModeHint = document.getElementById("endModeHint");
const startPresetSelect = document.getElementById("startPresetSelect");
const endPresetSelect = document.getElementById("endPresetSelect");
const startDistrictButtons = document.getElementById("startDistrictButtons");
const endDistrictButtons = document.getElementById("endDistrictButtons");
const startDistrictSubButtons = document.getElementById("startDistrictSubButtons");
const endDistrictSubButtons = document.getElementById("endDistrictSubButtons");
const startCustomInput = document.getElementById("startCustomInput");
const endCustomInput = document.getElementById("endCustomInput");
const routeDateFrom = document.getElementById("routeDateFrom");
const routeDateTo = document.getElementById("routeDateTo");
const distanceModeSelect = document.getElementById("distanceModeSelect");
const walkingKmTarget = document.getElementById("walkingKmTarget");
const walkingKmValue = document.getElementById("walkingKmValue");
const legPacingSelect = document.getElementById("legPacingSelect");
const legPacingHint = document.getElementById("legPacingHint");
const useCurrentPlaceButton = document.getElementById("useCurrentPlaceButton");
const useGeolocationButton = document.getElementById("useGeolocationButton");
const useMapAsEndButton = document.getElementById("useMapAsEndButton");
const startActionRow = useCurrentPlaceButton?.closest(".route-lab-actions") || null;
const endActionRow = useMapAsEndButton?.closest(".route-lab-actions") || null;
const routePlanButton = document.getElementById("routePlanButton");
const routeResetButton = document.getElementById("routeResetButton");
const routePlanStickyButton = document.getElementById("routePlanStickyButton");
const plannerStatusMessage = document.getElementById("plannerStatusMessage");
const routeFallbackNote = document.getElementById("routeFallbackNote");
const routePlannerModeChip = document.getElementById("routePlannerModeChip");
const routeMatchSummary = document.getElementById("routeMatchSummary");
const plannerAdvancedSummary = document.getElementById("plannerAdvancedSummary");
const placeTemplate = document.getElementById("placeCardTemplate");
const spotlightTemplate = document.getElementById("spotlightCardTemplate");
const trastevereBarTemplate = document.getElementById("trastevereBarTemplate");
const timelineStopTemplate = document.getElementById("timelineStopTemplate");
const romeRouteTemplate = document.getElementById("romeRouteTemplate");
const plannerDayTemplate = document.getElementById("plannerDayTemplate");
const routeGuideBackdrop = document.getElementById("routeGuideBackdrop");
const routeGuideDrawer = document.getElementById("routeGuideDrawer");
const closeRouteGuideButton = document.getElementById("closeRouteGuideButton");
const routeGuideKicker = document.getElementById("routeGuideKicker");
const routeGuideTitle = document.getElementById("routeGuideTitle");
const routeGuideMeta = document.getElementById("routeGuideMeta");
const routeGuideRouteLine = document.getElementById("routeGuideRouteLine");
const routeGuideSummary = document.getElementById("routeGuideSummary");
const routeGuideStats = document.getElementById("routeGuideStats");
const routeGuideWhy = document.getElementById("routeGuideWhy");
const routeGuideStops = document.getElementById("routeGuideStops");
const routeGuideBarsBlock = document.getElementById("routeGuideBarsBlock");
const routeGuideBars = document.getElementById("routeGuideBars");
const routeGuideHiddenBlock = document.getElementById("routeGuideHiddenBlock");
const routeGuideHidden = document.getElementById("routeGuideHidden");
const plannerCityKey = "rome";
const routeGuidePrintButton = document.getElementById("routeGuidePrintButton");
const routeGuideShareButton = document.getElementById("routeGuideShareButton");
const routeGuideDirectionsLink = document.getElementById("routeGuideDirectionsLink");
const placeDrawer = document.getElementById("placeDrawer");
const placeDrawerBackdrop = document.getElementById("placeDrawerBackdrop");
const closePlaceDrawerButton = document.getElementById("closePlaceDrawerButton");
const placeDrawerType = document.getElementById("placeDrawerType");
const placeDrawerTitle = document.getElementById("placeDrawerTitle");
const placeDrawerSummary = document.getElementById("placeDrawerSummary");
const placeDrawerRouteFit = document.getElementById("placeDrawerRouteFit");
const placeDrawerMeta = document.getElementById("placeDrawerMeta");
const placeDrawerDescription = document.getElementById("placeDrawerDescription");
const placeDrawerHighlights = document.getElementById("placeDrawerHighlights");
const placeDrawerHappyHour = document.getElementById("placeDrawerHappyHour");
const placeDrawerMapButton = document.getElementById("placeDrawerMapButton");
const placeDrawerStartButton = document.getElementById("placeDrawerStartButton");
const placeDrawerEndButton = document.getElementById("placeDrawerEndButton");
const placeDrawerPlanButton = document.getElementById("placeDrawerPlanButton");
const placeDrawerPlannerNote = document.getElementById("placeDrawerPlannerNote");
const placeDrawerMapsLink = document.getElementById("placeDrawerMapsLink");
const placeDrawerSearchLink = document.getElementById("placeDrawerSearchLink");
const placeDrawerExtraLink = document.getElementById("placeDrawerExtraLink");
const searchInput = document.getElementById("searchInput");
const filterButtons = document.querySelectorAll("[data-filter]");
const scrollButtons = document.querySelectorAll("[data-scroll]");
const tabButtons = document.querySelectorAll("[data-tab]");
const tabPanels = document.querySelectorAll("[data-tab-panel]");
const switchTabButtons = document.querySelectorAll("[data-switch-tab]");
const routeModeFields = document.querySelectorAll("[data-mode-field]");
const preferenceInputs = document.querySelectorAll(".preference-chip input");
const plannerModeButtons = document.querySelectorAll("[data-planner-mode]");
const optimizerButtons = document.querySelectorAll("[data-optimizer-mode]");
const budgetTierButtons = document.querySelectorAll("[data-budget-tier]");
const routeModifierButtons = document.querySelectorAll("[data-route-modifier]");

const favoritesStorageKey = "roma-radar-favorites";
const savedRoutesStorageKey = "parranda-saved-routes";
const routeApiBase = "/api";
const romeTimeZone = "Europe/Rome";
const plannerAutoMode = "auto";
const plannerManualMode = "manual";
const legPacingLabels = {
  short: "Kort ben",
  balanced: "Balans",
  flexible: "Friare ben",
};
const legPacingHints = {
  short: "Kort försöker hålla varje enskilt ben tätare och mer sammanhängande.",
  balanced: "Balans håller benen rimliga utan att bli onödigt strikt.",
  flexible: "Spelar mindre roll låter motorn ta större hopp om helheten blir bättre.",
};
const plannerLoadingMessages = [
  "Läser datum och preferenser...",
  "Väljer smart bas, start och slut...",
  "Ordnar stopp till en naturlig rutt...",
  "Finjusterar efter gånglogik och live-läge...",
];
const plannerDistrictCatalog = [
  {
    id: "trastevere",
    label: "Trastevere",
    type: "district",
    area: "Trastevere",
    lat: 41.8885,
    lng: 12.4678,
  },
  {
    id: "monti",
    label: "Monti",
    type: "district",
    area: "Monti",
    lat: 41.8946,
    lng: 12.4951,
  },
  {
    id: "centro-storico",
    label: "Centro Storico",
    type: "district",
    area: "Centro Storico",
    lat: 41.8984,
    lng: 12.4768,
  },
  {
    id: "testaccio",
    label: "Testaccio",
    type: "district",
    area: "Testaccio",
    lat: 41.8788,
    lng: 12.4768,
  },
  {
    id: "ostiense-garbatella",
    label: "Ostiense/Garbatella",
    type: "district-group",
    area: "Ostiense/Garbatella",
    lat: 41.8698,
    lng: 12.4829,
    children: [
      {
        id: "ostiense",
        label: "Ostiense",
        type: "district",
        area: "Ostiense",
        lat: 41.8715,
        lng: 12.4794,
      },
      {
        id: "garbatella",
        label: "Garbatella",
        type: "district",
        area: "Garbatella",
        lat: 41.8576,
        lng: 12.4864,
      },
    ],
  },
  {
    id: "pigneto-san-lorenzo",
    label: "Pigneto/San Lorenzo",
    type: "district-group",
    area: "Pigneto/San Lorenzo",
    lat: 41.8936,
    lng: 12.5221,
    children: [
      {
        id: "pigneto",
        label: "Pigneto",
        type: "district",
        area: "Pigneto",
        lat: 41.8887,
        lng: 12.5306,
      },
      {
        id: "san-lorenzo",
        label: "San Lorenzo",
        type: "district",
        area: "San Lorenzo",
        lat: 41.8992,
        lng: 12.5158,
      },
    ],
  },
];

let activeFilter = "all";
let onlyFavorites = false;
let selectedPlaceName = places[0].name;
let favorites = loadFavorites();
let activeTab = "routes";
let activeRouteKey = null;
let deferredInstallPrompt = null;
let map;
let markers = new Map();
let routeOverlay;
let currentLocationCoords = null;
let plannerOptions = [];
let activePlannerMode = "auto";
let routeApiAvailable = null;
let routeRenderMode = "fallback";
let plannedDays = [];
let activePlannedDate = null;
let latestPlannerSnapshot = null;
let latestPlannerResolution = null;
let activeDistrictId = "monti";
let activeOptimizerMode = null;
let activeDistanceMode = "soft_target";
let activeBudgetTier = "standard";
let activeRouteModifier = null;
let activeDrawerItem = null;
let activeGuideRouteView = null;
let savedRoutes = loadSavedRoutes();
let cityPulseState = null;
let cityPulseCache = new Map();
let activeHeroWildcardId = null;
let activePulseScope = "all";
let activePulseTime = "now";
let activePulseLevel = "all";
let plannerLoadingTimer = null;
let cityPulseScopeStatus = "";
let activePulseRadiusKey = "5";
let activeLiveDate = getTodayIsoDate();
let liveEditionExpanded = false;
const expandedAlternativeDates = new Set();

const dayProfileLabels = {
  light: "Lätt dag",
  peak: "Peak",
  variation: "Variation",
  final: "Mjuk final",
};

const routingSourceLabels = {
  heuristic: "Heuristisk gånglogik",
  osrm: "Verifierad gångväg",
};

const cityPulseScopeMeta = {
  all: {
    label: "Hela Rom",
  },
  nearby: {
    label: "Nära mig",
  },
};

const cityPulseRadiusMeta = {
  "2": {
    label: "2 km",
    km: 2,
  },
  "5": {
    label: "5 km",
    km: 5,
  },
  "8": {
    label: "8 km",
    km: 8,
  },
};

const cityPulseTimeMeta = {
  now: {
    label: "Just nu",
  },
  tonight: {
    label: "Ikväll",
  },
  weekend: {
    label: "I helgen",
  },
};

const cityPulseLevelMeta = {
  city: {
    label: "Stadens rytm",
    sub: "Det en lokal bär med sig utan att tänka på det",
    mark: "I",
  },
  neighborhood: {
    label: "Kvarterspuls",
    sub: "Vad som faktiskt spelar bättre i olika delar av stan just nu",
    mark: "II",
  },
  venue: {
    label: "Ställesnivå",
    sub: "Plats- och live-signaler som kan förändra dagen på riktigt",
    mark: "III",
  },
};

const cityPulseVibeLabels = {
  slow: "långsam",
  buzzy: "pulsig",
  romantic: "romantisk",
  curious: "nyfiken",
};

const optimizerModes = {
  "bar-hop": {
    km: 7,
    distanceMode: "soft_target",
    preferences: ["öl", "vin", "mat", "hidden gems", "nattliv", "kväll", "party"],
    summary:
      "Bar hopping optimizer är aktiv. Jag väger nu upp kvällen mot öl, vin, puls och stopp som faktiskt känns värda mellan glasen.",
  },
  "pizza-freak": {
    km: 12,
    distanceMode: "no_limit",
    preferences: ["mat", "öl", "vin", "hidden gems"],
    summary:
      "Pizza freak är aktiv. Motorn får jaga riktigt starka pizzastopp även om rutten blir längre eller mindre lydig.",
  },
  "wine-crawl": {
    km: 9,
    distanceMode: "soft_target",
    preferences: ["vin", "mat", "kultur", "hidden gems", "nattliv", "low-key"],
    summary:
      "Wine crawl är aktiv. Nu väger motorn upp glas, vinbarer och lugnare kvällsrytm tydligare än vanlig sightseeing.",
  },
  "cocktail-night": {
    km: 8,
    distanceMode: "soft_target",
    preferences: ["cocktail", "vin", "nattliv", "hidden gems", "kväll", "party"],
    summary:
      "Cocktail night är aktiv. Kvällen byggs nu mer som en barserie med riktiga destinationer än som en vanlig promenaddag.",
  },
  "church-crawl": {
    km: 8,
    distanceMode: "soft_target",
    preferences: ["kyrkor", "kultur", "hidden gems", "mat", "low-key"],
    summary:
      "Church crawl är aktiv. Motorn lutar nu hårdare mot rum, kyrkor och kulturtyngd med lugnare övergångar mellan stoppen.",
  },
  "sunset-spots": {
    km: 12,
    distanceMode: "no_limit",
    preferences: ["utsikt", "vin", "kultur", "hidden gems", "kväll", "low-key"],
    summary:
      "Sunset spots är aktiv. Rutten får nu vara bredare för att fånga rätt ljus, rätt höjder och snyggare kvällsskifte.",
  },
};

const optimizerModeLabels = {
  "bar-hop": "Bar hopping",
  "pizza-freak": "Pizza freak",
  "wine-crawl": "Wine crawl",
  "cocktail-night": "Cocktail night",
  "church-crawl": "Church crawl",
  "sunset-spots": "Sunset spots",
};

const budgetTierLabels = {
  standard: "Standard",
  budget: "Rome on a budget",
  "dolce-vita": "La Dolce Vita",
};

const routeModifierLabels = {
  evening: "Mer kväll",
  culture: "Mer kultur",
  low_key: "Mer low-key",
  party: "Mer party",
};

const budgetTierCopy = {
  standard:
    "Standardnivå är aktiv. Parranda försöker nu hålla balansen mellan starka stopp, rimlig nota och tydlig personlighet.",
  budget:
    "Rome on a budget är aktivt. Motorn väger nu upp billigare öl, prisvänlig mat och kvarter där notan kan hållas nere utan att känslan dör.",
  "dolce-vita":
    "La Dolce Vita är aktivt. Motorn jagar nu mer premium, bokningsvärda glas och stopp som får kvällen att kännas större och lite lyxigare.",
};

const routeModifierCopy = {
  evening:
    "Mer kväll är aktivt. Nu letar Parranda tydligare efter dagar som växer sent, snarare än att göra sitt bästa före lunch.",
  culture:
    "Mer kultur är aktivt. Kyrkor, rum och riktiga kulturankare får nu bära mer av dagen.",
  low_key:
    "Mer low-key är aktivt. Motorn drar ned på showen och prioriterar bättre samtal, mjukare tempo och mindre brus.",
  party:
    "Mer party är aktivt. Kvällen väger nu upp mer puls, tätare glasstopp och senare energi.",
};

const remixModeCopy = {
  "more-wine": {
    summary: "Gör en ny version: mer vin, fortfarande samma dag som bas.",
    variantLabel: "Mer vinig",
  },
  "shorter-walk": {
    summary: "Gör en ny version: kortare gång, samma dag och känsla som utgångspunkt.",
    variantLabel: "Kortare gång",
  },
  "hidden-gems": {
    summary: "Gör en ny version: mer hidden gems, mindre uppenbar väg.",
    variantLabel: "Mer hidden gems",
  },
  "more-evening": {
    summary: "Gör en ny version: mer kväll, mer puls och senare stopp.",
    variantLabel: "Mer kväll",
  },
  "more-culture": {
    summary: "Gör en ny version: mer kultur, tydligare rum och mer innehåll mellan glasen.",
    variantLabel: "Mer kultur",
  },
  "low-key": {
    summary: "Gör en ny version: mjukare tempo, bättre samtalsstopp och mindre brus.",
    variantLabel: "Mer low-key",
  },
  "more-party": {
    summary: "Gör en ny version: mer party, senare energi och starkare nattdrag.",
    variantLabel: "Mer party",
  },
  budget: {
    summary: "Gör en ny version: billigare öl, mat och smartare budgetankare.",
    variantLabel: "Billigare",
  },
};

function createPulseSnapshot(snapshot, dateString) {
  return {
    ...snapshot,
    dates: [dateString],
    dateFrom: dateString,
    dateTo: dateString,
  };
}

function buildFallbackWildcards(dateString = getTodayIsoDate()) {
  return [
    {
      id: "fallback-monti-testaccio",
      title: "Monti -> Testaccio efter mörker",
      summary:
        "En enkel kvällsplan med kulturstart, middagssväng söderut och en final som känns mer levd än tillrättalagd.",
      meta: "ca 7 km • mer kväll • vin + mat + natt",
      tags: ["Vin", "Mat", "Kväll"],
      snapshot: createPulseSnapshot(
        {
          start: { type: "preset", label: "Monti" },
          end: { type: "preset", label: "Testaccio" },
          walkingKmTarget: 7,
          distanceMode: "soft_target",
          optimizerMode: "wine-crawl",
          budgetTier: "standard",
          modifier: "evening",
          preferences: ["vin", "mat", "kultur", "hidden gems", "nattliv", "kväll"],
        },
        dateString,
      ),
    },
    {
      id: "fallback-garbatella-ostiense",
      title: "Garbatella -> Ostiense utan turiststress",
      summary:
        "Mjuk söderkväll med kvarterskänsla, middag och bättre öl eller vin än i mer polerade standardstråk.",
      meta: "ca 6 km • low-key • öl + vin",
      tags: ["Low-key", "Öl", "Södra Rom"],
      snapshot: createPulseSnapshot(
        {
          start: { type: "preset", label: "Garbatella" },
          end: { type: "preset", label: "Ostiense" },
          walkingKmTarget: 6,
          distanceMode: "soft_target",
          optimizerMode: "bar-hop",
          budgetTier: "standard",
          modifier: "low_key",
          preferences: ["öl", "vin", "mat", "hidden gems", "low-key"],
        },
        dateString,
      ),
    },
    {
      id: "fallback-san-lorenzo-pigneto",
      title: "San Lorenzo -> Pigneto med mer puls",
      summary:
        "Billigare glas, mer folk och ett östligt kvällsspår som känns mer spontant än poserande.",
      meta: "ca 5 km • mer party • öl + cocktail",
      tags: ["Party", "Öl", "Cocktail"],
      snapshot: createPulseSnapshot(
        {
          start: { type: "preset", label: "San Lorenzo" },
          end: { type: "preset", label: "Pigneto" },
          walkingKmTarget: 5,
          distanceMode: "soft_target",
          optimizerMode: "cocktail-night",
          budgetTier: "budget",
          modifier: "party",
          preferences: ["öl", "cocktail", "mat", "hidden gems", "nattliv", "party", "kväll"],
        },
        dateString,
      ),
    },
  ];
}

function formatPulseDatePart(dateString, options) {
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    ...options,
  }).format(new Date(`${dateString}T12:00:00+02:00`));

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function getFallbackPulseDateLabels(dateString = getTodayIsoDate()) {
  return {
    weekdayLabel: formatPulseDatePart(dateString, { weekday: "long" }),
    dateLabel: formatPulseDatePart(dateString, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  };
}

function buildFallbackPulseItems(dateString = getTodayIsoDate()) {
  const date = dateString || getTodayIsoDate();
  const probe = new Date(`${date}T12:00:00+02:00`);
  const weekday = probe.getDay();
  const month = probe.getMonth() + 1;
  const items = [];

  if (weekday === 5 || weekday === 6) {
    items.push({
      id: "fallback-city-weekend",
      level: "city",
      kind: "Stadens rytm",
      title: "Helgkvällar i Rom blir starkast sent",
      where: "Monti, Testaccio, Pigneto och Ostiense",
      when: "Efter 19:00",
      blurb:
        "Spara gärna huvudenergin till sent. De kvarter som känns halvlugna vid aperitivo kan vara helt rätt först när kvällen hunnit sätta sig.",
      why_it_matters:
        "En bättre helgdag i Rom kommer ofta från färre kvarter och mer tålamod, inte från att försöka täcka allt före middagen.",
      matches_vibes: ["buzzy"],
      linked_wildcard_id: "fallback-san-lorenzo-pigneto",
      priority: 5,
    });
  } else {
    items.push({
      id: "fallback-city-smart",
      level: "city",
      kind: "Stadens rytm",
      title: "Rom blir oftast bättre när dagen får växa in i kvällen",
      where: "Hela staden",
      when: "Efter lunch till sent",
      blurb:
        "Det mesta känns mer levande efter att eftermiddagen landat. Det gäller särskilt om du vill att staden ska kännas mindre avbockad och mer upplevd.",
      why_it_matters:
        "Bygg inte dagen för tidigt. När tempot får växa blir även en enkel rutt mer trovärdig.",
      matches_vibes: ["slow", "curious"],
      linked_wildcard_id: "fallback-monti-testaccio",
      priority: 4,
    });
  }

  if (month >= 4 && month <= 5) {
    items.push({
      id: "fallback-city-spring",
      level: "city",
      kind: "Säsong",
      title: "Våren gör Rom extra bra till fots",
      where: "Hela Rom",
      when: "Golden hour till sent",
      blurb:
        "Det är läge för längre promenader, snyggare skiften mellan kvarter och rutter som får vara lite bredare utan att kännas stressade.",
      why_it_matters:
        "Just den här säsongen vinner på att låta promenaden bli en del av upplevelsen, inte bara transporten.",
      matches_vibes: ["romantic", "slow"],
      linked_wildcard_id: "fallback-monti-testaccio",
      priority: 3,
    });
  }

  items.push({
    id: "fallback-neighborhood",
    level: "neighborhood",
    kind: "Kvarterspuls",
    title: "Två starka kvarter slår oftare en full checklista",
    where: weekday === 5 || weekday === 6 ? "Monti + Testaccio eller Pigneto + San Lorenzo" : "Garbatella + Ostiense eller Monti + Testaccio",
    when: "Hela dagen",
    blurb:
      "Håll dig gärna till ett tydligt spår och låt promenaden mellan stoppen vara en del av rytmen i stället för att jaga för många punkter.",
    why_it_matters:
      "Det är så dagen känns mer lokal och mindre som en lista du försöker vinna över.",
    matches_vibes: ["curious"],
    linked_wildcard_id: "fallback-garbatella-ostiense",
    priority: 4,
  });

  items.push({
    id: "fallback-venue-wine",
    level: "venue",
    kind: "Ställesnivå",
    title: "Låt ett vin- eller ölankare bära kvällen",
    where: "Monti, Testaccio, Garbatella eller Trastevere",
    when: "Sen eftermiddag till kväll",
    blurb:
      "Ett riktigt glasstopp gör ofta större skillnad än ännu ett halvspontant ställe. Välj ett rum med tydlig känsla och bygg vidare därifrån.",
    why_it_matters:
      "När ett stopp verkligen bär stämningen blir resten av rutten enklare att lita på.",
    matches_vibes: ["slow", "buzzy"],
    linked_wildcard_id: "fallback-monti-testaccio",
    priority: 3,
  });

  return items;
}

function buildFallbackCityPulse(dateString = getTodayIsoDate()) {
  const date = dateString || getTodayIsoDate();
  const dateLabels = getFallbackPulseDateLabels(date);
  const items = buildFallbackPulseItems(date);

  return {
    date,
    weekday_label: dateLabels.weekdayLabel,
    date_label: dateLabels.dateLabel,
    headline: "Vad som faktiskt händer i Rom just nu.",
    subhead:
      "Fallback-läget håller kvar stadens rytm, kvarterspuls och platsnivå så att LIVE fortfarande går att använda smart.",
    note:
      "Visar en lokal fallback med stadspuls och kvällsidéer medan live-lagret laddar eller om nätet inte spelar med.",
    footer_note:
      "Fallback-läge är aktivt. LIVE ska fortfarande hjälpa dig avgöra vad som är värt att väga in i planner-flödet.",
    items,
    moments: items.slice(0, 4).map((item) => ({
      id: item.id,
      kindLabel: item.kind,
      title: item.title,
      note: item.blurb,
      areas: [item.where],
      tags: item.matches_vibes || [],
      linked_wildcard_id: item.linked_wildcard_id || null,
    })),
    official_events: [],
    wildcards: buildFallbackWildcards(date),
  };
}

function wildcardContextScore(wildcard) {
  if (!wildcard) {
    return 0;
  }

  const selected = selectedPlaceName || "";
  const startLabel = wildcard.snapshot?.start?.label || "";
  const endLabel = wildcard.snapshot?.end?.label || "";
  let score = 0;

  if (selected && [startLabel, endLabel].includes(selected)) {
    score += 4;
  }

  if (selected && wildcard.title.includes(selected)) {
    score += 2;
  }

  return score;
}

function getCityPulseWildcardsByContext() {
  return [...(cityPulseState?.wildcards || [])].sort(
    (left, right) => wildcardContextScore(right) - wildcardContextScore(left),
  );
}

function getWildcardById(wildcardId) {
  return (cityPulseState?.wildcards || []).find((item) => item.id === wildcardId) || null;
}

function getActiveHeroWildcard() {
  return getWildcardById(activeHeroWildcardId) || getCityPulseWildcardsByContext()[0] || null;
}

function renderHeroWildcard() {
  const wildcard = getActiveHeroWildcard();

  if (!wildcard) {
    heroWildcardLabel.textContent = "IKVÄLL I ROM";
    heroWildcardTitle.textContent = "Inga kvällsidéer tillgängliga just nu";
    heroWildcardSummary.textContent =
      "Parranda försöker ladda kvällsidéer. Under tiden kan du gå direkt till route plannern och bygga dagen själv.";
    heroWildcardMeta.textContent = "En ny kvällsidé dyker upp så snart kvällslagret är laddat.";
    heroWildcardTags.innerHTML = "";
    heroWildcardApplyButton.disabled = true;
    heroWildcardShuffleButton.disabled = true;
    return;
  }

  heroWildcardLabel.textContent = "IKVÄLL I ROM";
  heroWildcardTitle.textContent = wildcard.title;
  heroWildcardSummary.textContent = wildcard.summary;
  heroWildcardMeta.textContent = wildcard.meta;
  heroWildcardTags.innerHTML = "";
  (wildcard.tags || []).slice(0, 3).forEach((tagText) => {
    const chip = document.createElement("span");
    chip.textContent = tagText;
    heroWildcardTags.appendChild(chip);
  });
  heroWildcardApplyButton.disabled = false;
  heroWildcardShuffleButton.disabled = (cityPulseState?.wildcards || []).length < 2;
}

async function applyWildcardToPlanner(wildcard, { autoPlan = true, sourceLabel = null } = {}) {
  if (!wildcard?.snapshot) {
    return;
  }

  activeHeroWildcardId = wildcard.id;
  applyPlannerSnapshot(wildcard.snapshot);
  renderHeroWildcard();
  switchTab("routes");

  updateRouteMatchSummary(
    buildPlannerStyleSummary(
      `${sourceLabel || wildcard.title} ligger nu i plannern. Parranda bygger vidare härifrån.`,
    ),
  );

  if (!autoPlan) {
    openPlannerModal();
    return;
  }

  try {
    await planRoutes();
  } catch (_error) {
    routeRenderMode = "fallback";
    plannedDays = [];
    activePlannedDate = null;
    expandedAlternativeDates.clear();
    renderRouteResults();
    setRouteApiStatus(false);
    updateRouteMatchSummary(
      "Kvällsidén laddades, men live-planeringen svarade inte just nu. De kuraterade Rom-rutterna ligger kvar som fallback.",
    );
  }
}

function shuffleHeroWildcard() {
  const pool = getCityPulseWildcardsByContext();

  if (!pool.length) {
    return;
  }

  const alternatives = pool.filter((item) => item.id !== activeHeroWildcardId);
  const nextPool = alternatives.length ? alternatives : pool;
  const nextWildcard = nextPool[Math.floor(Math.random() * nextPool.length)];

  activeHeroWildcardId = nextWildcard.id;
  renderHeroWildcard();
}

function buildLegacyPulseItems(moments = []) {
  const levelOrder = ["city", "neighborhood", "venue", "venue"];

  return moments.map((moment, index) => ({
    id: moment.id || `legacy-pulse-${index}`,
    level: levelOrder[index] || "venue",
    kind: moment.kindLabel || "Stadspuls",
    title: moment.title,
    where: (moment.areas || []).join(" • ") || "Rom",
    when: "I dag",
    blurb: moment.note,
    why_it_matters: "Använd signalen som ett litet styrmedel när du bygger dagen nedan.",
    matches_vibes: moment.tags || [],
    linked_wildcard_id: moment.linked_wildcard_id || null,
    priority: 1,
  }));
}

function getNormalizedCityPulseItems() {
  if (Array.isArray(cityPulseState?.items) && cityPulseState.items.length) {
    return cityPulseState.items.filter(Boolean);
  }

  return buildLegacyPulseItems(cityPulseState?.moments || []);
}

function getCityPulseEventById(eventId) {
  return (
    (cityPulseState?.official_events || []).find(
      (event) => String(event.id) === String(eventId),
    ) || null
  );
}

function openCityPulseItem(item) {
  if (!item) {
    return;
  }

  if (item.official_event_id) {
    const officialEvent = getCityPulseEventById(item.official_event_id);

    if (officialEvent) {
      openPlaceDrawer(buildEventDrawerItem(officialEvent));
      return;
    }
  }

  if (item.place_query) {
    openPlaceDrawerByQuery(item.place_query);
  }
}

function normalizePulseText(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getActivePulseRadiusKm() {
  return cityPulseRadiusMeta[activePulseRadiusKey]?.km || 5;
}

function getRomeTimeSnapshot(referenceDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: romeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(referenceDate);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);

  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function getPulseReferenceTime(dateString, timeKey) {
  const romeNow = getRomeTimeSnapshot();

  if ((dateString || romeNow.date) === romeNow.date) {
    return {
      ...romeNow,
      isPreview: false,
    };
  }

  const previewHourByMode = {
    now: 13,
    tonight: 20,
    weekend: 13,
  };
  const hour = previewHourByMode[timeKey] || 13;

  return {
    date: dateString,
    hour,
    minute: 0,
    totalMinutes: hour * 60,
    label: `${String(hour).padStart(2, "0")}:00`,
    isPreview: true,
  };
}

function extractPulseTimes(text = "") {
  return [...String(text).matchAll(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\b/g)].map((match) => ({
    hour: Number(match[1]),
    minute: Number(match[2] || 0),
    minutes: Number(match[1]) * 60 + Number(match[2] || 0),
  }));
}

function formatPulseClock(minutes) {
  if (!Number.isFinite(minutes)) {
    return "";
  }

  const normalized = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function truncatePulseLabel(text = "", maxLength = 44) {
  const normalized = String(text || "").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function parsePulseLocalClock(value) {
  if (!value) {
    return null;
  }

  const match = String(value).match(/(?:T|\s)(\d{2}):(\d{2})/);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function inferPulseWindow(item) {
  const explicitStart = parsePulseLocalClock(item.starts_at_local);
  const explicitEnd = parsePulseLocalClock(item.ends_at_local);

  if (explicitStart !== null || explicitEnd !== null) {
    return {
      startMinutes: explicitStart ?? explicitEnd,
      endMinutes: explicitEnd ?? (explicitStart !== null ? Math.min(explicitStart + 120, 23 * 60 + 59) : null),
      certainty: "explicit",
    };
  }

  const whenText = String(item.when || "");
  const text = normalizePulseText(
    [item.when, item.kind, item.title, item.blurb, item.why_it_matters].filter(Boolean).join(" "),
  );
  const rangeMatch = whenText.match(
    /\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*[–-]\s*([01]?\d|2[0-3])(?::([0-5]\d))?\b/,
  );

  if (rangeMatch) {
    return {
      startMinutes: Number(rangeMatch[1]) * 60 + Number(rangeMatch[2] || 0),
      endMinutes: Number(rangeMatch[3]) * 60 + Number(rangeMatch[4] || 0),
      certainty: "range",
    };
  }

  const times = extractPulseTimes(whenText);
  const firstTime = times[0]?.minutes ?? null;
  const lastTime = times[times.length - 1]?.minutes ?? null;

  if (/lunch och middag/.test(text)) {
    return { startMinutes: 12 * 60, endMinutes: 21 * 60 + 30, certainty: "phrase" };
  }

  if (/dagtid till tidig kvall|dag till tidig kvall/.test(text)) {
    return { startMinutes: 10 * 60, endMinutes: 18 * 60 + 30, certainty: "phrase" };
  }

  if (/fran eftermiddag till kvall/.test(text)) {
    return { startMinutes: 15 * 60, endMinutes: 22 * 60, certainty: "phrase" };
  }

  if (/eftermiddag till forsta glaset/.test(text)) {
    return { startMinutes: 15 * 60, endMinutes: 19 * 60 + 30, certainty: "phrase" };
  }

  if (/sen eftermiddag till sent/.test(text)) {
    return { startMinutes: 17 * 60, endMinutes: 23 * 60 + 30, certainty: "phrase" };
  }

  if (/golden hour/.test(text)) {
    return { startMinutes: 18 * 60 + 30, endMinutes: 21 * 60, certainty: "phrase" };
  }

  if (/tidiga kvallar|tidig kvall/.test(text)) {
    return { startMinutes: 17 * 60 + 30, endMinutes: 21 * 60, certainty: "phrase" };
  }

  if (/hela dagen/.test(text)) {
    return { startMinutes: 10 * 60, endMinutes: 22 * 60, certainty: "phrase" };
  }

  if (/dagtid/.test(text)) {
    return { startMinutes: 10 * 60, endMinutes: 17 * 60 + 30, certainty: "phrase" };
  }

  if (/middag/.test(text) && !/lunch/.test(text)) {
    return { startMinutes: firstTime ?? 19 * 60, endMinutes: lastTime ?? 22 * 60, certainty: "phrase" };
  }

  if (/lunch/.test(text) && !/middag/.test(text)) {
    return { startMinutes: firstTime ?? 12 * 60, endMinutes: lastTime ?? 15 * 60, certainty: "phrase" };
  }

  if (/fran|efter|avspark|borjar/.test(text) && firstTime !== null) {
    const defaultDurationMinutes =
      /set|konsert|jazz|trio|kvall/.test(text) ? 120 : /match|avspark/.test(text) ? 150 : 210;
    return {
      startMinutes: firstTime,
      endMinutes: lastTime && lastTime > firstTime ? lastTime + 90 : Math.min(firstTime + defaultDurationMinutes, 23 * 60 + 59),
      certainty: "time",
    };
  }

  if (/kvall|sent|aperitivo|jazz|premiar/.test(text)) {
    return {
      startMinutes: firstTime ?? 18 * 60 + 30,
      endMinutes: lastTime && lastTime > (firstTime ?? 0) ? lastTime + 60 : 23 * 60 + 30,
      certainty: "theme",
    };
  }

  if (firstTime !== null) {
    return {
      startMinutes: firstTime,
      endMinutes: lastTime && lastTime > firstTime ? lastTime : Math.min(firstTime + 120, 23 * 60 + 59),
      certainty: "time",
    };
  }

  return {
    startMinutes: null,
    endMinutes: null,
    certainty: "timeless",
  };
}

function pulseLooksLikeTonight(item) {
  const text = normalizePulseText(
    [item.when, item.kind, item.title, item.blurb, item.why_it_matters].filter(Boolean).join(" "),
  );
  const hours = extractPulseTimes(item.when || "");

  return (
    item.level === "venue" ||
    text.includes("kvall") ||
    text.includes("sent") ||
    text.includes("aperitivo") ||
    text.includes("middag") ||
    text.includes("jazz") ||
    text.includes("premiar") ||
    hours.some((time) => time.hour >= 18)
  );
}

function enrichPulseItemTiming(item, dateString, timeKey) {
  const reference = getPulseReferenceTime(dateString, timeKey);
  const window = inferPulseWindow(item);
  const startMinutes = window.startMinutes;
  const endMinutes = window.endMinutes;
  const hasWindow = Number.isFinite(startMinutes) || Number.isFinite(endMinutes);
  const eveningStart = 17 * 60;
  const eveningEnd = 23 * 60 + 59;
  let status = "timeless";

  if (hasWindow) {
    const safeStart = Number.isFinite(startMinutes) ? startMinutes : 0;
    const safeEnd = Number.isFinite(endMinutes) ? endMinutes : 23 * 60 + 59;

    if (reference.totalMinutes < safeStart) {
      status = safeStart - reference.totalMinutes <= 4 * 60 ? "upcoming" : "later";
    } else if (reference.totalMinutes > safeEnd) {
      status = "past";
    } else {
      status = "live";
    }
  }

  const intersectsEvening =
    hasWindow &&
    (Number.isFinite(startMinutes) ? startMinutes : 0) <= eveningEnd &&
    (Number.isFinite(endMinutes) ? endMinutes : eveningEnd) >= eveningStart;

  let label = item.when || "I dag";

  if (status === "live") {
    label = Number.isFinite(endMinutes)
      ? `Pågår nu • till ${formatPulseClock(endMinutes)}`
      : "Pågår nu";
  } else if (status === "upcoming") {
    label = Number.isFinite(startMinutes)
      ? `Snart • ${formatPulseClock(startMinutes)}`
      : "Snart";
  } else if (status === "later") {
    label = Number.isFinite(startMinutes)
      ? `Senare • ${formatPulseClock(startMinutes)}`
      : item.when || "Senare i dag";
  } else if (status === "past") {
    label = Number.isFinite(endMinutes)
      ? `Passerade • ${formatPulseClock(endMinutes)}`
      : "Passerade";
  }

  return {
    ...item,
    timing: {
      reference,
      startMinutes,
      endMinutes,
      hasWindow,
      certainty: window.certainty,
      status,
      intersectsEvening,
      label,
    },
  };
}

function isWeekendLikeDate(dateString) {
  const day = new Date(`${dateString || getTodayIsoDate()}T12:00:00`).getDay();
  return day === 5 || day === 6 || day === 0;
}

function pulseItemMatchesTime(item, timeKey, dateString) {
  const timing = item.timing || enrichPulseItemTiming(item, dateString, timeKey).timing;

  if (timeKey === "now") {
    return ["live", "upcoming", "timeless"].includes(timing.status);
  }

  const text = normalizePulseText(
    [item.when, item.kind, item.title, item.blurb, item.why_it_matters].filter(Boolean).join(" "),
  );

  if (timeKey === "tonight") {
    return timing.intersectsEvening || ["live", "upcoming", "later"].includes(timing.status) || pulseLooksLikeTonight(item);
  }

  if (timeKey === "weekend") {
    return (
      timing.status !== "past" &&
      (
        isWeekendLikeDate(dateString) ||
        text.includes("helg") ||
        text.includes("weekend") ||
        text.includes("lordag") ||
        text.includes("sondag") ||
        text.includes("festival") ||
        Boolean(item.official_event_id) ||
        pulseLooksLikeTonight(item)
      )
    );
  }

  return true;
}

function getPulseLookupCatalog() {
  const catalog = new Map(getFallbackPointCatalog());

  getPlannerDistrictGroups().forEach((item) => {
    catalog.set(item.label, {
      label: item.label,
      lat: item.lat,
      lng: item.lng,
    });

    (item.children || []).forEach((child) => {
      catalog.set(child.label, {
        label: child.label,
        lat: child.lat,
        lng: child.lng,
      });
    });
  });

  return catalog;
}

function resolvePulseItemPoint(item) {
  if (typeof item?.lat === "number" && typeof item?.lng === "number") {
    return {
      label: item.title || item.where || "Rom",
      lat: item.lat,
      lng: item.lng,
    };
  }

  if (item?.official_event_id) {
    const event = getCityPulseEventById(item.official_event_id);

    if (event && typeof event.lat === "number" && typeof event.lng === "number") {
      return {
        label: event.venue || event.title,
        lat: event.lat,
        lng: event.lng,
      };
    }
  }

  const catalog = getPulseLookupCatalog();
  const candidates = [
    item?.place_query,
    item?.title,
    ...(String(item?.where || "")
      .split("•")
      .map((part) => part.trim())
      .filter(Boolean)),
  ];

  for (const candidate of candidates) {
    if (catalog.has(candidate)) {
      return catalog.get(candidate);
    }

    const normalizedCandidate = normalizePulseText(candidate);

    for (const [label, point] of catalog.entries()) {
      const normalizedLabel = normalizePulseText(label);
      if (
        normalizedCandidate.includes(normalizedLabel) ||
        normalizedLabel.includes(normalizedCandidate)
      ) {
        return point;
      }
    }
  }

  return null;
}

function pulseDistanceKm(pointA, pointB) {
  if (
    !pointA ||
    !pointB ||
    typeof pointA.lat !== "number" ||
    typeof pointA.lng !== "number" ||
    typeof pointB.lat !== "number" ||
    typeof pointB.lng !== "number"
  ) {
    return null;
  }

  const earthRadiusKm = 6371;
  const latDiff = ((pointB.lat - pointA.lat) * Math.PI) / 180;
  const lngDiff = ((pointB.lng - pointA.lng) * Math.PI) / 180;
  const latA = (pointA.lat * Math.PI) / 180;
  const latB = (pointB.lat * Math.PI) / 180;
  const a =
    Math.sin(latDiff / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(lngDiff / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pulseItemMatchesScope(item, scopeKey) {
  if (scopeKey === "all") {
    return true;
  }

  const itemPoint = resolvePulseItemPoint(item);
  const distanceKm = pulseDistanceKm(currentLocationCoords, itemPoint);
  return distanceKm !== null && distanceKm <= getActivePulseRadiusKm();
}

function comparePulseItems(left, right) {
  const statusOrder = {
    live: 0,
    upcoming: 1,
    later: 2,
    timeless: 3,
    past: 4,
  };
  const leftTiming = left.timing || {};
  const rightTiming = right.timing || {};
  const leftRank = statusOrder[leftTiming.status] ?? statusOrder.timeless;
  const rightRank = statusOrder[rightTiming.status] ?? statusOrder.timeless;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const leftStart = Number.isFinite(leftTiming.startMinutes) ? leftTiming.startMinutes : 24 * 60;
  const rightStart = Number.isFinite(rightTiming.startMinutes) ? rightTiming.startMinutes : 24 * 60;

  if (leftStart !== rightStart) {
    return leftStart - rightStart;
  }

  return (right.priority || 0) - (left.priority || 0);
}

function getPulseConditionLabel(weather) {
  if (!weather) {
    return "";
  }

  if (weather.condition === "rain") {
    return "risk för regn";
  }

  if (weather.condition === "sun") {
    return weather.isDay === false ? "klar kväll" : "klart och öppet";
  }

  if (weather.condition === "clouds") {
    return "molnigt men gångbart";
  }

  return "blandat väder";
}

function getPulseClothingAdvice(weather) {
  if (!weather) {
    return "";
  }

  const maxTemp = Number(weather.maxTemp);
  const minTemp = Number(weather.minTemp);
  const rainNote = weather.condition === "rain" ? ", gärna paraply" : "";

  if (Number.isFinite(maxTemp) && maxTemp >= 30) {
    return `så lätt som möjligt mitt på dagen${rainNote}`;
  }

  if (Number.isFinite(maxTemp) && maxTemp >= 24 && Number.isFinite(minTemp) && minTemp >= 17) {
    return `t-shirt eller skjorta räcker, tunt lager sent${rainNote}`;
  }

  if (Number.isFinite(maxTemp) && maxTemp >= 20) {
    return `lätt lager funkar dagtid, tunn jacka gör kvällen bättre${rainNote}`;
  }

  if (Number.isFinite(maxTemp) && maxTemp >= 15) {
    return `tunn jacka eller stickat känns smart${rainNote}`;
  }

  return `jacka rekommenderas även dagtid${rainNote}`;
}

function buildPulseWeatherBrief(weather, dateString) {
  if (!weather) {
    return "Väder saknas just nu, så LIVE lutar sig bara på stadspuls och platsnivå.";
  }

  const romeNow = getRomeTimeSnapshot();
  const isToday = (dateString || romeNow.date) === romeNow.date;
  const currentTemp = Number.isFinite(weather.currentTemp) ? Math.round(weather.currentTemp) : null;
  const maxTemp = Number.isFinite(weather.maxTemp) ? Math.round(weather.maxTemp) : null;
  const minTemp = Number.isFinite(weather.minTemp) ? Math.round(weather.minTemp) : null;
  const rangeLabel =
    Number.isFinite(minTemp) && Number.isFinite(maxTemp) ? `${minTemp}–${maxTemp}°` : null;
  const lead =
    isToday && currentTemp !== null ? `${currentTemp}° nu` : rangeLabel ? `${rangeLabel} väntat` : "Väder klart";
  const condition = getPulseConditionLabel(weather);
  const clothing = getPulseClothingAdvice(weather);

  return [lead, condition, clothing].filter(Boolean).join(" • ");
}

function buildPulseTimelineBrief(items, dateString, timeKey) {
  const reference = getPulseReferenceTime(dateString, timeKey);
  const liveItems = items.filter((item) => item.timing?.status === "live");
  const nextItem =
    items.find((item) => item.timing?.status === "upcoming") ||
    items.find((item) => item.timing?.status === "later") ||
    items.find((item) => item.timing?.status === "timeless") ||
    null;
  const prefix = reference.isPreview
    ? `Vald dag • ${formatCompactSwedishDate(dateString)}`
    : `Nu ${reference.label} i Rom`;

  if (liveItems.length && nextItem && nextItem !== liveItems[0]) {
    const nextTime = Number.isFinite(nextItem.timing?.startMinutes)
      ? formatPulseClock(nextItem.timing.startMinutes)
      : "senare";
    return `${prefix} • ${liveItems.length} pågår • nästa ${nextTime} ${truncatePulseLabel(nextItem.title, 34)}`;
  }

  if (liveItems.length) {
    return `${prefix} • ${liveItems.length} signal${liveItems.length > 1 ? "er" : ""} pågår nu`;
  }

  if (nextItem) {
    const nextTime = Number.isFinite(nextItem.timing?.startMinutes)
      ? formatPulseClock(nextItem.timing.startMinutes)
      : "snart";
    return `${prefix} • nästa ${nextTime} ${truncatePulseLabel(nextItem.title, 34)}`;
  }

  return reference.isPreview
    ? `Vald dag • ${formatCompactSwedishDate(dateString)} • inga starka signaler ännu`
    : `Nu ${reference.label} i Rom • inga starka signaler just nu`;
}

function buildPulseWeatherValue(weather, dateString) {
  if (!weather) {
    return "Väder saknas";
  }

  const romeNow = getRomeTimeSnapshot();
  const isToday = (dateString || romeNow.date) === romeNow.date;
  const currentTemp = Number.isFinite(weather.currentTemp) ? Math.round(weather.currentTemp) : null;
  const maxTemp = Number.isFinite(weather.maxTemp) ? Math.round(weather.maxTemp) : null;
  const minTemp = Number.isFinite(weather.minTemp) ? Math.round(weather.minTemp) : null;

  if (isToday && currentTemp !== null) {
    return `${currentTemp}° nu`;
  }

  if (maxTemp !== null && minTemp !== null) {
    return `${maxTemp}° / ${minTemp}° kväll`;
  }

  if (maxTemp !== null) {
    return `${maxTemp}° väntat`;
  }

  return "Väder klart";
}

function getPulseClothingHeadline(weather) {
  if (!weather) {
    return "Lokalt lager";
  }

  const maxTemp = Number(weather.maxTemp);

  if (Number.isFinite(maxTemp) && maxTemp >= 28) {
    return "Svalt och lätt";
  }

  if (Number.isFinite(maxTemp) && maxTemp >= 22) {
    return "T-shirt + lätt lager";
  }

  if (Number.isFinite(maxTemp) && maxTemp >= 17) {
    return "Skjorta + tunn jacka";
  }

  return "Jacka rekommenderas";
}

function buildPulseTeaserSummary() {
  const availableDates = getLiveEditionDates();
  const targetDate = availableDates[0] || cityPulseState?.date || getTodayIsoDate();
  const dayCount = plannedDays.length || availableDates.length;
  const weatherLine = buildPulseWeatherBrief(cityPulseState?.weather, targetDate);

  if (plannedDays.length) {
    return `Kopplad till ${dayCount} vald dag${dayCount > 1 ? "ar" : ""}. ${weatherLine}`;
  }

  return `${weatherLine} Öppna LIVE när du vill läsa dagens edition mer som en lokal utgåva.`;
}

function renderCityPulseTeaser() {
  if (!cityPulseTeaser || !cityPulseTeaserTitle || !cityPulseTeaserSummary || !cityPulseTeaserLabel) {
    return;
  }

  const targetDate = ensureActiveLiveDate();
  const weekdayLabel =
    cityPulseState?.weekday_label ||
    getFallbackPulseDateLabels(targetDate).weekdayLabel;
  const dateLabel =
    cityPulseState?.date_label ||
    getFallbackPulseDateLabels(targetDate).dateLabel;

  cityPulseTeaserLabel.textContent = plannedDays.length
    ? `LIVE • ${plannedDays.length} vald dag${plannedDays.length > 1 ? "ar" : ""}`
    : `Just nu i Rom • ${weekdayLabel} ${dateLabel}`;
  cityPulseTeaserTitle.textContent =
    cityPulseState?.headline || "LIVE-edition för Rom";
  cityPulseTeaserSummary.textContent = buildPulseTeaserSummary();
}

function getLiveMatchSummaryForPulseItem(item) {
  if (!item?.official_event_id) {
    return "";
  }

  const event = getCityPulseEventById(item.official_event_id);

  if (!event?.best_route_date) {
    return "";
  }

  const day = plannedDays.find((plannedDay) => plannedDay.date === event.best_route_date);

  if (!day) {
    return "";
  }

  return `Passar bäst med ${formatSwedishDate(day.date)}${event.best_route_label ? ` • ${event.best_route_label}` : ""}`;
}

function renderCityPulseDayChips() {
  if (!cityPulseDayChips) {
    return;
  }

  const availableDates = getLiveEditionDates();

  cityPulseDayChips.innerHTML = "";
  cityPulseDayChips.hidden = availableDates.length <= 1;

  availableDates.forEach((date, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `city-pulse-day-chip${date === activeLiveDate ? " active" : ""}`;
    button.textContent = plannedDays.length
      ? `Dag ${index + 1} • ${formatCompactSwedishDate(date)}`
      : formatCompactSwedishDate(date);
    button.addEventListener("click", async () => {
      activeLiveDate = date;
      await loadCityPulse(date);
    });
    cityPulseDayChips.appendChild(button);
  });
}

function pulseTimelineOffset(minutes) {
  if (!Number.isFinite(minutes)) {
    return 0;
  }

  const timelineStart = 6 * 60;
  const timelineEnd = 24 * 60;
  const clamped = Math.max(timelineStart, Math.min(timelineEnd, minutes));
  return ((clamped - timelineStart) / (timelineEnd - timelineStart)) * 100;
}

function renderCityPulseTimeline(items, dateString) {
  if (!cityPulseTimeline) {
    return;
  }

  cityPulseTimeline.innerHTML = "";

  const reference = getPulseReferenceTime(dateString, activePulseTime);
  const track = document.createElement("div");
  const labels = document.createElement("div");
  const tickHours = [6, 9, 12, 15, 18, 21, 24];

  track.className = "city-pulse-timeline-track";
  labels.className = "city-pulse-timeline-labels";

  tickHours.forEach((hour) => {
    const tick = document.createElement("span");
    const label = document.createElement("span");
    const offset = pulseTimelineOffset(hour === 24 ? 24 * 60 : hour * 60);

    tick.className = "city-pulse-timeline-tick";
    tick.style.left = `${offset}%`;
    label.className = "city-pulse-timeline-label";
    label.style.left = `${offset}%`;
    label.textContent = hour === 24 ? "00" : String(hour).padStart(2, "0");

    track.appendChild(tick);
    labels.appendChild(label);
  });

  items
    .filter((item) => Number.isFinite(item.timing?.startMinutes))
    .sort(comparePulseItems)
    .slice(0, 8)
    .forEach((item) => {
      const marker = document.createElement("button");
      const status = item.timing?.status || "timeless";
      const left = pulseTimelineOffset(item.timing.startMinutes);

      marker.type = "button";
      marker.className = `city-pulse-timeline-marker is-${status}`;
      marker.style.left = `${left}%`;
      marker.title = `${item.title} • ${item.timing?.label || item.when || "I dag"}`;
      marker.addEventListener("click", () => {
        openCityPulseItem(item);
      });
      track.appendChild(marker);
    });

  const nowMarker = document.createElement("span");
  nowMarker.className = "city-pulse-timeline-now";
  nowMarker.style.left = `${pulseTimelineOffset(reference.totalMinutes)}%`;
  nowMarker.textContent = reference.isPreview ? `Preview • ${reference.label}` : `Nu • ${reference.label}`;
  track.appendChild(nowMarker);

  cityPulseTimeline.append(track, labels);
}

async function openLiveEdition({ date = null, scroll = true } = {}) {
  liveEditionExpanded = true;
  activeLiveDate = date || ensureActiveLiveDate();
  await loadCityPulse(activeLiveDate);

  if (scroll) {
    document.querySelector("#cityPulseStart")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
}

function buildPulseUtilityCopy(visibleItems, totalItems) {
  const scopeLabel = cityPulseScopeMeta[activePulseScope]?.label || "Hela Rom";
  const timeLabel = cityPulseTimeMeta[activePulseTime]?.label || "Just nu";
  const radiusLabel = cityPulseRadiusMeta[activePulseRadiusKey]?.label || "5 km";

  if (cityPulseScopeStatus) {
    return cityPulseScopeStatus;
  }

  if (activePulseScope === "nearby") {
    return `${scopeLabel} visar ${visibleItems.length} signaler inom cirka ${radiusLabel}. ${timeLabel} håller fokus på det som faktiskt spelar roll nu.`;
  }

  return `${scopeLabel} visar ${totalItems.length} signaler. Växla till Nära mig för ett närmare lager inom cirka ${radiusLabel}, eller låt ${timeLabel.toLowerCase()} rensa bort det som inte är aktuellt.`;
}

function createPulseModeButton({ key, label, active, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `city-pulse-mode-button${active ? " active" : ""}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createPulseFilterButton(levelKey, label, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `city-pulse-filter-button${activePulseLevel === levelKey ? " active" : ""}`;
  button.textContent = `${label} (${count})`;
  button.addEventListener("click", () => {
    activePulseLevel = levelKey;
    renderCityPulse();
  });
  return button;
}

function createPulseEntry(item) {
  const article = document.createElement("article");
  const top = document.createElement("div");
  const kind = document.createElement("span");
  const when = document.createElement("span");
  const where = document.createElement("p");
  const blurb = document.createElement("p");
  const matchNote = document.createElement("p");
  const reasonWrap = document.createElement("div");
  const reasonLabel = document.createElement("p");
  const reason = document.createElement("p");
  const tags = document.createElement("div");
  const actions = document.createElement("div");
  const hasInternalTarget = Boolean(item.place_query || item.official_event_id);
  const status = item.timing?.status || "timeless";
  let title;

  article.className = `pulse-entry pulse-entry-${status}`;
  top.className = "pulse-entry-top";
  kind.className = "pulse-entry-kind";
  when.className = `pulse-entry-when pulse-entry-when-${status}`;
  where.className = "pulse-entry-where";
  blurb.className = "pulse-entry-blurb";
  matchNote.className = "pulse-entry-match";
  reasonWrap.className = "pulse-entry-reason";
  reasonLabel.className = "pulse-entry-reason-label";
  reason.className = "pulse-entry-reason-copy";
  tags.className = "pulse-entry-tags";
  actions.className = "pulse-entry-actions";

  kind.textContent = item.kind || "Stadspuls";
  when.textContent = item.timing?.label || item.when || "I dag";

  if (item.when && item.timing?.label && item.timing.label !== item.when) {
    when.title = item.when;
  }

  if (hasInternalTarget) {
    title = document.createElement("button");
    title.type = "button";
    title.className = "pulse-entry-title-button";
    title.textContent = item.title;
    title.addEventListener("click", () => {
      openCityPulseItem(item);
    });
  } else {
    title = document.createElement("h4");
    title.className = "pulse-entry-title";
    title.textContent = item.title;
  }

  where.textContent = item.where ? `◉ ${item.where}` : "◉ Rom";
  blurb.textContent = item.blurb || item.note || "";
  matchNote.textContent = getLiveMatchSummaryForPulseItem(item);
  matchNote.hidden = !matchNote.textContent;
  reasonLabel.textContent = "Varför det spelar roll";
  reason.textContent =
    item.why_it_matters ||
    "Det här är tänkt som en liten lokal signal som hjälper dagens rutt kännas mer självklar.";

  top.append(kind, when);
  reasonWrap.append(reasonLabel, reason);
  article.append(top, title, where, blurb);
  if (matchNote.textContent) {
    article.appendChild(matchNote);
  }
  article.appendChild(reasonWrap);

  (item.matches_vibes || []).slice(0, 4).forEach((vibe) => {
    const chip = document.createElement("span");
    chip.textContent = `passar • ${cityPulseVibeLabels[vibe] || vibe}`;
    tags.appendChild(chip);
  });

  if (tags.childNodes.length) {
    article.appendChild(tags);
  }

  if (hasInternalTarget) {
    const detailButton = document.createElement("button");
    detailButton.type = "button";
    detailButton.className = "ghost-button pulse-action-button";
    detailButton.textContent = item.official_event_id ? "Öppna live-info" : "Öppna plats";
    detailButton.addEventListener("click", () => {
      openCityPulseItem(item);
    });
    actions.appendChild(detailButton);
  }

  if (item.linked_wildcard_id && getWildcardById(item.linked_wildcard_id)) {
    const plannerButton = document.createElement("button");
    plannerButton.type = "button";
    plannerButton.className = "secondary-button pulse-action-button";
    plannerButton.textContent = "Bygg dag av detta";
    plannerButton.addEventListener("click", async () => {
      const wildcard = getWildcardById(item.linked_wildcard_id);

      if (!wildcard) {
        return;
      }

      await applyWildcardToPlanner(wildcard, {
        autoPlan: true,
        sourceLabel: item.title,
      });
    });
    actions.appendChild(plannerButton);
  }

  if (actions.childNodes.length) {
    article.appendChild(actions);
  }

  return article;
}

function renderCityPulse() {
  if (
    !cityPulseTeaser ||
    !cityPulseTeaserTitle ||
    !cityPulseTeaserSummary ||
    !cityPulseHeadline ||
    !cityPulseSubhead ||
    !cityPulseEditionDate ||
    !cityPulseMeta ||
    !cityPulseFilters ||
    !cityPulseLevels ||
    !cityPulseFooter
  ) {
    return;
  }

  if (!cityPulseState) {
    cityPulseState = buildFallbackCityPulse(ensureActiveLiveDate());
  }

  ensureActiveLiveDate();
  renderCityPulseTeaser();

  if (!shouldShowLiveEdition()) {
    if (cityPulseStart) {
      cityPulseStart.hidden = true;
    }
    return;
  }

  if (cityPulseStart) {
    cityPulseStart.hidden = false;
  }

  const items = getNormalizedCityPulseItems().map((item) =>
    enrichPulseItemTiming(item, cityPulseState.date, activePulseTime),
  );
  const allTimelineItems = [...items].sort(comparePulseItems);
  const timeScopedItems = items.filter((item) =>
    pulseItemMatchesTime(item, activePulseTime, cityPulseState.date),
  );
  const scopeItems = timeScopedItems.filter((item) =>
    pulseItemMatchesScope(item, activePulseScope),
  );
  const filteredItems = scopeItems.length ? scopeItems : activePulseScope === "nearby" ? [] : timeScopedItems;
  const activePlannedDay = getActivePlannedDay();
  const availableLevels = Object.keys(cityPulseLevelMeta).filter((level) =>
    filteredItems.some((item) => item.level === level),
  );

  if (activePulseLevel !== "all" && !availableLevels.includes(activePulseLevel)) {
    activePulseLevel = "all";
  }

  const weekdayLabel =
    cityPulseState.weekday_label ||
    getFallbackPulseDateLabels(cityPulseState.date || getTodayIsoDate()).weekdayLabel;
  const dateLabel =
    cityPulseState.date_label ||
    getFallbackPulseDateLabels(cityPulseState.date || getTodayIsoDate()).dateLabel;

  if (cityPulseEditionLabel) {
    cityPulseEditionLabel.textContent = `Just nu i Rom · ${weekdayLabel} ${dateLabel}`;
  }

  cityPulseHeadline.textContent =
    cityPulseState.headline || "Vad som faktiskt händer i Rom just nu.";
  cityPulseSubhead.textContent =
    cityPulseState.subhead ||
    cityPulseState.note ||
    "LIVE hjälper dig förstå vad som faktiskt är värt att bry sig om just nu.";
  cityPulseEditionDate.textContent = `${weekdayLabel}\n${dateLabel}`;
  cityPulseMeta.textContent = `${filteredItems.length} signaler • ${availableLevels.length} nivåer`;
  cityPulseFooter.textContent =
    cityPulseState.footer_note ||
    "Den här sektionen blandar säkra lokala rytmer med det som är värt att väga in just nu.";

  if (cityPulseWeatherValue) {
    cityPulseWeatherValue.textContent = buildPulseWeatherValue(
      cityPulseState.weather,
      cityPulseState.date,
    );
  }

  if (cityPulseWeatherBrief) {
    cityPulseWeatherBrief.textContent = buildPulseWeatherBrief(
      cityPulseState.weather,
      cityPulseState.date,
    );
  }

  if (cityPulseClothingValue) {
    cityPulseClothingValue.textContent = getPulseClothingHeadline(cityPulseState.weather);
  }

  if (cityPulseClothingAdvice) {
    cityPulseClothingAdvice.textContent = getPulseClothingAdvice(cityPulseState.weather)
      ? `Klädsel: ${getPulseClothingAdvice(cityPulseState.weather)}.`
      : "Parranda lägger till klädråd så snart vädret är laddat.";
  }

  if (cityPulseTimelineBrief) {
    const timelineItems = filteredItems.length
      ? [...filteredItems].sort(comparePulseItems)
      : activePulseScope === "nearby"
        ? []
        : [...timeScopedItems].sort(comparePulseItems);
    cityPulseTimelineBrief.textContent = buildPulseTimelineBrief(
      timelineItems,
      cityPulseState.date,
      activePulseTime,
    );
  }

  renderCityPulseDayChips();
  renderCityPulseTimeline(allTimelineItems, cityPulseState.date);

  if (cityPulseScopeFilters) {
    cityPulseScopeFilters.innerHTML = "";
    cityPulseScopeFilters.appendChild(
      createPulseModeButton({
        key: "all",
        label: cityPulseScopeMeta.all.label,
        active: activePulseScope === "all",
        onClick: () => {
          activePulseScope = "all";
          cityPulseScopeStatus = "";
          renderCityPulse();
        },
      }),
    );
    cityPulseScopeFilters.appendChild(
      createPulseModeButton({
        key: "nearby",
        label: cityPulseScopeMeta.nearby.label,
        active: activePulseScope === "nearby",
        onClick: async () => {
          try {
            await ensureCurrentLocation();
            activePulseScope = "nearby";
            cityPulseScopeStatus = "";
          } catch (_error) {
            activePulseScope = "all";
            cityPulseScopeStatus =
              "Platsåtkomst saknas just nu, så LIVE visar hela Rom i stället för nära dig.";
          }

          renderCityPulse();
        },
      }),
    );
  }

  if (cityPulseRadiusFilters) {
    cityPulseRadiusFilters.innerHTML = "";
    Object.entries(cityPulseRadiusMeta).forEach(([key, meta]) => {
      cityPulseRadiusFilters.appendChild(
        createPulseModeButton({
          key,
          label: meta.label,
          active: activePulseRadiusKey === key,
          onClick: async () => {
            activePulseRadiusKey = key;

            if (activePulseScope === "nearby") {
              try {
                await ensureCurrentLocation();
                cityPulseScopeStatus = "";
              } catch (_error) {
                activePulseScope = "all";
                cityPulseScopeStatus =
                  "Platsåtkomst saknas just nu, så LIVE visar hela Rom tills Nära mig kan användas.";
              }
            }

            renderCityPulse();
          },
        }),
      );
    });
  }

  if (cityPulseTimeFilters) {
    cityPulseTimeFilters.innerHTML = "";
    Object.entries(cityPulseTimeMeta).forEach(([key, meta]) => {
      cityPulseTimeFilters.appendChild(
        createPulseModeButton({
          key,
          label: meta.label,
          active: activePulseTime === key,
          onClick: () => {
            activePulseTime = key;
            renderCityPulse();
          },
        }),
      );
    });
  }

  if (cityPulseUtilityNote) {
    cityPulseUtilityNote.textContent = activePlannedDay
      ? `Editionen är kopplad till ${formatSwedishDate(activePlannedDay.date)}. LIVE hjälper dig nu läsa vad som passar med just den dagens huvudrutt och alternativ.`
      : buildPulseUtilityCopy(filteredItems, items);
  }

  cityPulseFilters.innerHTML = "";
  cityPulseFilters.appendChild(
    createPulseFilterButton("all", "Allt", filteredItems.length),
  );
  availableLevels.forEach((level) => {
    const count = filteredItems.filter((item) => item.level === level).length;
    cityPulseFilters.appendChild(
      createPulseFilterButton(level, cityPulseLevelMeta[level].label, count),
    );
  });

  cityPulseLevels.innerHTML = "";

  const visibleLevels =
    activePulseLevel === "all"
      ? Object.keys(cityPulseLevelMeta)
      : [activePulseLevel];

  visibleLevels.forEach((level) => {
    const groupItems = filteredItems
      .filter((item) => item.level === level)
      .sort(comparePulseItems);

    if (!groupItems.length) {
      return;
    }

    const section = document.createElement("section");
    const header = document.createElement("div");
    const mark = document.createElement("span");
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    const sub = document.createElement("p");
    const grid = document.createElement("div");

    section.className = "pulse-group";
    header.className = "pulse-group-header";
    mark.className = "pulse-group-mark";
    copy.className = "pulse-group-copy";
    title.className = "pulse-group-title";
    sub.className = "pulse-group-sub";
    grid.className = "pulse-group-grid";

    mark.textContent = cityPulseLevelMeta[level].mark;
    title.textContent = cityPulseLevelMeta[level].label;
    sub.textContent = cityPulseLevelMeta[level].sub;

    copy.append(title, sub);
    header.append(mark, copy);
    section.appendChild(header);

    groupItems.forEach((item) => {
      grid.appendChild(createPulseEntry(item));
    });

    section.appendChild(grid);
    cityPulseLevels.appendChild(section);
  });

  if (!cityPulseLevels.childNodes.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state pulse-empty-state";
    emptyState.innerHTML =
      activePulseScope === "nearby"
        ? "<h3>Inget starkt live-lager nära dig just nu</h3><p>Byt till Hela Rom eller ett bredare tidsläge för att se fler signaler.</p>"
        : "<h3>Inga starka signaler just nu</h3><p>Parranda lyckades inte hämta några tydliga dagensnotiser, men route buildern och wildcardet fungerar fortfarande.</p>";
    cityPulseLevels.appendChild(emptyState);
  }
}

async function loadCityPulse(dateString = getTodayIsoDate()) {
  const targetDate = dateString || getTodayIsoDate();

  activeLiveDate = targetDate;

  if (cityPulseCache.has(targetDate)) {
    cityPulseState = cityPulseCache.get(targetDate);
    renderHeroWildcard();
    renderCityPulse();
    return;
  }

  const fallbackPulse = buildFallbackCityPulse(targetDate);

  try {
    const response = await fetchJson(
      `${routeApiBase}/city-pulse?city=${encodeURIComponent(plannerCityKey)}&date=${encodeURIComponent(targetDate)}`,
    );
    cityPulseState = {
      ...fallbackPulse,
      ...response,
      date: response.date || targetDate,
      weekday_label: response.weekday_label || fallbackPulse.weekday_label,
      date_label: response.date_label || fallbackPulse.date_label,
      items:
        Array.isArray(response.items) && response.items.length
          ? response.items
          : fallbackPulse.items,
      moments: Array.isArray(response.moments) ? response.moments : [],
      official_events: Array.isArray(response.official_events) ? response.official_events : [],
      weather: response.weather || null,
      wildcards:
        Array.isArray(response.wildcards) && response.wildcards.length
          ? response.wildcards
          : buildFallbackWildcards(dateString),
    };
  } catch (_error) {
    cityPulseState = {
      ...fallbackPulse,
      weather: null,
    };
  }

  if (
    !activeHeroWildcardId ||
    !cityPulseState.wildcards.some((wildcard) => wildcard.id === activeHeroWildcardId)
  ) {
    activeHeroWildcardId = getCityPulseWildcardsByContext()[0]?.id || null;
  }

  cityPulseCache.set(targetDate, cityPulseState);
  renderHeroWildcard();
  renderCityPulse();
}

function createMapUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function loadFavorites() {
  try {
    const stored = window.localStorage.getItem(favoritesStorageKey);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    return [];
  }
}

function saveFavorites() {
  window.localStorage.setItem(favoritesStorageKey, JSON.stringify(favorites));
}

function loadSavedRoutes() {
  try {
    const stored = window.localStorage.getItem(savedRoutesStorageKey);
    return stored ? JSON.parse(stored) : [];
  } catch (_error) {
    return [];
  }
}

function saveSavedRoutes() {
  window.localStorage.setItem(savedRoutesStorageKey, JSON.stringify(savedRoutes));
}

function isFavorite(name) {
  return favorites.includes(name);
}

function toggleFavorite(name) {
  if (isFavorite(name)) {
    favorites = favorites.filter((item) => item !== name);
  } else {
    favorites = [...favorites, name];
  }

  saveFavorites();
  updateFavoritesUI();
  renderPlaces();
  updateMapPanel(getPlaceByName(selectedPlaceName));
}

function getPlaceByName(name) {
  return places.find((place) => place.name === name);
}

function matchesSearch(place, term) {
  const haystack = [
    place.name,
    place.category,
    place.area,
    place.description,
    place.bestFor,
    place.time,
    place.localNote,
    ...place.tags,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(term.toLowerCase());
}

function getVisiblePlaces() {
  const term = searchInput.value.trim();

  return places.filter((place) => {
    const matchesCategory =
      activeFilter === "all" ? true : place.category === activeFilter;
    const matchesTerm = term ? matchesSearch(place, term) : true;
    const matchesFavorites = onlyFavorites ? isFavorite(place.name) : true;

    return matchesCategory && matchesTerm && matchesFavorites;
  });
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getCategoryTone(category) {
  const normalized = normalizeText(category || "");

  if (normalized.includes("nattliv")) {
    return "nightlife";
  }

  if (normalized.includes("gomt")) {
    return "hidden";
  }

  if (normalized.includes("mat")) {
    return "food";
  }

  if (normalized.includes("utsikt")) {
    return "view";
  }

  if (normalized.includes("klassiker")) {
    return "classic";
  }

  if (normalized.includes("kvarter")) {
    return "district";
  }

  return "default";
}

function updateRouteMatchSummary(text) {
  if (routeMatchSummary) {
    routeMatchSummary.textContent = text;
  }
}

function getPointControlSet(pointKey) {
  if (pointKey === "home_base") {
    return {
      modeSelect: homeBaseModeSelect,
      presetSelect: homeBasePresetSelect,
      customInput: homeBaseCustomInput,
      hint: homeBaseModeHint,
      districtButtons: homeBaseDistrictButtons,
      districtSubButtons: homeBaseDistrictSubButtons,
      fieldPrefix: "home-base",
    };
  }

  if (pointKey === "end") {
    return {
      modeSelect: endModeSelect,
      presetSelect: endPresetSelect,
      customInput: endCustomInput,
      hint: endModeHint,
      districtButtons: endDistrictButtons,
      districtSubButtons: endDistrictSubButtons,
      fieldPrefix: "end",
    };
  }

  return {
    modeSelect: startModeSelect,
    presetSelect: startPresetSelect,
    customInput: startCustomInput,
    hint: startModeHint,
    districtButtons: startDistrictButtons,
    districtSubButtons: startDistrictSubButtons,
    fieldPrefix: "start",
  };
}

function getPlannerPointSummary(pointKey) {
  const controls = getPointControlSet(pointKey);
  const mode = controls.modeSelect?.value;

  if (mode === "preset") {
    return normalizePlannerSelectionLabel(controls.presetSelect?.value) || "Parranda väljer";
  }

  if (mode === "custom") {
    return controls.customInput?.value?.trim() || "egen adress";
  }

  if (mode === "current_location") {
    return "min plats";
  }

  return "Parranda väljer";
}

function updatePlannerModeButtons() {
  plannerModeButtons.forEach((button) => {
    const isActive = button.dataset.plannerMode === activePlannerMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

function setPlannerMode(mode = plannerAutoMode) {
  activePlannerMode = mode === plannerManualMode ? plannerManualMode : plannerAutoMode;
  updatePlannerModeButtons();

  if (plannerFineTuneDetails) {
    plannerFineTuneDetails.open = activePlannerMode === plannerManualMode;
  }

  if (activePlannerMode === plannerAutoMode) {
    activeBudgetTier = "standard";
    updateBudgetTierButtons();
    if (legPacingSelect) {
      legPacingSelect.value = "balanced";
    }
    updateLegPacingUI();
  }

  syncPlannerModeUI();
}

function updatePlannerAdvancedSummary() {
  if (!plannerAdvancedSummary) {
    return;
  }

  const pieces = [];

  if (activePlannerMode === plannerManualMode) {
    pieces.push(`Start: ${getPlannerPointSummary("start")}`);
    pieces.push(`Slut: ${getPlannerPointSummary("end")}`);
  } else {
    pieces.push("Auto-läge");
    pieces.push(`Boendebas: ${getPlannerPointSummary("home_base")}`);
  }

  if (activeBudgetTier && activeBudgetTier !== "standard" && budgetTierLabels[activeBudgetTier]) {
    pieces.push(budgetTierLabels[activeBudgetTier]);
  }

  if (legPacingSelect?.value && legPacingSelect.value !== "balanced") {
    pieces.push(legPacingLabels[legPacingSelect.value] || legPacingSelect.value);
  }

  plannerAdvancedSummary.textContent = pieces.join(" • ");

  if (plannerModeLead) {
    plannerModeLead.textContent =
      activePlannerMode === plannerManualMode
        ? "Du styr ankare själv. Lås bara det som verkligen behöver vara exakt och låt resten vara flexibelt."
        : "Börja med datum, vibe, gångmål och gärna var du bor. Resten sätter Parranda ihop.";
  }

  updatePlannerLaunchSummary();
}

function buildPlannerStyleSummary(prefix = "") {
  const leading = prefix ? [prefix.trim()] : [];
  const activeParts = [];
  const selectedPreferences = getSelectedPreferences();
  const strictFamilies = new Set(["kyrkor", "cocktail", "öl", "vin", "mat", "utsikt"]);
  const strictSupport = new Set(["hidden gems", "kultur", "kväll", "low-key", "party", "nattliv"]);
  const directSelections = selectedPreferences.filter((preference) => strictFamilies.has(preference));
  const onlySupportiveSelections =
    directSelections.length === 1 &&
    selectedPreferences.every(
      (preference) =>
        preference === directSelections[0] || strictSupport.has(preference),
    );

  if (activeOptimizerMode && optimizerModeLabels[activeOptimizerMode]) {
    activeParts.push(optimizerModeLabels[activeOptimizerMode]);
  }

  if (activeBudgetTier && activeBudgetTier !== "standard" && budgetTierLabels[activeBudgetTier]) {
    activeParts.push(budgetTierLabels[activeBudgetTier]);
  }

  if (activeRouteModifier && routeModifierLabels[activeRouteModifier]) {
    activeParts.push(routeModifierLabels[activeRouteModifier]);
  }

  if (legPacingSelect?.value && legPacingSelect.value !== "balanced") {
    activeParts.push(legPacingLabels[legPacingSelect.value] || legPacingSelect.value);
  }

  if (onlySupportiveSelections) {
    activeParts.push(`Tydligt tema: ${directSelections[0]}`);
  }

  if (activeParts.length) {
    leading.push(`Aktivt nu: ${activeParts.join(" • ")}.`);
  }

  return leading.join(" ");
}

function buildPlannerSnapshot(payload, dates) {
  return {
    plannerMode: activePlannerMode,
    dates,
    dateFrom: routeDateFrom.value || dates[0] || getTodayIsoDate(),
    dateTo: routeDateTo.value || dates[dates.length - 1] || routeDateFrom.value || getTodayIsoDate(),
    homeBase: payload.home_base,
    start: payload.start,
    end: payload.end,
    walkingKmTarget: Number(payload.walking_km_target || 9),
    preferences: [...(payload.preferences || [])],
    optimizerMode: payload.optimizer_mode || null,
    distanceMode: payload.distance_mode || "soft_target",
    legPacing: payload.leg_pacing || "balanced",
    budgetTier: payload.budget_tier || "standard",
    modifier: payload.modifier || null,
  };
}

function buildPlanningResultSummary(response) {
  const plannedCount = plannedDays.length;
  const usedAutoStart = activePlannerMode === plannerAutoMode || startModeSelect?.value === plannerAutoMode;
  const usedAutoEnd = activePlannerMode === plannerAutoMode || endModeSelect?.value === plannerAutoMode;
  const resolvedStart = response.resolved_start?.label || "en smart start";
  const resolvedEnd = response.resolved_end?.label || "en smart final";
  const resolvedHomeBase = response.resolved_home_base?.label || null;

  if (activePlannerMode === plannerAutoMode) {
    if (resolvedHomeBase) {
      return `${plannedCount} dag(ar) klara med ${resolvedHomeBase} som mjuk boendebas. Dag 1 öppnas först, resten ligger direkt bredvid.`;
    }

    return `${plannedCount} dag(ar) klara. Parranda valde själv en smart bas, start och final och visar Dag 1 först.`;
  }

  if (usedAutoStart && usedAutoEnd) {
    return `${plannedCount} dag(ar) klara. Parranda valde själv en smart start och final och visar huvudrutten först.`;
  }

  if (!usedAutoStart && usedAutoEnd) {
    return `${plannedCount} dag(ar) klara från ${resolvedStart}. Parranda valde finalen och visar huvudrutten först.`;
  }

  if (usedAutoStart && !usedAutoEnd) {
    return `${plannedCount} dag(ar) klara med ${resolvedEnd} som mål. Parranda valde en smart start och visar huvudrutten först.`;
  }

  return `${plannedCount} dag(ar) klara mellan ${resolvedStart} och ${resolvedEnd}. Huvudrutten visas först, alternativ efteråt.`;
}

function focusPlannerResults() {
  const target = routeResults || document.querySelector(".route-results");

  if (!target) {
    return;
  }

  window.requestAnimationFrame(() => {
    target.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

function updatePlannerLaunchSummary(prefix = "") {
  if (!plannerLaunchSummary) {
    return;
  }

  const dates = expandDateRange(routeDateFrom?.value, routeDateTo?.value);
  const baseSummary = getPlannerPointSummary("home_base");
  const startSummary = getPlannerPointSummary("start");
  const endSummary = getPlannerPointSummary("end");
  const kmLabel =
    activeDistanceMode === "no_limit" ? "gången får vara friare" : `${walkingKmTarget?.value || 9} km som mjukt mål`;
  const dateLabel =
    dates.length > 1
      ? `${formatCompactSwedishDate(dates[0])} → ${formatCompactSwedishDate(dates[dates.length - 1])}`
      : formatCompactSwedishDate(dates[0] || getTodayIsoDate());
  const anchorLabel =
    activePlannerMode === plannerManualMode
      ? startSummary === "Parranda väljer" && endSummary === "Parranda väljer"
        ? "Manuell styrning är vald, men Parranda får fortfarande välja ankare själv"
        : `Exakta ankare: start ${startSummary} • slut ${endSummary}`
      : baseSummary === "Parranda väljer"
        ? "Auto-läge där Parranda väljer boendebas, start och final själv"
        : `Auto-läge med ${baseSummary} som boendebas`;
  const summary =
    prefix ||
    `${dateLabel} • ${kmLabel}. ${anchorLabel}.`;

  plannerLaunchSummary.textContent = summary;
}

function openPlannerModal() {
  switchTab("routes");

  if (routePlannerStart) {
    routePlannerStart.hidden = false;
    routePlannerStart.scrollTop = 0;
  }

  if (plannerModalBackdrop) {
    plannerModalBackdrop.hidden = false;
  }

  document.body.classList.add("is-planner-open");

  window.setTimeout(() => {
    routeDateFrom?.focus();
  }, 40);
}

function closePlannerModal() {
  if (routePlannerStart) {
    routePlannerStart.hidden = true;
  }

  if (plannerModalBackdrop) {
    plannerModalBackdrop.hidden = true;
  }

  document.body.classList.remove("is-planner-open");
}

function getLiveEditionDates() {
  if (plannedDays.length) {
    return plannedDays.map((day) => day.date);
  }

  return expandDateRange(routeDateFrom?.value, routeDateTo?.value);
}

function getActivePlannedDay() {
  return plannedDays.find((day) => day.date === activeLiveDate) || plannedDays[0] || null;
}

function ensureActiveLiveDate() {
  const availableDates = getLiveEditionDates();

  if (!availableDates.length) {
    activeLiveDate = getTodayIsoDate();
    return activeLiveDate;
  }

  if (!availableDates.includes(activeLiveDate)) {
    activeLiveDate = availableDates[0];
  }

  return activeLiveDate;
}

function shouldShowLiveEdition() {
  return liveEditionExpanded || plannedDays.length > 0;
}

function createGoogleInfoUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${query} Rome`)}`;
}

function getPlannerModeHint(pointKey, mode) {
  const isStart = pointKey === "start";
  const isHomeBase = pointKey === "home_base";

  if (mode === plannerAutoMode) {
    if (isHomeBase) {
      return "Lämna öppet om du vill att Parranda ska hitta en naturlig boendebas själv.";
    }

    return isStart
      ? "Lämna öppet om du vill att Parranda ska hitta en naturlig öppning själv."
      : "Lämna öppet om du vill att Parranda ska hitta en naturlig final själv.";
  }

  if (mode === "current_location") {
    if (isHomeBase) {
      return "Bra när du vill att dagens logik ska utgå från där du faktiskt bor eller står.";
    }

    return isStart
      ? "Starta nära där du står just nu."
      : "Låt dagen landa nära där du faktiskt är.";
  }

  if (mode === "custom") {
    if (isHomeBase) {
      return "Skriv hotell, adress eller stadsdel så använder Parranda det som mjuk bas.";
    }

    return isStart
      ? "Skriv hotell, station, torg eller annan exakt adress i Rom."
      : "Skriv platsen där du vill landa.";
  }

  if (isHomeBase) {
    return "Välj ett kvarter om du vill att Parranda ska väga in var du bor utan att låsa dagsstarten exakt.";
  }

  return isStart
    ? "Välj ett kvarter om du vill styra öppningen tydligare."
    : "Välj ett kvarter om du vill styra finalen tydligare.";
}

function getPlannerDistrictGroups() {
  return plannerDistrictCatalog.map((item) => ({
    ...item,
    children: Array.isArray(item.children)
      ? item.children.map((child) => ({ ...child }))
      : [],
  }));
}

function getPlannerExactDistrictOptions() {
  return getPlannerDistrictGroups().flatMap((item) =>
    item.children.length ? item.children : [{ ...item }],
  );
}

function getPlannerGroupForLabel(label) {
  const normalized = normalizeText(label || "");

  if (!normalized) {
    return null;
  }

  return getPlannerDistrictGroups().find(
    (item) =>
      normalizeText(item.label) === normalized ||
      item.children.some((child) => normalizeText(child.label) === normalized),
  );
}

function normalizePlannerSelectionLabel(label) {
  const normalized = normalizeText(label || "");

  if (!normalized) {
    return "";
  }

  const exact = getPlannerExactDistrictOptions().find(
    (item) => normalizeText(item.label) === normalized,
  );

  if (exact) {
    return exact.label;
  }

  const parentGroup = getPlannerDistrictGroups().find(
    (item) => normalizeText(item.label) === normalized,
  );

  if (!parentGroup) {
    return "";
  }

  return parentGroup.children[0]?.label || parentGroup.label;
}

function createRouteDirectionsUrl(points) {
  if (!Array.isArray(points) || !points.length) {
    return createMapUrl("Rome city center");
  }

  if (points.length === 1) {
    return createMapUrl(points[0].label ? `${points[0].label} Rome` : "Rome city center");
  }

  const origin = `${points[0].lat},${points[0].lng}`;
  const destination = `${points[points.length - 1].lat},${points[points.length - 1].lng}`;
  const waypoints = points
    .slice(1, -1)
    .map((point) => `${point.lat},${point.lng}`)
    .join("|");
  const url = new URL("https://www.google.com/maps/dir/");

  url.searchParams.set("api", "1");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("travelmode", "walking");
  if (waypoints) {
    url.searchParams.set("waypoints", waypoints);
  }

  return url.toString();
}

function getTodayIsoDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 10);
}

function formatSwedishDate(dateString) {
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${dateString}T12:00:00`));
}

function formatCompactSwedishDate(dateString) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${dateString}T12:00:00`));
}

function formatSavedTimestamp(dateString) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));
}

function formatLiveEventRange(startDate, endDate) {
  if (!startDate && !endDate) {
    return "";
  }

  if (startDate && endDate && startDate !== endDate) {
    return `${formatCompactSwedishDate(startDate)} - ${formatCompactSwedishDate(endDate)}`;
  }

  return formatCompactSwedishDate(startDate || endDate);
}

function createLocalPlannerOptions() {
  return getPlannerExactDistrictOptions().map((item) => ({ ...item }));
}

function setRouteApiStatus(isAvailable) {
  routeApiAvailable = isAvailable;

  if (!routePlannerModeChip) {
    return;
  }

  if (isAvailable) {
    routePlannerModeChip.textContent = "Live route engine aktiv";
    routeFallbackNote.hidden = true;
    return;
  }

  routePlannerModeChip.textContent = "Fallback-läge aktivt";
  routeFallbackNote.hidden = false;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
}

function populatePresetSelects() {
  const selects = [homeBasePresetSelect, startPresetSelect, endPresetSelect];
  selects.forEach((select) => {
    if (!select) {
      return;
    }

    select.innerHTML = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "Låt Parranda välja";
    select.appendChild(emptyOption);

    plannerOptions.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.label;
      option.textContent = getPlannerOptionLabel(item);
      select.appendChild(option);
    });
  });

  homeBasePresetSelect.value = "";
  startPresetSelect.value = "";
  endPresetSelect.value = "";
  renderPlannerDistrictButtons();
  updatePlannerAdvancedSummary();
}

function getPlannerOptionLabel(item) {
  if (!item) {
    return "";
  }

  const label = item.label || "Rom";
  const area = item.area || "";
  const type = item.type || "";

  if (area && normalizeText(area) === normalizeText(label)) {
    return `${label} · stadsdel`;
  }

  if (area) {
    return `${label} · ${area}`;
  }

  if (type && normalizeText(type) !== normalizeText(label)) {
    return `${label} · ${type}`;
  }

  return label;
}

function hasPlannerOption(label) {
  return plannerOptions.some((item) => item.label === normalizePlannerSelectionLabel(label));
}

function setPresetSelectValue(select, label) {
  if (!select) {
    return;
  }

  const normalizedLabel = normalizePlannerSelectionLabel(label);
  select.value = hasPlannerOption(normalizedLabel) ? normalizedLabel : "";
  syncDistrictButtonStates();
  updatePlannerAdvancedSummary();
}

function setPlannerFieldFromLabel(pointKey, label) {
  const controls = getPointControlSet(pointKey);
  const modeSelect = controls.modeSelect;
  const presetSelect = controls.presetSelect;
  const customInput = controls.customInput;
  const normalizedLabel = normalizePlannerSelectionLabel(label);

  if (pointKey === "home_base") {
    activePlannerMode = plannerAutoMode;
    updatePlannerModeButtons();
  } else {
    activePlannerMode = plannerManualMode;
    updatePlannerModeButtons();
    if (plannerFineTuneDetails) {
      plannerFineTuneDetails.open = true;
    }
  }

  if (normalizedLabel && hasPlannerOption(normalizedLabel)) {
    modeSelect.value = "preset";
    syncPlannerModeUI();
    setPresetSelectValue(presetSelect, normalizedLabel);
    customInput.value = "";
    return;
  }

  modeSelect.value = "custom";
  syncPlannerModeUI();
  customInput.value = label || "";
  updatePlannerAdvancedSummary();
}

function renderPlannerDistrictButtons() {
  [
    {
      container: homeBaseDistrictButtons,
      subContainer: homeBaseDistrictSubButtons,
      select: homeBasePresetSelect,
    },
    {
      container: startDistrictButtons,
      subContainer: startDistrictSubButtons,
      select: startPresetSelect,
    },
    {
      container: endDistrictButtons,
      subContainer: endDistrictSubButtons,
      select: endPresetSelect,
    },
  ].forEach(({ container, subContainer, select }) => {
    if (!container || !subContainer || !select) {
      return;
    }

    container.innerHTML = "";

    getPlannerDistrictGroups().forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "planner-district-button";
      button.dataset.plannerLabel = item.label;
      button.textContent = item.label;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.addEventListener("click", () => {
        const activeValue = normalizePlannerSelectionLabel(select.value);
        const nextLabel =
          item.children.length > 0
            ? item.children.some((child) => child.label === activeValue)
              ? activeValue
              : item.children[0].label
            : item.label;
        setPresetSelectValue(select, nextLabel);
      });
      container.appendChild(button);
    });

    subContainer.innerHTML = "";
    subContainer.hidden = true;
  });

  syncDistrictButtonStates();
}

function syncDistrictButtonStates() {
  [
    {
      container: homeBaseDistrictButtons,
      subContainer: homeBaseDistrictSubButtons,
      select: homeBasePresetSelect,
    },
    {
      container: startDistrictButtons,
      subContainer: startDistrictSubButtons,
      select: startPresetSelect,
    },
    {
      container: endDistrictButtons,
      subContainer: endDistrictSubButtons,
      select: endPresetSelect,
    },
  ].forEach(({ container, subContainer, select }) => {
    const value = normalizePlannerSelectionLabel(select?.value);
    const activeGroup = getPlannerGroupForLabel(value);

    container?.querySelectorAll(".planner-district-button").forEach((button) => {
      const isActive = button.dataset.plannerLabel === activeGroup?.label;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    if (!subContainer) {
      return;
    }

    const children = activeGroup?.children || [];

    if (!children.length || !value) {
      subContainer.hidden = true;
      subContainer.innerHTML = "";
      return;
    }

    subContainer.hidden = false;
    subContainer.innerHTML = "";

    children.forEach((child) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "planner-district-button planner-district-button-sub";
      button.dataset.plannerLabel = child.label;
      button.textContent = child.label;
      const isActive = child.label === value;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.addEventListener("click", () => {
        setPresetSelectValue(select, child.label);
      });
      subContainer.appendChild(button);
    });
  });
}

function updatePointModeUI(pointKey, mode) {
  const controls = getPointControlSet(pointKey);
  const presetField = document.querySelector(`[data-mode-field="${controls.fieldPrefix}-preset"]`);
  const customField = document.querySelector(`[data-mode-field="${controls.fieldPrefix}-custom"]`);
  const actionRow =
    pointKey === "home_base"
      ? homeBaseActionRow
      : pointKey === "start"
        ? startActionRow
        : endActionRow;

  if (presetField) {
    presetField.hidden = mode !== "preset";
  }

  if (customField) {
    customField.hidden = mode !== "custom";
  }

  if (actionRow) {
    actionRow.hidden = true;
  }
}

function syncPlannerModeUI() {
  updatePointModeUI("home_base", homeBaseModeSelect?.value || plannerAutoMode);
  updatePointModeUI("start", startModeSelect?.value || plannerAutoMode);
  updatePointModeUI("end", endModeSelect?.value || plannerAutoMode);

  if (homeBaseModeHint) {
    homeBaseModeHint.textContent = getPlannerModeHint("home_base", homeBaseModeSelect?.value);
  }
  if (startModeHint) {
    startModeHint.textContent = getPlannerModeHint("start", startModeSelect?.value);
  }
  if (endModeHint) {
    endModeHint.textContent = getPlannerModeHint("end", endModeSelect?.value);
  }

  if (plannerHomeBaseShell) {
    plannerHomeBaseShell.hidden = activePlannerMode !== plannerAutoMode;
  }

  if (plannerFineTuneDetails) {
    plannerFineTuneDetails.hidden = activePlannerMode !== plannerManualMode;
  }

  if (plannerManualShell) {
    plannerManualShell.hidden = activePlannerMode !== plannerManualMode;
  }

  syncDistrictButtonStates();
  updatePlannerAdvancedSummary();
}

function updateWalkingKmLabel() {
  if (activeDistanceMode === "no_limit") {
    walkingKmValue.textContent = "Spelar ingen roll";
    updatePlannerLaunchSummary();
    return;
  }

  walkingKmValue.textContent = `${walkingKmTarget.value} km`;
  updatePlannerLaunchSummary();
}

function updateDistanceModeUI() {
  activeDistanceMode = distanceModeSelect.value;
  walkingKmTarget.disabled = activeDistanceMode === "no_limit";
  updateWalkingKmLabel();
}

function updateLegPacingUI() {
  if (legPacingHint) {
    legPacingHint.textContent = legPacingHints[legPacingSelect?.value] || legPacingHints.balanced;
  }
  updatePlannerLaunchSummary();
}

function setPlannerStatusMessage(text = "", tone = "info") {
  if (!plannerStatusMessage) {
    return;
  }

  plannerStatusMessage.hidden = !text;
  plannerStatusMessage.textContent = text;
  plannerStatusMessage.dataset.tone = tone;
}

function setPlannerLoadingState(isLoading, message = plannerLoadingMessages[0]) {
  const buttons = [routePlanButton, routePlanStickyButton].filter(Boolean);
  const label = isLoading ? "Planerar din resa..." : "Planera min resa";

  buttons.forEach((button) => {
    button.disabled = isLoading;
    button.classList.toggle("is-loading", isLoading);
    button.textContent = label;
  });

  if (routeResetButton) {
    routeResetButton.disabled = isLoading;
  }

  if (isLoading) {
    setPlannerStatusMessage(message, "loading");
    return;
  }

  if (plannerLoadingTimer) {
    clearInterval(plannerLoadingTimer);
    plannerLoadingTimer = null;
  }
}

function startPlannerLoadingCycle() {
  let messageIndex = 0;

  if (plannerLoadingTimer) {
    clearInterval(plannerLoadingTimer);
    plannerLoadingTimer = null;
  }

  setPlannerLoadingState(true, plannerLoadingMessages[0]);
  plannerLoadingTimer = window.setInterval(() => {
    messageIndex = (messageIndex + 1) % plannerLoadingMessages.length;
    setPlannerStatusMessage(plannerLoadingMessages[messageIndex], "loading");
  }, 1300);
}

function updateOptimizerButtons() {
  optimizerButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.optimizerMode === activeOptimizerMode);
  });
}

function updateBudgetTierButtons() {
  budgetTierButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.budgetTier === activeBudgetTier);
  });
}

function updateRouteModifierButtons() {
  routeModifierButtons.forEach((button) => {
    const modifier = button.dataset.routeModifier;
    const isActive = modifier === "none" ? !activeRouteModifier : modifier === activeRouteModifier;
    button.classList.toggle("is-active", isActive);
  });
}

function applyOptimizerMode(mode) {
  const config = optimizerModes[mode];

  if (!config) {
    activeOptimizerMode = null;
    updateOptimizerButtons();
    return;
  }

  activeOptimizerMode = mode;
  preferenceInputs.forEach((input) => {
    input.checked = config.preferences.includes(input.value);
  });
  walkingKmTarget.value = String(config.km);
  distanceModeSelect.value = config.distanceMode;
  updateDistanceModeUI();
  updateWalkingKmLabel();
  updateOptimizerButtons();
  updateRouteMatchSummary(
    buildPlannerStyleSummary(`${optimizerModeLabels[mode] || "Optimizer-läget"} är aktivt.`),
  );
  updatePlannerLaunchSummary(`${optimizerModeLabels[mode] || "Specialläge"} • ${walkingKmTarget.value} km.`);
}

function applyBudgetTier(tier) {
  activeBudgetTier = budgetTierCopy[tier] ? tier : "standard";
  updateBudgetTierButtons();
  updatePlannerAdvancedSummary();
  updateRouteMatchSummary(buildPlannerStyleSummary());
}

function applyRouteModifier(modifier) {
  activeRouteModifier = modifier && modifier !== "none" ? modifier : null;
  updateRouteModifierButtons();
  updatePlannerAdvancedSummary();
  updateRouteMatchSummary(buildPlannerStyleSummary());
}

function setPlannerDefaults() {
  const today = getTodayIsoDate();

  activePlannerMode = plannerAutoMode;
  updatePlannerModeButtons();
  homeBaseModeSelect.value = plannerAutoMode;
  startModeSelect.value = plannerAutoMode;
  endModeSelect.value = plannerAutoMode;
  if (homeBasePresetSelect.options.length) {
    setPresetSelectValue(homeBasePresetSelect, "");
    setPresetSelectValue(startPresetSelect, "");
    setPresetSelectValue(endPresetSelect, "");
  }

  homeBaseCustomInput.value = "";
  startCustomInput.value = "";
  endCustomInput.value = "";
  routeDateFrom.value = today;
  routeDateTo.value = today;
  distanceModeSelect.value = "soft_target";
  updateDistanceModeUI();
  walkingKmTarget.value = "9";
  updateWalkingKmLabel();
  if (legPacingSelect) {
    legPacingSelect.value = "balanced";
  }
  updateLegPacingUI();
  syncPlannerModeUI();
  activeOptimizerMode = null;
  activeBudgetTier = "standard";
  activeRouteModifier = null;
  updateOptimizerButtons();
  updateBudgetTierButtons();
  updateRouteModifierButtons();

  preferenceInputs.forEach((input) => {
    input.checked = ["öl", "vin", "mat", "kultur", "hidden gems", "nattliv"].includes(
      input.value,
    );
  });

  if (plannerFineTuneDetails) {
    plannerFineTuneDetails.open = false;
  }

  updatePlannerAdvancedSummary();
  updatePlannerLaunchSummary();
}

function applyPlannerPointToForm(pointKey, point) {
  const controls = getPointControlSet(pointKey);
  const modeSelect = controls.modeSelect;
  const presetSelect = controls.presetSelect;
  const customInput = controls.customInput;
  const type = point?.type || plannerAutoMode;

  modeSelect.value = type;

  if (type === "preset") {
    setPresetSelectValue(presetSelect, point?.label || "");
    customInput.value = "";
  } else if (type === "custom") {
    customInput.value = point?.query || point?.label || "";
    setPresetSelectValue(presetSelect, "");
  } else if (type === "current_location" && typeof point?.lat === "number" && typeof point?.lng === "number") {
    currentLocationCoords = {
      lat: point.lat,
      lng: point.lng,
    };
    setPresetSelectValue(presetSelect, "");
    customInput.value = "";
  } else {
    setPresetSelectValue(presetSelect, "");
    customInput.value = "";
  }
}

function applyPlannerSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  activePlannerMode = snapshot.plannerMode || plannerAutoMode;
  updatePlannerModeButtons();
  applyPlannerPointToForm("home_base", snapshot.homeBase);
  applyPlannerPointToForm("start", snapshot.start);
  applyPlannerPointToForm("end", snapshot.end);
  routeDateFrom.value = snapshot.dateFrom || snapshot.dates?.[0] || getTodayIsoDate();
  routeDateTo.value =
    snapshot.dateTo || snapshot.dates?.[snapshot.dates.length - 1] || routeDateFrom.value;
  distanceModeSelect.value = snapshot.distanceMode || "soft_target";
  walkingKmTarget.value = String(snapshot.walkingKmTarget || 9);
  if (legPacingSelect) {
    legPacingSelect.value = snapshot.legPacing || "balanced";
  }
  activeOptimizerMode = snapshot.optimizerMode || null;
  activeBudgetTier = snapshot.budgetTier || "standard";
  activeRouteModifier = snapshot.modifier || null;
  preferenceInputs.forEach((input) => {
    input.checked = (snapshot.preferences || []).includes(input.value);
  });
  syncPlannerModeUI();
  updateDistanceModeUI();
  updateWalkingKmLabel();
  updateLegPacingUI();
  updateOptimizerButtons();
  updateBudgetTierButtons();
  updateRouteModifierButtons();
  if (plannerFineTuneDetails) {
    plannerFineTuneDetails.open = activePlannerMode === plannerManualMode;
  }
  updatePlannerAdvancedSummary();
  updatePlannerLaunchSummary();
}

function expandDateRange(from, to) {
  const start = from || getTodayIsoDate();
  const end = !to || to < start ? start : to;
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const dates = [];

  for (
    let cursor = new Date(startDate);
    cursor <= endDate && dates.length < 5;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    dates.push(cursor.toISOString().slice(0, 10));
  }

  return dates;
}

function getSelectedPreferences() {
  const selected = [...preferenceInputs]
    .filter((input) => input.checked)
    .map((input) => input.value);

  return selected.length ? selected : ["vin", "mat", "kultur", "hidden gems"];
}

function buildSavedRouteId(savePayload) {
  const normalizedPreferences = [...(savePayload.snapshot?.preferences || [])]
    .sort((left, right) => left.localeCompare(right, "sv"))
    .join("-");

  return [
    savePayload.date || "nodate",
    savePayload.routeId || "noroute",
    savePayload.snapshot?.budgetTier || "standard",
    savePayload.snapshot?.modifier || "no-modifier",
    normalizeText(normalizedPreferences || "default"),
  ].join(":");
}

function serializeRouteView(routeView) {
  return {
    id: routeView.id,
    title: routeView.title,
    vibe: routeView.vibe,
    length: routeView.length,
    summary: routeView.summary,
    why: routeView.why,
    visibleWhy: routeView.visibleWhy || null,
    path: routeView.path,
    anchor: routeView.anchor,
    walk: routeView.walk,
    startAnchorLabel: routeView.startAnchorLabel || null,
    endAnchorLabel: routeView.endAnchorLabel || null,
    routeShapeLabel: routeView.routeShapeLabel || null,
    legSummary: routeView.legSummary || null,
    stops: [...(routeView.stops || [])],
    stopItems: [...(routeView.stopItems || [])],
    hiddenMentions: [...(routeView.hiddenMentions || [])],
    barMentions: [...(routeView.barMentions || [])],
    routeLink: routeView.routeLink,
    mapRoutePoints: [...(routeView.mapRoutePoints || [])],
    weatherNote: routeView.weatherNote || null,
    pulseNote: routeView.pulseNote || null,
    liveEventFitNote: routeView.liveEventFitNote || null,
    venueSpecials: [...(routeView.venueSpecials || [])],
    budgetNote: routeView.budgetNote || null,
    openingWarnings: [...(routeView.openingWarnings || [])],
    liveEvents: [...(routeView.liveEvents || [])],
    dateLabel: routeView.dateLabel || null,
    routeShape: routeView.routeShape || null,
    dayProfile: routeView.dayProfile || null,
    dayProfileLabel: routeView.dayProfileLabel || null,
    legs: [...(routeView.legs || [])],
    longestLegKm: routeView.longestLegKm || null,
    longestLegMinutes: routeView.longestLegMinutes || null,
    averageLegMinutes: routeView.averageLegMinutes || null,
    legFitNote: routeView.legFitNote || null,
    geoFitNote: routeView.geoFitNote || null,
    anchorZone: routeView.anchorZone || null,
    routingSourceLabel: routeView.routingSourceLabel || null,
    pacingLabel: routeView.pacingLabel || null,
    anchorExplanation: routeView.anchorExplanation || null,
    engineBadges: [...(routeView.engineBadges || [])],
    guideStops: [...(routeView.guideStops || [])],
  };
}

function enrichSavePayload(basePayload, routeView) {
  return {
    ...basePayload,
    routePreview: serializeRouteView(routeView),
  };
}

function savePlannedRoute(savePayload) {
  const savedRoute = {
    ...savePayload,
    id: buildSavedRouteId(savePayload),
    savedAt: new Date().toISOString(),
  };

  savedRoutes = [
    savedRoute,
    ...savedRoutes.filter((item) => item.id !== savedRoute.id),
  ].slice(0, 12);
  saveSavedRoutes();
  renderSavedRoutes();
}

function removeSavedRoute(savedRouteId) {
  savedRoutes = savedRoutes.filter((item) => item.id !== savedRouteId);
  saveSavedRoutes();
  renderSavedRoutes();
}

function remixSnapshot(snapshot, remixMode) {
  const remixed = {
    ...snapshot,
    preferences: [...new Set(snapshot.preferences || [])],
    optimizerMode: snapshot.optimizerMode || null,
    walkingKmTarget: Number(snapshot.walkingKmTarget || 9),
    distanceMode: snapshot.distanceMode || "soft_target",
    budgetTier: snapshot.budgetTier || "standard",
    modifier: snapshot.modifier || null,
  };

  if (remixMode === "more-wine") {
    remixed.preferences = [...new Set([...remixed.preferences, "vin", "mat"])];
    remixed.optimizerMode = "wine-crawl";
    remixed.modifier = remixed.modifier || "low_key";
  }

  if (remixMode === "shorter-walk") {
    remixed.walkingKmTarget = Math.max(4, remixed.walkingKmTarget - 2);
    remixed.distanceMode = "soft_target";
  }

  if (remixMode === "hidden-gems") {
    remixed.preferences = [...new Set([...remixed.preferences, "hidden gems"])];
    remixed.modifier = remixed.modifier || "low_key";
  }

  if (remixMode === "more-evening") {
    remixed.preferences = [...new Set([...remixed.preferences, "nattliv", "vin", "öl", "kväll"])];
    remixed.modifier = "evening";
  }

  if (remixMode === "more-culture") {
    remixed.preferences = [...new Set([...remixed.preferences, "kultur", "kyrkor", "hidden gems"])];
    remixed.modifier = "culture";
    remixed.optimizerMode =
      remixed.optimizerMode === "wine-crawl" ? "wine-crawl" : "church-crawl";
  }

  if (remixMode === "low-key") {
    remixed.preferences = [...new Set([...remixed.preferences, "low-key", "vin", "hidden gems"])];
    remixed.modifier = "low_key";
  }

  if (remixMode === "more-party") {
    remixed.preferences = [...new Set([...remixed.preferences, "party", "nattliv", "cocktail", "kväll"])];
    remixed.modifier = "party";
    remixed.optimizerMode = "cocktail-night";
  }

  if (remixMode === "budget") {
    remixed.preferences = [...new Set([...remixed.preferences, "mat", "öl"])];
    remixed.budgetTier = "budget";
    remixed.walkingKmTarget = Math.min(remixed.walkingKmTarget, 8);
    remixed.distanceMode = "soft_target";
  }

  return remixed;
}

function saveCurrentPrimaryRouteVariant(savedRoute, remixMode) {
  const remixMeta = remixModeCopy[remixMode];

  if (!remixMeta || !plannedDays.length || !latestPlannerSnapshot) {
    return null;
  }

  const day = plannedDays[0];
  const savePayload = {
    date: day.date,
    routeId: day.primary_route.id,
    routeLabel: `Variant • ${remixMeta.variantLabel}`,
    title: `${day.primary_route.title} • ${remixMeta.variantLabel}`,
    summary: day.primary_route.why_recommended || day.primary_route.summary,
    snapshot: latestPlannerSnapshot,
    variantLabel: remixMeta.variantLabel,
    parentSavedRouteId: savedRoute.id,
    parentTitle: savedRoute.title,
  };
  const routeView = createApiRouteView(
    day.primary_route,
    "Huvudrutt",
    (day.live_events || []).filter((event) => event.best_route_id === day.primary_route.id),
    savePayload,
    day.date,
  );

  savePlannedRoute(enrichSavePayload(savePayload, routeView));
  return savePayload;
}

async function runSavedRouteRemix(savedRoute, remixMode = null, options = {}) {
  const { saveAsVariant = false } = options;
  const snapshot = remixMode ? remixSnapshot(savedRoute.snapshot, remixMode) : savedRoute.snapshot;
  applyPlannerSnapshot(snapshot);
  switchTab("routes");
  document
    .querySelector(".route-builder")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });

  updateRouteMatchSummary(
    remixModeCopy[remixMode]?.summary || `"${savedRoute.title}" laddas om som ny utgångspunkt.`,
  );

  try {
    await planRoutes();
    if (saveAsVariant && remixMode) {
      const savedVariant = saveCurrentPrimaryRouteVariant(savedRoute, remixMode);

      if (savedVariant) {
        savedRoutesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
        updateRouteMatchSummary(
          `"${savedVariant.title}" är nu sparad som ny variant av "${savedRoute.title}". Du kan fortsätta bygga ett eget bibliotek av versioner härifrån.`,
        );
        return;
      }
    }
    routeResults?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (_error) {
    routeRenderMode = "fallback";
    plannedDays = [];
    activePlannedDate = null;
    expandedAlternativeDates.clear();
    renderRouteResults();
    updateRouteMatchSummary(
      "Remixen gick inte att köra i live-läget just nu, så Parranda föll tillbaka till sina kuraterade rutter.",
    );
  }
}

function createSavedRouteCard(savedRoute) {
  const card = document.createElement("article");
  const meta = document.createElement("div");
  const title = document.createElement("h3");
  const context = document.createElement("p");
  const summary = document.createElement("p");
  const preferences = document.createElement("div");
  const actions = document.createElement("div");
  const remixLabel = document.createElement("p");
  const remix = document.createElement("div");

  card.className = "saved-route-card";
  meta.className = "saved-route-meta";
  context.className = "saved-route-context";
  preferences.className = "saved-route-preferences";
  actions.className = "saved-route-actions";
  remixLabel.className = "saved-route-remix-label";
  remix.className = "saved-route-remix";

  const budgetTierLabel = {
    budget: "Budgetvänlig bas",
    standard: null,
    "dolce-vita": "La Dolce Vita",
  };
  const modifierLabel = {
    evening: "Mer kväll",
    culture: "Mer kultur",
    low_key: "Mer low-key",
    party: "Mer party",
  };
  const optimizerLabel = {
    "bar-hop": "Bar hopping",
    "pizza-freak": "Pizza freak",
    "wine-crawl": "Wine crawl",
    "cocktail-night": "Cocktail night",
    "church-crawl": "Church crawl",
    "sunset-spots": "Sunset spots",
  };
  const preview = savedRoute.routePreview || null;
  const snapshot = savedRoute.snapshot || {};
  const startLabel = snapshot.start?.label || preview?.mapRoutePoints?.[0]?.label || null;
  const endLabel =
    snapshot.end?.label ||
    preview?.mapRoutePoints?.[preview?.mapRoutePoints.length - 1]?.label ||
    null;

  title.textContent = savedRoute.title;
  summary.textContent =
    savedRoute.summary || preview?.summary || "Sparad dagsbas för nya versioner i Parranda.";
  context.textContent =
    [startLabel, endLabel].filter(Boolean).join(" -> ") || "Sparad dagsbas för nya versioner.";
  remixLabel.textContent = "Skapa och spara ny variant";

  [
    savedRoute.date ? formatSwedishDate(savedRoute.date) : null,
    savedRoute.routeLabel || null,
    preview?.length || null,
    snapshot.optimizerMode ? optimizerLabel[snapshot.optimizerMode] || null : null,
    budgetTierLabel[snapshot.budgetTier || "standard"] || null,
    modifierLabel[snapshot.modifier || ""] || null,
    savedRoute.variantLabel ? `Variant: ${savedRoute.variantLabel}` : null,
    savedRoute.parentTitle ? `Från: ${savedRoute.parentTitle}` : null,
    savedRoute.savedAt ? `Sparad ${formatSavedTimestamp(savedRoute.savedAt)}` : null,
  ]
    .filter(Boolean)
    .forEach((text) => {
      const chip = document.createElement("span");
      chip.textContent = text;
      meta.appendChild(chip);
    });

  [...(snapshot.preferences || [])]
    .slice(0, 5)
    .forEach((text) => {
      const chip = document.createElement("span");
      chip.textContent = text;
      preferences.appendChild(chip);
    });

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "primary-button";
  openButton.textContent = "Kör originalet";
  openButton.addEventListener("click", () => {
    runSavedRouteRemix(savedRoute);
  });
  actions.appendChild(openButton);

  if (preview) {
    const mapButton = document.createElement("button");
    const guideButton = document.createElement("button");
    mapButton.type = "button";
    mapButton.className = "secondary-button";
    mapButton.textContent = "Visa på karta";
    mapButton.addEventListener("click", () => {
      switchTab("overview");
      window.setTimeout(() => {
        drawRouteOnMap(preview);
        document
          .querySelector(".map-explorer")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
      updateRouteMatchSummary(`"${savedRoute.title}" visas nu direkt på kartan från dina sparade dagar.`);
    });
    guideButton.type = "button";
    guideButton.className = "ghost-button";
    guideButton.textContent = "Ren guide";
    guideButton.addEventListener("click", () => {
      openRouteGuide(preview);
    });
    actions.appendChild(guideButton);
    actions.appendChild(mapButton);
  }

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "ghost-button";
  deleteButton.textContent = "Ta bort";
  deleteButton.addEventListener("click", () => {
    removeSavedRoute(savedRoute.id);
  });
  actions.appendChild(deleteButton);

  [
    { id: "more-wine", label: "Mer vinig" },
    { id: "shorter-walk", label: "Kortare gång" },
    { id: "hidden-gems", label: "Mer hidden gems" },
    { id: "more-evening", label: "Mer kväll" },
    { id: "more-culture", label: "Mer kultur" },
    { id: "low-key", label: "Mer low-key" },
    { id: "more-party", label: "Mer party" },
    { id: "budget", label: "Billigare" },
  ].forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button";
    button.textContent = item.label;
    button.addEventListener("click", () => {
      runSavedRouteRemix(savedRoute, item.id, {
        saveAsVariant: true,
      });
    });
    remix.appendChild(button);
  });

  [meta, title, context, summary, preferences, actions, remixLabel, remix].forEach((element) => {
    card.appendChild(element);
  });

  return card;
}

function renderSavedRoutes() {
  if (!savedRoutesSection || !savedRoutesGrid) {
    return;
  }

  savedRoutesGrid.innerHTML = "";
  savedRoutesSection.hidden = savedRoutes.length === 0;

  savedRoutes.forEach((savedRoute) => {
    savedRoutesGrid.appendChild(createSavedRouteCard(savedRoute));
  });
}

function closePlaceDrawer() {
  placeDrawer.hidden = true;
  placeDrawerBackdrop.hidden = true;
  activeDrawerItem = null;
}

function drawerItemCanBeUsedInPlanner(item) {
  return Boolean(item?.label);
}

function applyDrawerItemToPlanner(pointKey) {
  if (!activeDrawerItem || !drawerItemCanBeUsedInPlanner(activeDrawerItem)) {
    return false;
  }

  const plannerLabel = activeDrawerItem.label;
  setPlannerFieldFromLabel(pointKey, plannerLabel);

  return true;
}

async function planFromDrawerItem() {
  const plannerLabel = activeDrawerItem?.label;

  if (!applyDrawerItemToPlanner("start")) {
    return;
  }

  switchTab("routes");
  closePlaceDrawer();
  updateRouteMatchSummary(
    buildPlannerStyleSummary(
      `${plannerLabel} ligger nu som startpunkt. Jag planerar en ny dag härifrån...`,
    ),
  );

  try {
    await planRoutes();
  } catch (_error) {
    routeRenderMode = "fallback";
    plannedDays = [];
    activePlannedDate = null;
    expandedAlternativeDates.clear();
    renderRouteResults();
    setRouteApiStatus(false);
    updateRouteMatchSummary(
      "Planeringen från den valda platsen gick inte att köra live just nu, så fallback-rutterna ligger kvar.",
    );
  }
}

function openPlaceDrawer(item) {
  activeDrawerItem = item;
  placeDrawerType.textContent = `${item.type || "plats"} • ${item.area || "Rom"}`;
  placeDrawerTitle.textContent = item.label;
  placeDrawerSummary.textContent = item.summary || item.vibe || "Kuraterat stopp i Rom.";
  placeDrawerRouteFit.hidden = !item.route_fit_note;
  placeDrawerRouteFit.textContent = item.route_fit_note || "";
  placeDrawerDescription.textContent = item.long_description || item.summary || "";
  placeDrawerHappyHour.hidden = !item.happy_hour_note;
  placeDrawerHappyHour.textContent = item.happy_hour_note
    ? `Bra att veta: ${item.happy_hour_note}`
    : "";
  placeDrawerMapsLink.href = item.external_map_url || createMapUrl(`${item.label} Rome`);
  placeDrawerSearchLink.href = item.external_search_url || createGoogleInfoUrl(item.label);
  placeDrawerMapsLink.textContent = item.external_maps_label || "Google Maps";
  placeDrawerSearchLink.textContent = item.external_search_label || "Google-info";
  placeDrawerExtraLink.hidden = !item.external_extra_url;
  placeDrawerExtraLink.href = item.external_extra_url || "#";
  placeDrawerExtraLink.textContent = item.external_extra_label || "Extra länk";

  const plannerReady = drawerItemCanBeUsedInPlanner(item);
  placeDrawerStartButton.hidden = !plannerReady;
  placeDrawerEndButton.hidden = !plannerReady;
  placeDrawerPlanButton.hidden = !plannerReady;
  placeDrawerPlannerNote.hidden = !plannerReady;
  placeDrawerPlannerNote.textContent = plannerReady
    ? `${item.label} kan nu användas direkt som startpunkt, slutpunkt eller ny grund i planeringen.`
    : "";

  placeDrawerMeta.innerHTML = "";
  [
    item.price_level ? `Pris: ${item.price_level}` : null,
    item.best_time ? `Bäst: ${item.best_time}` : null,
    item.opening_summary ? `När: ${item.opening_summary}` : null,
    item.group_size ? `Grupp: ${item.group_size}` : null,
    item.booking_required === true
      ? "Bokning smart"
      : item.hide_dropin_note
        ? null
        : "Drop-in går ofta bra",
  ]
    .filter(Boolean)
    .forEach((text) => {
      const chip = document.createElement("span");
      chip.textContent = text;
      placeDrawerMeta.appendChild(chip);
    });

  placeDrawerHighlights.innerHTML = "";
  [
    ...(item.perfect_for || []),
    ...(item.feature_notes || []),
    ...(item.tags || []).slice(0, 3),
  ]
    .filter(Boolean)
    .slice(0, 8)
    .forEach((text) => {
      const chip = document.createElement("span");
      chip.textContent = text;
      placeDrawerHighlights.appendChild(chip);
    });

  const canFocusOnMap =
    Boolean(item.best_route_id && item.best_route_date) ||
    markers.has(item.label) ||
    (typeof item.lat === "number" && typeof item.lng === "number");

  placeDrawerMapButton.disabled = !canFocusOnMap;
  placeDrawerMapButton.textContent =
    item.best_route_id && item.best_route_date
      ? "Visa matchande dag på kartan"
      : "Visa på kartan i appen";

  placeDrawer.hidden = false;
  placeDrawerBackdrop.hidden = false;
}

async function openPlaceDrawerByQuery(query) {
  try {
    const response = await fetchJson(
      `${routeApiBase}/place-details?city=${encodeURIComponent(plannerCityKey)}&q=${encodeURIComponent(query)}`,
    );
    openPlaceDrawer(response.item);
  } catch (error) {
    openPlaceDrawer({
      label: query,
      type: "redaktionell mention",
      area: "Rom",
      summary: "Kunde inte hämta full intern info just nu.",
      long_description:
        "Du kan fortfarande hoppa vidare till Google eller Google Maps för att läsa mer om det här stoppet.",
      external_search_url: createGoogleInfoUrl(query),
      external_map_url: createMapUrl(`${query} Rome`),
      tags: [],
      perfect_for: [],
      feature_notes: [],
    });
  }
}

function buildEventDrawerItem(event) {
  const venueLine = [event.venue, event.address].filter(Boolean).join(" • ");
  const timing = formatLiveEventRange(event.start_date, event.end_date);
  const highlights = [
    ...(event.match_tags || []),
    event.best_route_label ? `Passar bäst: ${event.best_route_label}` : null,
    event.type || null,
    event.venue || null,
    event.source_label || null,
  ]
    .filter(Boolean)
    .slice(0, 8);

  return {
    id: event.id,
    label: event.title,
    type: event.type || "live event",
    area: event.venue || "Rom",
    summary:
      event.route_fit_note ||
      event.match_reason ||
      event.summary ||
      "Officiellt event i Rom.",
    long_description: [
      timing ? `Pågår: ${timing}.` : null,
      venueLine,
      event.summary,
      event.route_fit_note,
    ]
      .filter(Boolean)
      .join(" "),
    opening_summary: timing || null,
    group_size: event.buy_url ? "Bäst om ni vill kunna boka" : null,
    booking_required: Boolean(event.buy_url),
    hide_dropin_note: !event.buy_url,
    lat: typeof event.lat === "number" ? event.lat : null,
    lng: typeof event.lng === "number" ? event.lng : null,
    tags: event.match_tags || [],
    perfect_for: event.match_tags || [],
    feature_notes: highlights,
    best_route_id: event.best_route_id || null,
    best_route_date: event.date || null,
    route_fit_note:
      [
        event.best_route_label ? `Passar bäst med ${event.best_route_label}` : null,
        event.date ? formatSwedishDate(event.date) : null,
        event.route_fit_note || null,
      ]
        .filter(Boolean)
        .join(" • ") || null,
    external_map_url: createMapUrl(`${event.venue || event.title} Rome`),
    external_search_url: event.url || createGoogleInfoUrl(event.title),
    external_search_label: event.url ? "Officiell sida" : "Google-info",
    external_extra_url: event.buy_url || null,
    external_extra_label: event.buy_url ? "Köp biljett" : null,
  };
}

function createLiveEventCard(event) {
  const button = document.createElement("button");
  const kicker = document.createElement("span");
  const title = document.createElement("strong");
  const meta = document.createElement("span");
  const date = document.createElement("span");
  const copy = document.createElement("p");
  const cta = document.createElement("span");

  button.type = "button";
  button.className = "planner-event-card";

  kicker.className = "planner-event-kicker";
  kicker.textContent = "OFFICIELLT LIVE";

  title.textContent = event.title;

  meta.className = "planner-event-meta";
  meta.textContent = [event.type, event.venue].filter(Boolean).join(" • ");

  date.className = "planner-event-date";
  date.textContent = formatLiveEventRange(event.start_date, event.end_date);

  copy.className = "planner-event-copy";
  copy.textContent =
    event.route_fit_note ||
    event.match_reason ||
    event.summary ||
    "Officiellt event som passar ovanpå den här dagens rutt.";

  cta.className = "planner-event-cta";
  cta.textContent = event.buy_url ? "Öppna intern info + biljett" : "Öppna intern info";

  [kicker, title, meta, date, copy, cta].forEach((element) => {
    if (element.textContent) {
      button.appendChild(element);
    }
  });

  button.addEventListener("click", () => {
    openPlaceDrawer(buildEventDrawerItem(event));
  });

  return button;
}

function getFallbackPointCatalog() {
  return new Map(
    [
      ...places.map((place) => [
        place.name,
        { label: place.name, lat: place.lat, lng: place.lng },
      ]),
      ["Jewish Ghetto", { label: "Jewish Ghetto", lat: 41.8918, lng: 12.4752 }],
      ["San Clemente", { label: "San Clemente", lat: 41.8897, lng: 12.4987 }],
      ["Campo de' Fiori", { label: "Campo de' Fiori", lat: 41.8958, lng: 12.4722 }],
      ["Sant'Agostino", { label: "Sant'Agostino", lat: 41.8994, lng: 12.4721 }],
      [
        "Santa Maria sopra Minerva",
        { label: "Santa Maria sopra Minerva", lat: 41.8987, lng: 12.4785 },
      ],
      ["Castel Sant'Angelo", { label: "Castel Sant'Angelo", lat: 41.9031, lng: 12.4663 }],
      ["Prati", { label: "Prati", lat: 41.9072, lng: 12.4656 }],
      ["Villa Farnesina", { label: "Villa Farnesina", lat: 41.8918, lng: 12.4654 }],
      ["Trastevere", { label: "Trastevere", lat: 41.8885, lng: 12.4678 }],
      ["Rome Center", { label: "Rome Center", lat: 41.8933, lng: 12.4964 }],
    ],
  );
}

function buildFallbackRoutePoints(routeId) {
  const pointCatalog = getFallbackPointCatalog();
  const routeSeeds = {
    "classic-loop": [
      "Trastevere",
      "Jewish Ghetto",
      "Monti Backstreets",
      "San Clemente",
      "Colosseum by Night",
      "Trastevere",
    ],
    "south-loop": [
      "Trastevere",
      "Giardino degli Aranci",
      "Testaccio Market",
      "Centrale Montemartini",
      "Ostiense",
      "Trastevere",
    ],
    "centro-wine-loop": [
      "Trastevere",
      "Campo de' Fiori",
      "Sant'Agostino",
      "Piazza Navona Late",
      "Trastevere",
    ],
    "gianicolo-borgo-loop": [
      "Trastevere",
      "Villa Farnesina",
      "Gianicolo",
      "Castel Sant'Angelo",
      "Prati",
      "Trastevere",
    ],
  };

  return (routeSeeds[routeId] || ["Rome Center"]).map((label, index, all) => {
    const point = pointCatalog.get(label) || pointCatalog.get("Rome Center");
    const role =
      index === 0 ? "start" : index === all.length - 1 ? "end" : "stop";

    return {
      ...point,
      role,
    };
  });
}

function createFallbackRouteView(route) {
  const mapRoutePoints = buildFallbackRoutePoints(route.id);

  return {
    id: route.id,
    title: route.title,
    vibe: route.vibe,
    length: route.length,
    summary: route.summary,
    why: route.matcherPitch,
    path: route.path,
    anchor: route.anchor,
    walk: route.walk,
    stops: route.stops,
    stopItems: route.stops.map((text) => ({
      text,
      query: text.replace(/^\d{1,2}:\d{2}\s*/, ""),
    })),
    hiddenMentions: route.hiddenMentions,
    barMentions: route.barMentions,
    routeLink: createRouteDirectionsUrl(mapRoutePoints),
    mapRoutePoints,
    weatherNote: null,
    pulseNote: null,
    liveEventFitNote: null,
    venueSpecials: [],
    openingWarnings: [],
    dateLabel: null,
    routeShape:
      mapRoutePoints[0]?.label === mapRoutePoints[mapRoutePoints.length - 1]?.label
        ? "loop"
        : "arc",
    legs: mapRoutePoints.slice(1).map((point, index) => ({
      from_label: mapRoutePoints[index].label,
      to_label: point.label,
      distance_km: null,
      estimated_walk_minutes: null,
    })),
    longestLegKm: null,
    longestLegMinutes: null,
    averageLegMinutes: null,
    legFitNote: null,
    geoFitNote: null,
    anchorZone: route.anchor || null,
    guideStops: route.stops.map((text, index) => ({
      order: index + 1,
      label: text.replace(/^\d{1,2}:\d{2}\s*/, ""),
      area: "Rom",
      summary: "Kuraterat stopp i fallback-läget.",
      meta: null,
      incomingLeg:
        index < mapRoutePoints.length - 1
          ? {
              fromLabel: mapRoutePoints[index].label,
              toLabel: mapRoutePoints[index + 1].label,
              distanceKm: null,
              minutes: null,
            }
          : null,
    })),
  };
}

function clipText(text, maxLength = 240) {
  if (!text || text.length <= maxLength) {
    return text || "";
  }

  return `${text.slice(0, maxLength).trim().replace(/[.,;:\s]+$/u, "")}...`;
}

function takeLeadSentences(text, maxSentences = 2, maxLength = 260) {
  if (!text) {
    return "";
  }

  const sentences = text.match(/[^.!?]+[.!?]?/gu) || [text];
  const picked = sentences.slice(0, maxSentences).join(" ").trim();
  return clipText(picked, maxLength);
}

function buildRouteLine(routeView) {
  if (routeView?.path) {
    return routeView.path.replace(/\s*->\s*/g, " → ");
  }

  const points = routeView?.mapRoutePoints || [];
  if (!points.length) {
    return "Rom";
  }

  const labels = [points[0]?.label, points[points.length - 1]?.label].filter(Boolean);
  return labels.join(" → ");
}

function formatLegDistance(distanceKm) {
  if (!Number.isFinite(distanceKm)) {
    return null;
  }

  return `${String(distanceKm).replace(".", ",")} km`;
}

function formatLegMinutes(minutes) {
  if (!Number.isFinite(minutes)) {
    return null;
  }

  return `${minutes} min`;
}

function buildLegSummary(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];

  if (!legs.length) {
    return null;
  }

  const parts = [];

  if (Number.isFinite(Number(route.longest_leg_minutes)) || Number.isFinite(Number(route.longest_leg_km))) {
    parts.push(
      `Längsta ben: ${[
        formatLegMinutes(Number(route.longest_leg_minutes)),
        formatLegDistance(Number(route.longest_leg_km)),
      ]
        .filter(Boolean)
        .join(" • ")}`,
    );
  }

  if (Number.isFinite(Number(route.average_leg_minutes))) {
    parts.push(`Typiskt ben: ${formatLegMinutes(Number(route.average_leg_minutes))}`);
  }

  if (route.leg_fit_note) {
    parts.push(route.leg_fit_note);
  }

  return parts.filter(Boolean).join(" • ");
}

function stopSourceLabel(stop) {
  if (stop?.isLiveEvent) {
    return "Live";
  }

  if (stop?.source === "swapped") {
    return "Inbytt";
  }

  return "Kuraterat";
}

function getRouteLegPacingLabel() {
  const pacingKey = latestPlannerSnapshot?.legPacing || "balanced";
  return legPacingLabels[pacingKey] || legPacingLabels.balanced;
}

function getRouteDayProfileLabel(dayProfile) {
  return dayProfileLabels[dayProfile] || "Komponerad dag";
}

function getRoutingSourceLabel(routingSource) {
  return routingSourceLabels[routingSource] || routingSourceLabels.heuristic;
}

function buildAnchorExplanation(route) {
  if (!latestPlannerResolution) {
    return null;
  }

  const startSource = latestPlannerResolution.start?.source || null;
  const endSource = latestPlannerResolution.end?.source || null;
  const homeBase = latestPlannerResolution.homeBase?.label || null;

  if (activePlannerMode === plannerAutoMode) {
    if (homeBase) {
      return `Parranda använder ${homeBase} som mjuk boendebas och lät dagen öppna där den här rytmen får bäst fäste.`;
    }

    return `Parranda valde själv bas, start och final för att dagen ska kännas mer naturlig än låst.`;
  }

  if (startSource === "auto" && endSource === "auto") {
    return "Du lämnade ankare öppna, så Parranda valde själv var dagen ska börja och landa.";
  }

  if (startSource === "auto") {
    return `Parranda valde start runt ${route.startAnchorLabel || route.anchorZone || route.routeShapeLabel} för att ge rutten en naturligare öppning mot din valda final.`;
  }

  if (endSource === "auto") {
    return `Parranda valde final runt ${route.endAnchorLabel || route.anchorZone || route.routeShapeLabel} för att låta dagen landa starkare än en helt låst slutpunkt.`;
  }

  return null;
}

function buildVisibleWhy(route) {
  return takeLeadSentences(route.why || route.summary, 2, 220);
}

function createApiRouteView(
  route,
  label = "Huvudrutt",
  liveEvents = [],
  savePayload = null,
  dayDate = null,
) {
  const stopLabels = route.main_stops.map((stop) => stop.label).join(" • ");
  const routeShapeLabel = route.route_shape === "loop" ? "Loop" : "Båge";
  const liveEventById = new Map((liveEvents || []).map((event) => [String(event.id), event]));
  const mapPathPoints = Array.isArray(route.map_path_points) && route.map_path_points.length
    ? route.map_path_points
    : route.map_route_points;

  return {
    id: route.id,
    title: route.title,
    vibe: label,
    length: `ca ${route.estimated_km} km`,
    summary: route.summary,
    why: route.why_recommended,
    visibleWhy: buildVisibleWhy(route),
    path: `${route.start_label} -> ${stopLabels} -> ${route.end_label}`,
    anchor: `Start: ${route.start_label}`,
    walk: `${routeShapeLabel} • slut: ${route.end_label}`,
    startAnchorLabel: route.start_label,
    endAnchorLabel: route.end_label,
    routeShapeLabel,
    legSummary: buildLegSummary(route),
    stops: route.main_stops.map(
      (stop, index) =>
        `${index + 1}. ${stop.label} • ${stop.area} • ${stop.tags.join(", ")}`,
    ),
    stopItems: route.main_stops.map((stop, index) => ({
      text: `${index + 1}. ${stop.label} • ${stop.area} • ${stop.tags.join(", ")}`,
      query: stop.drawer_query || stop.label,
      isLiveEvent: Boolean(stop.is_live_event),
      source: stop.is_live_event ? "live" : "curated",
      sourceLabel: stopSourceLabel({ isLiveEvent: Boolean(stop.is_live_event) }),
      eventId: stop.event_id || null,
      liveEvent: stop.event_id ? liveEventById.get(String(stop.event_id)) || null : null,
    })),
    hiddenMentions: route.hidden_mentions,
    barMentions: route.bar_mentions,
    routeLink: createRouteDirectionsUrl(route.map_route_points),
    mapRoutePoints: route.map_route_points,
    mapPathPoints,
    routingSource: route.routing_source || "heuristic",
    weatherNote: route.weather_note,
    pulseNote: route.pulse_note || null,
    liveEventFitNote: route.live_event_fit_note || null,
    venueSpecials: route.venue_specials || [],
    budgetNote: route.budget_note || null,
    openingWarnings: route.opening_hours_warnings,
    liveEvents,
    savePayload,
    dateLabel: dayDate ? formatSwedishDate(dayDate) : null,
    routeShape: route.route_shape || null,
    dayProfile: route.day_profile || "peak",
    dayProfileLabel: getRouteDayProfileLabel(route.day_profile || "peak"),
    legs: route.legs || [],
    longestLegKm: route.longest_leg_km || null,
    longestLegMinutes: route.longest_leg_minutes || null,
    averageLegMinutes: route.average_leg_minutes || null,
    legFitNote: route.leg_fit_note || null,
    geoFitNote: route.geo_fit_note || null,
    anchorZone: route.anchor_zone || null,
    routingSourceLabel: getRoutingSourceLabel(route.routing_source || "heuristic"),
    pacingLabel: getRouteLegPacingLabel(),
    anchorExplanation: buildAnchorExplanation({
      startAnchorLabel: route.start_label,
      endAnchorLabel: route.end_label,
      anchorZone: route.anchor_zone || null,
      routeShapeLabel,
    }),
    engineBadges: [
      getRouteDayProfileLabel(route.day_profile || "peak"),
      getRouteLegPacingLabel(),
      getRoutingSourceLabel(route.routing_source || "heuristic"),
    ].filter(Boolean),
    guideStops: route.main_stops.map((stop, index) => ({
      order: index + 1,
      label: stop.label,
      area: stop.area,
      summary: stop.summary || stop.vibe || stop.tags.join(", "),
      meta: [
        stopSourceLabel({ isLiveEvent: Boolean(stop.is_live_event) }),
        stop.is_live_event ? "Live just nu" : null,
        stop.best_time ? `Bäst: ${stop.best_time}` : null,
        stop.price_level ? `Pris: ${stop.price_level}` : null,
      ]
        .filter(Boolean)
        .join(" • "),
      incomingLeg: route.legs?.[index]
        ? {
            fromLabel: route.legs[index].from_label,
            toLabel: route.legs[index].to_label,
            distanceKm: route.legs[index].distance_km,
            minutes: route.legs[index].estimated_walk_minutes,
          }
        : null,
    })),
  };
}

function fillGuidePills(container, items = []) {
  if (!container) {
    return;
  }

  container.innerHTML = "";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-chip-link";
    button.textContent = item;
    button.addEventListener("click", () => {
      closeRouteGuide();
      openPlaceDrawerByQuery(item);
    });
    container.appendChild(button);
  });
}

function buildGuideShareText(routeView) {
  const guideStops = (routeView.guideStops || []).length
    ? routeView.guideStops
    : (routeView.stopItems || []).map((stop) => ({
        label: stop.query || stop.text,
        area: null,
      }));
  const lines = [
    routeView.title,
    routeView.dateLabel || "Parranda-guide i Rom",
    buildRouteLine(routeView),
    `${routeView.length} • ${routeView.anchorZone || routeView.routeShape || "Rome-wide"}`,
    clipText(routeView.summary, 180),
    "",
    "Huvudstopp:",
    ...guideStops.map((stop) => `- ${stop.label}${stop.area ? ` (${stop.area})` : ""}`),
    "",
    `Gångrutt: ${routeView.routeLink}`,
  ];

  return lines.filter(Boolean).join("\n");
}

function openRouteGuide(routeView) {
  if (!routeView) {
    return;
  }

  const guideStops = (routeView.guideStops || []).length
    ? routeView.guideStops
    : (routeView.stopItems || []).map((stop, index) => ({
        order: index + 1,
        label: stop.query || stop.text,
        area: null,
        summary: "Kuraterat stopp i din rutt.",
        meta: null,
      }));

  activeGuideRouteView = routeView;
  routeGuideKicker.textContent = routeView.vibe
    ? `Parranda guide • ${routeView.vibe}`
    : "Parranda guide";
  routeGuideTitle.textContent = routeView.title;
  routeGuideMeta.textContent = [
    routeView.dateLabel || "Planerad dag",
    routeView.routeShape === "loop" ? "Loop" : routeView.routeShape === "arc" ? "Båge" : null,
    routeView.length,
  ]
    .filter(Boolean)
    .join(" • ");
  routeGuideRouteLine.textContent = buildRouteLine(routeView);
  routeGuideSummary.textContent = routeView.summary || "";
  routeGuideWhy.textContent =
    takeLeadSentences(
      routeView.anchorExplanation ||
        routeView.why ||
        routeView.geoFitNote ||
        "Parranda valde den här rutten som dagens tydligaste huvudspår.",
      3,
      340,
    );
  routeGuideDirectionsLink.href = routeView.routeLink || "#";

  routeGuideStats.innerHTML = "";
  [
    { label: "Start", value: routeView.anchor?.replace(/^Start:\s*/, "") || routeView.mapRoutePoints?.[0]?.label || "Rom" },
    { label: "Slut", value: routeView.walk?.replace(/^Båge • slut:\s*|^Loop • slut:\s*|^Slut:\s*/u, "") || routeView.mapRoutePoints?.[routeView.mapRoutePoints.length - 1]?.label || "Rom" },
    { label: "Zon", value: routeView.anchorZone || "Rome-wide" },
    { label: "Dagstyp", value: routeView.dayProfileLabel || "Komponerad dag" },
    { label: "Tempo", value: routeView.pacingLabel || "Balans" },
    { label: "Geo-fit", value: routeView.geoFitNote ? "Optimerad" : routeView.routeShape === "loop" ? "Loop" : "Båge" },
    {
      label: "Längsta ben",
      value:
        [formatLegMinutes(Number(routeView.longestLegMinutes)), formatLegDistance(Number(routeView.longestLegKm))]
          .filter(Boolean)
          .join(" • ") || "Ingår i rutten",
    },
    {
      label: "Typiskt ben",
      value: formatLegMinutes(Number(routeView.averageLegMinutes)) || "Varierar",
    },
  ].forEach((stat) => {
    const card = document.createElement("article");
    const title = document.createElement("strong");
    const value = document.createElement("p");
    card.className = "route-guide-stat";
    title.textContent = stat.label;
    value.textContent = stat.value;
    value.className = "route-guide-stop-copy";
    card.append(title, value);
    routeGuideStats.appendChild(card);
  });

  routeGuideStops.innerHTML = "";
  guideStops.forEach((stop) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    const summary = document.createElement("p");
    item.className = "route-guide-stop";
    title.textContent = `${stop.order}. ${stop.label}`;
    summary.className = "route-guide-stop-copy";
    summary.textContent = stop.summary || "Kuraterat stopp i din dag.";
    item.appendChild(title);

    if (stop.area || stop.meta) {
      const meta = document.createElement("p");
      meta.className = "route-guide-stop-meta";
      meta.textContent = [stop.area, stop.meta].filter(Boolean).join(" • ");
      item.appendChild(meta);
    }

    if (stop.incomingLeg) {
      const leg = document.createElement("p");
      leg.className = "route-guide-leg";
      leg.textContent = `Från ${stop.incomingLeg.fromLabel}: ${[
        formatLegMinutes(Number(stop.incomingLeg.minutes)),
        formatLegDistance(Number(stop.incomingLeg.distanceKm)),
      ]
        .filter(Boolean)
        .join(" • ")}`;
      item.appendChild(leg);
    }

    item.appendChild(summary);
    routeGuideStops.appendChild(item);
  });

  routeGuideBarsBlock.hidden = !(routeView.barMentions || []).length;
  routeGuideHiddenBlock.hidden = !(routeView.hiddenMentions || []).length;
  fillGuidePills(routeGuideBars, routeView.barMentions || []);
  fillGuidePills(routeGuideHidden, routeView.hiddenMentions || []);

  routeGuideBackdrop.hidden = false;
  routeGuideDrawer.hidden = false;
}

function closeRouteGuide() {
  routeGuideDrawer.hidden = true;
  routeGuideBackdrop.hidden = true;
  document.body.classList.remove("is-printing-guide");
  activeGuideRouteView = null;
}

function printRouteGuide() {
  if (!activeGuideRouteView) {
    return;
  }

  document.body.classList.add("is-printing-guide");
  window.print();
}

async function shareRouteGuide() {
  if (!activeGuideRouteView) {
    return;
  }

  const text = buildGuideShareText(activeGuideRouteView);
  const sharePayload = {
    title: activeGuideRouteView.title,
    text,
    url: activeGuideRouteView.routeLink,
  };

  if (navigator.share) {
    try {
      await navigator.share(sharePayload);
      return;
    } catch (_error) {
      // fall through to clipboard
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    updateRouteMatchSummary(
      `"${activeGuideRouteView.title}" är kopierad som ren guide. Klistra in den där du vill dela den.`,
    );
    return;
  }

  updateRouteMatchSummary(
    `Delning stöds inte fullt här, men gångrutten ligger kvar redo i Google Maps för "${activeGuideRouteView.title}".`,
  );
}

async function ensureCurrentLocation() {
  if (currentLocationCoords) {
    return currentLocationCoords;
  }

  if (!("geolocation" in navigator)) {
    throw new Error("Geolocation is unavailable");
  }

  currentLocationCoords = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: Number(position.coords.latitude.toFixed(5)),
          lng: Number(position.coords.longitude.toFixed(5)),
        }),
      reject,
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 300000,
      },
    );
  });

  return currentLocationCoords;
}

async function buildPlannerPoint(pointKey) {
  const controls = getPointControlSet(pointKey);
  const mode = controls.modeSelect?.value || plannerAutoMode;

  if (mode === plannerAutoMode) {
    return {
      type: plannerAutoMode,
      label: "Parranda väljer",
    };
  }

  if (mode === "current_location") {
    try {
      const coords = await ensureCurrentLocation();
      return {
        type: "current_location",
        label: pointKey === "home_base" ? "Min bas" : "Min plats",
        lat: coords.lat,
        lng: coords.lng,
      };
    } catch (error) {
      updateRouteMatchSummary(
        pointKey === "home_base"
          ? "Platsåtkomst nekades eller saknades, så Parranda väljer en smart boendebas i stället."
          : `Platsåtkomst nekades eller saknades, så Parranda väljer en smart ${pointKey === "start" ? "start" : "final"} i stället.`,
      );
      return { type: plannerAutoMode, label: "Parranda väljer" };
    }
  }

  if (mode === "custom") {
    const query = controls.customInput?.value?.trim() || "";
    return query
      ? { type: "custom", label: query, query }
      : { type: plannerAutoMode, label: "Parranda väljer" };
  }

  const exactLabel = normalizePlannerSelectionLabel(controls.presetSelect?.value);

  if (!exactLabel) {
    return {
      type: plannerAutoMode,
      label: "Parranda väljer",
    };
  }

  return {
    type: "preset",
    label: exactLabel,
  };
}

async function loadPlannerOptions() {
  plannerOptions = createLocalPlannerOptions();
  populatePresetSelects();

  try {
    await fetchJson(`${routeApiBase}/places/search?city=${encodeURIComponent(plannerCityKey)}`);
    setRouteApiStatus(true);
  } catch (error) {
    setRouteApiStatus(false);
  }
}

function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function updateInstallButtonVisibility() {
  if (!installButton) {
    return;
  }

  installButton.hidden = !deferredInstallPrompt || isStandaloneApp();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const isLocalDev =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  try {
    if (isLocalDev) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));

      if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(
          cacheKeys
            .filter((key) => key.startsWith("parranda-"))
            .map((key) => caches.delete(key)),
        );
      }

      return;
    }

    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.error("Service worker registration failed", error);
  }
}

function switchTab(tabName) {
  if (tabName !== "routes" && routePlannerStart && !routePlannerStart.hidden) {
    closePlannerModal();
  }

  activeTab = tabName;

  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === tabName);
  });

  if (tabName === "overview" && map) {
    window.setTimeout(() => {
      map.invalidateSize();
    }, 50);
  }
}

function updateFavoritesUI() {
  favoriteCountChip.textContent = `${favorites.length} sparade`;
  favoritesStrip.innerHTML = "";

  if (!favorites.length) {
    favoritesStrip.innerHTML =
      '<p class="favorites-empty">Inga sparade ännu. Tryck på Spara i ett kort eller från kartpanelen.</p>';
    showAllButton.classList.remove("is-active");
    showFavoritesButton.classList.toggle("is-active", onlyFavorites);
    return;
  }

  favorites.forEach((name) => {
    const place = getPlaceByName(name);

    if (!place) {
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "favorite-pill";
    button.textContent = place.name;
    button.addEventListener("click", () => {
      selectedPlaceName = place.name;
      onlyFavorites = true;
      renderPlaces();
      focusPlaceOnMap(place.name);
      updateFavoritesUI();
      switchTab("overview");
    });
    favoritesStrip.appendChild(button);
  });

  showFavoritesButton.classList.toggle("is-active", onlyFavorites);
  showAllButton.classList.toggle("is-active", !onlyFavorites);
}

function buildMarkerIcon(place) {
  return L.divIcon({
    className: "roma-marker-wrapper",
    html: `<span class="roma-marker ${isFavorite(place.name) ? "is-favorite" : ""}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function refreshMarkerStyles() {
  markers.forEach((marker, name) => {
    const place = getPlaceByName(name);
    marker.setIcon(buildMarkerIcon(place));
  });
}

function updateMapPanel(place) {
  if (!place) {
    return;
  }

  selectedPlaceName = place.name;
  mapPlaceName.textContent = place.name;
  mapPlaceMeta.textContent = `${place.category} • ${place.area} • ${place.crowd}`;
  mapPlaceDescription.textContent = place.description;
  mapPlaceNote.textContent = `Lokal notis: ${place.localNote}`;
  mapPlaceLink.href = createMapUrl(place.mapQuery);
  mapFavoriteButton.textContent = isFavorite(place.name)
    ? "Ta bort från sparade"
    : "Spara vald plats";
  mapFavoriteButton.dataset.place = place.name;
  mapFavoriteButton.disabled = false;

  mapPlaceTags.innerHTML = "";
  place.tags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.textContent = tag;
    mapPlaceTags.appendChild(chip);
  });

  renderHeroWildcard();
}

function updateMapPanelForRoute(routeView) {
  mapPlaceName.textContent = routeView.title;
  mapPlaceMeta.textContent = `${routeView.anchor} • ${routeView.walk}`;
  mapPlaceDescription.textContent = routeView.summary;
  mapPlaceNote.textContent = [
    routeView.pulseNote || null,
    routeView.liveEventFitNote || null,
    routeView.liveEvents?.length
      ? `${routeView.liveEvents.length} live-event passar extra bra med just den här rutten.`
      : null,
    routeView.why || "Kartfokus på dagens valda rutt.",
  ]
    .filter(Boolean)
    .join(" ");
  mapPlaceLink.href = routeView.routeLink;
  mapFavoriteButton.textContent = "Spara vald plats";
  mapFavoriteButton.dataset.place = "";
  mapFavoriteButton.disabled = true;

  mapPlaceTags.innerHTML = "";
  [
    ...routeView.hiddenMentions.slice(0, 3),
    ...routeView.barMentions.slice(0, 2),
    ...(routeView.liveEvents || []).slice(0, 2).map((event) => `Live: ${event.title}`),
  ].forEach((tagText) => {
    const chip = document.createElement("span");
    chip.textContent = tagText;
    mapPlaceTags.appendChild(chip);
  });
}

function clearRouteOverlay() {
  if (routeOverlay) {
    routeOverlay.clearLayers();
  }
}

function drawRouteOnMap(routeView, highlightedEventId = null) {
  if (!map || !routeOverlay || !Array.isArray(routeView.mapRoutePoints)) {
    return;
  }

  clearRouteOverlay();

  const polylinePoints =
    Array.isArray(routeView.mapPathPoints) && routeView.mapPathPoints.length
      ? routeView.mapPathPoints
      : routeView.mapRoutePoints;
  const latLngs = polylinePoints.map((point) => [point.lat, point.lng]);
  const bounds = [];

  L.polyline(latLngs, {
    color: "#af4d24",
    weight: 5,
    opacity: 0.88,
  }).addTo(routeOverlay);

  routeView.mapRoutePoints.forEach((point) => {
    const isAnchor = point.role === "start" || point.role === "end";
    const marker = L.circleMarker([point.lat, point.lng], {
      radius: isAnchor ? 7 : 5,
      color: isAnchor ? "#465340" : "#af4d24",
      weight: 2,
      fillColor: isAnchor ? "#d7a04d" : "#af4d24",
      fillOpacity: 0.95,
    }).addTo(routeOverlay);

    marker.bindPopup(
      `<strong>${point.label}</strong><br>${point.role === "start" ? "Start" : point.role === "end" ? "Slut" : "Stopp"}`,
    );
    bounds.push([point.lat, point.lng]);
  });

  (routeView.liveEvents || [])
    .filter((event) => typeof event.lat === "number" && typeof event.lng === "number")
    .forEach((event) => {
      const isHighlighted = event.id === highlightedEventId;
      const marker = L.circleMarker([event.lat, event.lng], {
        radius: isHighlighted ? 8 : 6,
        color: isHighlighted ? "#17384f" : "#465340",
        weight: 2,
        fillColor: isHighlighted ? "#7eb8c9" : "#d7a04d",
        fillOpacity: 0.95,
      }).addTo(routeOverlay);

      marker.bindPopup(
        `<strong>${event.title}</strong><br>${event.venue || "Rom"}<br>${event.route_fit_note || "Live-event på eller nära rutten."}`,
      );

      if (isHighlighted) {
        marker.openPopup();
      }

      bounds.push([event.lat, event.lng]);
    });

  if (bounds.length) {
    map.fitBounds(bounds, {
      padding: [40, 40],
    });
  }

  updateMapPanelForRoute(routeView);
}

function showLoosePointOnMap(item) {
  if (!map || !routeOverlay || typeof item.lat !== "number" || typeof item.lng !== "number") {
    return;
  }

  activeRouteKey = null;
  renderRouteResults();
  clearRouteOverlay();

  const marker = L.circleMarker([item.lat, item.lng], {
    radius: 8,
    color: "#465340",
    weight: 2,
    fillColor: "#af4d24",
    fillOpacity: 0.95,
  }).addTo(routeOverlay);

  marker.bindPopup(`<strong>${item.label}</strong><br>${item.area || "Rom"}`).openPopup();
  map.setView([item.lat, item.lng], 15, { animate: true });

  mapPlaceName.textContent = item.label;
  mapPlaceMeta.textContent = `${item.type || "plats"} • ${item.area || "Rom"}`;
  mapPlaceDescription.textContent = item.long_description || item.summary || item.vibe || "";
  mapPlaceNote.textContent =
    item.route_fit_note || item.opening_summary || "Utvald plats i Rom.";
  mapPlaceLink.href = item.external_map_url || createMapUrl(`${item.label} Rome`);
  mapFavoriteButton.textContent = "Spara vald plats";
  mapFavoriteButton.dataset.place = "";
  mapFavoriteButton.disabled = true;
  mapPlaceTags.innerHTML = "";
  (item.tags || []).slice(0, 5).forEach((tag) => {
    const chip = document.createElement("span");
    chip.textContent = tag;
    mapPlaceTags.appendChild(chip);
  });
}

function focusPlaceOnMap(name) {
  const place = getPlaceByName(name);
  const marker = markers.get(name);

  if (!place || !marker || !map) {
    return;
  }

  activeRouteKey = null;
  renderRouteResults();
  clearRouteOverlay();
  map.setView([place.lat, place.lng], 14, { animate: true });
  marker.openPopup();
  updateMapPanel(place);
}

function initMap() {
  if (typeof L === "undefined") {
    mapPlaceName.textContent = "Kartan kunde inte laddas just nu";
    mapPlaceDescription.textContent =
      "Resten av appen fungerar fortfarande, men kartbiblioteket saknas i webbläsaren.";
    return;
  }

  map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView([41.8933, 12.4964], 12);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  routeOverlay = L.layerGroup().addTo(map);

  places.forEach((place) => {
    const marker = L.marker([place.lat, place.lng], {
      icon: buildMarkerIcon(place),
      title: place.name,
    }).addTo(map);

    marker.bindPopup(
      `<strong>${place.name}</strong><br>${place.area}<br>${place.bestFor}`,
    );

    marker.on("click", () => {
      updateMapPanel(place);
    });

    markers.set(place.name, marker);
  });

  updateMapPanel(getPlaceByName(selectedPlaceName));
}

function renderSpotlights() {
  const featuredPlaces = places.filter((place) => place.featured);

  spotlightGrid.innerHTML = "";

  featuredPlaces.forEach((place, index) => {
    const card = spotlightTemplate.content.firstElementChild.cloneNode(true);

    card.style.animationDelay = `${index * 80}ms`;
    card.dataset.categoryTone = getCategoryTone(place.category);
    card.querySelector(".spotlight-kicker").textContent = place.category;
    card.querySelector("h3").textContent = place.name;
    card.querySelector(".spotlight-description").textContent = place.localNote;
    card.querySelector(".spotlight-area").textContent = place.area;
    card.querySelector(".spotlight-crowd").textContent = place.crowd;

    card.addEventListener("click", () => {
      selectedPlaceName = place.name;
      switchTab("overview");
      focusPlaceOnMap(place.name);
      document
        .querySelector(".map-explorer")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    spotlightGrid.appendChild(card);
  });
}

function renderPlaces() {
  const filtered = getVisiblePlaces();

  cardsGrid.innerHTML = "";

  if (!filtered.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML =
      "<h3>Inga träffar just nu</h3><p>Testa ett annat sökord eller byt vibe, till exempel street art, lugn eller aperitivo.</p>";
    cardsGrid.appendChild(emptyState);
    return;
  }

  filtered.forEach((place, index) => {
    const card = placeTemplate.content.firstElementChild.cloneNode(true);

    card.style.animationDelay = `${index * 60}ms`;
    card.dataset.place = place.name;
    card.dataset.categoryTone = getCategoryTone(place.category);
    card.querySelector(".category-pill").textContent = place.category;
    card.querySelector(".score-pill").textContent = place.score;
    card.querySelector(".area-pill").textContent = place.area;
    card.querySelector(".crowd-pill").textContent = place.crowd;
    card.querySelector("h3").textContent = place.name;
    card.querySelector(".description").textContent = place.description;
    card.querySelector(".best-for").textContent = place.bestFor;
    card.querySelector(".time-tag").textContent = place.time;
    card.querySelector(".local-note").textContent = `Lokal notis: ${place.localNote}`;

    const tagRow = card.querySelector(".tag-row");
    place.tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.textContent = tag;
      tagRow.appendChild(chip);
    });

    const favoriteButton = card.querySelector(".favorite-button");
    favoriteButton.textContent = isFavorite(place.name) ? "Sparad" : "Spara";
    favoriteButton.classList.toggle("is-active", isFavorite(place.name));
    favoriteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(place.name);
      refreshMarkerStyles();
    });

    const mapLink = card.querySelector(".map-link");
    mapLink.href = createMapUrl(place.mapQuery);
    mapLink.textContent = "Visa på karta";

    card.addEventListener("click", (event) => {
      const interactiveTarget = event.target.closest("a, button");

      if (interactiveTarget) {
        return;
      }

      selectedPlaceName = place.name;
      switchTab("overview");
      focusPlaceOnMap(place.name);
      document
        .querySelector(".map-explorer")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    cardsGrid.appendChild(card);
  });
}

function getDistrictGuideById(guideId) {
  return districtGuides.find((guide) => guide.id === guideId) || districtGuides[0];
}

function getActiveDistrictGuide() {
  return getDistrictGuideById(activeDistrictId);
}

function renderDistrictGuide() {
  const guide = getActiveDistrictGuide();

  districtEyebrow.textContent = guide.eyebrow;
  districtTitle.textContent = guide.title;
  districtDescription.textContent = guide.description;
  districtStopsEyebrow.textContent = guide.eyebrow;
  districtStopsTitle.textContent = guide.stopsTitle;
  districtStopsNote.textContent = guide.stopsNote;
  districtDayEyebrow.textContent = "PERFEKTA DAGEN";
  districtDayTitle.textContent = guide.dayTitle;
  districtDayNote.textContent = guide.dayNote;
  districtActionTitle.textContent = guide.actionTitle;
  districtActionCopy.textContent = guide.actionCopy;

  districtStatsGrid.innerHTML = "";
  guide.stats.forEach((item) => {
    const card = document.createElement("article");
    card.innerHTML = `<strong>${item.value}</strong><span>${item.label}</span>`;
    districtStatsGrid.appendChild(card);
  });

  districtSelector.innerHTML = "";
  districtGuides.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "district-selector-button";
    button.classList.toggle("is-active", item.id === guide.id);
    button.innerHTML = `<strong>${item.label}</strong><span>${item.selectorNote}</span>`;
    button.addEventListener("click", () => {
      activeDistrictId = item.id;
      renderDistrictGuide();
    });
    districtSelector.appendChild(button);
  });

  districtStopsGrid.innerHTML = "";
  guide.stopCards.forEach((stop, index) => {
    const card = trastevereBarTemplate.content.firstElementChild.cloneNode(true);

    card.style.animationDelay = `${index * 70}ms`;
    card.dataset.stopTone = normalizeText(stop.type || "");
    card.querySelector(".category-pill").textContent = stop.type;
    card.querySelector(".score-pill").textContent = stop.score;
    card.querySelector("h3").textContent = stop.name;
    card.querySelector(".description").textContent = stop.description;
    card.querySelector(".bar-focus").textContent = stop.focus;
    card.querySelector(".bar-why").textContent = stop.why;
    card.querySelector(".bar-time").textContent = stop.time;

    const mapLink = card.querySelector(".map-link");
    mapLink.href = createMapUrl(stop.mapQuery);
    mapLink.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) {
        return;
      }

      openPlaceDrawerByQuery(stop.drawerQuery || stop.name);
    });

    districtStopsGrid.appendChild(card);
  });

  districtTimeline.innerHTML = "";
  guide.dayStops.forEach((stop, index) => {
    const card = timelineStopTemplate.content.firstElementChild.cloneNode(true);

    card.style.animationDelay = `${index * 70}ms`;
    card.querySelector(".timeline-time").textContent = stop.time;
    card.querySelector(".spotlight-kicker").textContent = stop.label;
    card.querySelector("h3").textContent = stop.title;
    card.querySelector(".description").textContent = stop.description;
    card.querySelector(".timeline-note").textContent = stop.note;

    districtTimeline.appendChild(card);
  });
}

function applyDistrictGuidePreset(pointKey) {
  const guide = getActiveDistrictGuide();
  const label = pointKey === "start" ? guide.startLabel : guide.endLabel;
  const modeSelect = pointKey === "start" ? startModeSelect : endModeSelect;
  const presetSelect = pointKey === "start" ? startPresetSelect : endPresetSelect;

  setPlannerMode(plannerManualMode);
  modeSelect.value = "preset";
  syncPlannerModeUI();
  setPresetSelectValue(presetSelect, label);
}

function planFromCurrentDistrictGuide() {
  const guide = getActiveDistrictGuide();

  setPlannerFieldFromLabel("home_base", guide.startLabel);
  switchTab("routes");
  openPlannerModal();
  updateRouteMatchSummary(
    buildPlannerStyleSummary(
      `${guide.startLabel} ligger nu som mjuk boendebas. Justera datum, km och smak innan du planerar.`,
    ),
  );
}

function focusDistrictGuideOnMap() {
  const guide = getActiveDistrictGuide();

  switchTab("overview");
  window.setTimeout(() => {
    showLoosePointOnMap(guide.mapFocus);
    document
      .querySelector(".map-explorer")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);
}

function focusRouteCardOnMap(routeView, routeKey, message) {
  activeRouteKey = routeKey;
  renderRouteResults();
  switchTab("overview");

  window.setTimeout(() => {
    drawRouteOnMap(routeView);
    document
      .querySelector(".map-explorer")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);

  updateRouteMatchSummary(message);
}

function getRouteViewForLiveEvent(item) {
  if (!item?.best_route_id || !item?.best_route_date) {
    return null;
  }

  const day = plannedDays.find((plannedDay) => plannedDay.date === item.best_route_date);
  if (!day) {
    return null;
  }

  if (day.primary_route?.id === item.best_route_id) {
    return {
      routeKey: `${day.date}:${day.primary_route.id}:primary`,
      routeView: createApiRouteView(
        day.primary_route,
        "Huvudrutt",
        (day.live_events || []).filter((event) => event.best_route_id === day.primary_route.id),
        null,
        day.date,
      ),
    };
  }

  const altIndex = (day.alternatives || []).findIndex((route) => route.id === item.best_route_id);
  if (altIndex === -1) {
    return null;
  }

  return {
    routeKey: `${day.date}:${day.alternatives[altIndex].id}:alt-${altIndex}`,
    routeView: createApiRouteView(
      day.alternatives[altIndex],
      `Alternativ ${altIndex + 1}`,
      (day.live_events || []).filter(
        (event) => event.best_route_id === day.alternatives[altIndex].id,
      ),
      null,
      day.date,
    ),
  };
}

function focusLiveEventOnMap(item) {
  const matchedRoute = getRouteViewForLiveEvent(item);

  if (!matchedRoute) {
    showLoosePointOnMap(item);
    return;
  }

  activeRouteKey = matchedRoute.routeKey;
  renderRouteResults();
  switchTab("overview");

  window.setTimeout(() => {
    drawRouteOnMap(matchedRoute.routeView, item.id);
    document
      .querySelector(".map-explorer")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);

  updateRouteMatchSummary(
    item.route_fit_note ||
      `${item.label} matchar bäst med ${item.best_route_label || "dagens starkaste rutt"}.`,
  );
}

function createRouteCard(routeView, { routeKey, isSecondary = false, isRecommended = false }) {
  const card = romeRouteTemplate.content.firstElementChild.cloneNode(true);
  const stopsContainer = card.querySelector(".route-stops");
  const hiddenContainer = card.querySelector(".route-hidden-pills");
  const barsContainer = card.querySelector(".route-bar-pills");
  const engineStrip = card.querySelector(".route-engine-strip");
  const enginePills = card.querySelector(".route-engine-pills");
  const engineNote = card.querySelector(".route-engine-note");
  const legSummary = card.querySelector(".route-leg-summary");
  const weatherNote = card.querySelector(".route-weather-note");
  const specials = card.querySelector(".route-specials");
  const warnings = card.querySelector(".route-warnings");
  const why = card.querySelector(".route-why");
  const selectButton = card.querySelector(".route-select-button");
  const guideButton = card.querySelector(".route-guide-button");

  card.dataset.routeKey = routeKey;
  card.dataset.routeVariant = isRecommended ? "recommended" : isSecondary ? "alternative" : "default";
  card.classList.toggle("is-recommended", isRecommended);
  card.classList.toggle("is-secondary", isSecondary);
  card.classList.toggle("is-selected", activeRouteKey === routeKey);
  card.querySelector(".route-vibe").textContent = routeView.vibe;
  card.querySelector(".route-length").textContent = routeView.length;
  card.querySelector("h3").textContent = routeView.title;
  card.querySelector(".route-summary").textContent = routeView.summary;
  why.textContent = routeView.visibleWhy || takeLeadSentences(routeView.why, 2, 240);
  why.hidden = !why.textContent;
  card.querySelector(".route-path").textContent = routeView.path;
  card.querySelector(".route-anchor").textContent = routeView.anchor;
  card.querySelector(".route-walk").textContent = routeView.walk;

  enginePills.innerHTML = "";
  (routeView.engineBadges || []).forEach((label) => {
    const pill = document.createElement("span");
    pill.className = "route-engine-pill";
    pill.textContent = label;
    enginePills.appendChild(pill);
  });
  engineNote.hidden = !routeView.anchorExplanation;
  engineNote.textContent = routeView.anchorExplanation || "";
  engineStrip.hidden = !(routeView.engineBadges?.length || routeView.anchorExplanation);

  legSummary.hidden = !routeView.legSummary;
  if (routeView.legSummary) {
    legSummary.textContent = routeView.legSummary;
  }
  card.querySelector(".route-link").href = routeView.routeLink;
  card.querySelector(".route-link").textContent = "Öppna gångrutt";
  selectButton.classList.toggle("is-active", activeRouteKey === routeKey);
  selectButton.textContent =
    activeRouteKey === routeKey ? "Kartfokus aktivt" : "Visa i appen";

  weatherNote.hidden = !routeView.weatherNote;
  if (routeView.weatherNote) {
    weatherNote.textContent = routeView.weatherNote;
  }

  specials.hidden = !(
    routeView.pulseNote ||
    routeView.liveEventFitNote ||
    routeView.venueSpecials.length ||
    routeView.budgetNote
  );
  specials.innerHTML = "";
  if (routeView.pulseNote) {
    const pulseNote = document.createElement("p");
    pulseNote.className = "route-special-note";
    pulseNote.textContent = routeView.pulseNote;
    specials.appendChild(pulseNote);
  }
  if (routeView.liveEventFitNote) {
    const liveNote = document.createElement("p");
    liveNote.className = "route-special-note";
    liveNote.textContent = routeView.liveEventFitNote;
    specials.appendChild(liveNote);
  }
  routeView.venueSpecials.forEach((specialText) => {
    const note = document.createElement("p");
    note.className = "route-special-note";
    note.textContent = specialText;
    specials.appendChild(note);
  });

  if (routeView.budgetNote) {
    specials.hidden = false;
    const budgetNote = document.createElement("p");
    budgetNote.className = "route-special-note";
    budgetNote.textContent = routeView.budgetNote;
    specials.appendChild(budgetNote);
  }

  warnings.hidden = !routeView.openingWarnings.length;
  warnings.innerHTML = "";
  routeView.openingWarnings.forEach((warningText) => {
    const warning = document.createElement("p");
    warning.className = "route-warning";
    warning.textContent = warningText;
    warnings.appendChild(warning);
  });

  const stopItems = routeView.stopItems || routeView.stops.map((text) => ({ text }));
  const visibleStops = stopItems.slice(0, 4);
  visibleStops.forEach((stopItem) => {
    const stop = document.createElement("p");
    stop.className = "route-stop-item";

    const source = document.createElement("span");
    source.className = `route-stop-source route-stop-source-${(stopItem.source || "curated").replace(/[^a-z-]/g, "")}`;
    source.textContent = stopItem.sourceLabel || "Kuraterat";
    stop.appendChild(source);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-stop-link";
    button.textContent = stopItem.text;
    button.addEventListener("click", () => {
      if (stopItem.liveEvent) {
        openPlaceDrawer(buildEventDrawerItem(stopItem.liveEvent));
        return;
      }
      openPlaceDrawerByQuery(stopItem.query || stopItem.text);
    });
    stop.appendChild(button);

    stopsContainer.appendChild(stop);
  });

  if (stopItems.length > visibleStops.length) {
    const overflow = document.createElement("p");
    overflow.className = "route-stop-overflow";
    overflow.textContent = `+${stopItems.length - visibleStops.length} stopp till i Ren guide`;
    stopsContainer.appendChild(overflow);
  }

  routeView.hiddenMentions.slice(0, 5).forEach((item) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "route-chip-link";
    chip.textContent = item;
    chip.addEventListener("click", () => {
      openPlaceDrawerByQuery(item);
    });
    hiddenContainer.appendChild(chip);
  });

  routeView.barMentions.slice(0, 5).forEach((item) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "route-chip-link";
    chip.textContent = item;
    chip.addEventListener("click", () => {
      openPlaceDrawerByQuery(item);
    });
    barsContainer.appendChild(chip);
  });

  hiddenContainer.closest(".route-mentions").hidden = routeView.hiddenMentions.length === 0;
  barsContainer.closest(".route-mentions").hidden = routeView.barMentions.length === 0;

  selectButton.addEventListener("click", () => {
    focusRouteCardOnMap(
      routeView,
      routeKey,
      `"${routeView.title}" är nu kartfokuserad. Hoppa till Roma Guide om du vill se rutten i detalj på kartan.`,
    );
  });

  guideButton?.addEventListener("click", () => {
    openRouteGuide(routeView);
  });

  return card;
}

function renderFallbackRoutes() {
  routeResults.innerHTML = "";

  romeRoutes.forEach((route, index) => {
    const routeView = createFallbackRouteView(route);
    const routeKey = `fallback:${route.id}`;
    const card = createRouteCard(routeView, {
      routeKey,
      isRecommended: index === 0,
    });

    routeResults.appendChild(card);
  });
}

function ensureActivePlannedDate() {
  if (!plannedDays.length) {
    activePlannedDate = null;
    return null;
  }

  const availableDates = plannedDays.map((day) => day.date);

  if (!activePlannedDate || !availableDates.includes(activePlannedDate)) {
    activePlannedDate = availableDates[0];
  }

  return activePlannedDate;
}

function renderPlannedDays() {
  routeResults.innerHTML = "";
  const activeDate = ensureActivePlannedDate();
  const activeDay = plannedDays.find((day) => day.date === activeDate) || plannedDays[0];

  if (!activeDay) {
    return;
  }

  const shell = document.createElement("section");
  shell.className = "planner-results-shell";

  const dayTabs = document.createElement("div");
  dayTabs.className = "planner-day-tabs";

  plannedDays.forEach((day, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `planner-day-tab${day.date === activeDay.date ? " is-active" : ""}`;
    button.textContent = `Dag ${index + 1} • ${formatCompactSwedishDate(day.date)}`;
    button.addEventListener("click", () => {
      activePlannedDate = day.date;
      activeLiveDate = day.date;
      loadCityPulse(day.date).catch(() => {});
      renderRouteResults();
    });
    dayTabs.appendChild(button);
  });

  const dayCard = plannerDayTemplate.content.firstElementChild.cloneNode(true);
  const primaryRouteView = createApiRouteView(
    activeDay.primary_route,
    "Huvudrutt",
    (activeDay.live_events || []).filter((event) => event.best_route_id === activeDay.primary_route.id),
    null,
    activeDay.date,
  );
  const primaryKey = `${activeDay.date}:${activeDay.primary_route.id}:primary`;
  const primarySlot = dayCard.querySelector(".planner-primary-slot");
  const altGrid = dayCard.querySelector(".planner-alt-grid");
  const altSection = dayCard.querySelector(".planner-alt-section");
  const altToggle = dayCard.querySelector(".planner-alt-toggle");
  const altBody = dayCard.querySelector(".planner-alt-body");
  const signalsContainer = dayCard.querySelector(".planner-day-signals");
  const eventsSection = dayCard.querySelector(".planner-day-events");
  const eventsGrid = dayCard.querySelector(".planner-events-grid");
  const alternativesExpanded = expandedAlternativeDates.has(activeDay.date);

  dayCard.querySelector(".planner-day-date").textContent = formatSwedishDate(activeDay.date);
  dayCard.querySelector(".planner-day-title").textContent = activeDay.primary_route.title;
  dayCard.querySelector(".planner-day-summary").textContent =
    activeDay.primary_route.why_recommended ||
    "Motorn lyfter den här som tydligaste huvuddag utifrån datum, gångmål och preferenser.";

  signalsContainer.hidden = !activeDay.date_signals?.length;
  signalsContainer.innerHTML = "";
  (activeDay.date_signals || []).forEach((signal) => {
    const note = document.createElement("article");
    note.className = "planner-day-signal";
    note.innerHTML = `<strong>${signal.title}</strong><p>${signal.note}</p>`;
    signalsContainer.appendChild(note);
  });

  eventsGrid.innerHTML = "";
  eventsSection.hidden = !activeDay.live_events?.length;
  (activeDay.live_events || []).forEach((event) => {
    eventsGrid.appendChild(
      createLiveEventCard({
        ...event,
        date: activeDay.date,
      }),
    );
  });

  primarySlot.appendChild(
    createRouteCard(primaryRouteView, {
      routeKey: primaryKey,
      isRecommended: true,
    }),
  );

  activeDay.alternatives.forEach((alternative, index) => {
    const altView = createApiRouteView(
      alternative,
      `Alternativ ${index + 1}`,
      (activeDay.live_events || []).filter((event) => event.best_route_id === alternative.id),
      null,
      activeDay.date,
    );
    const altKey = `${activeDay.date}:${alternative.id}:alt-${index}`;
    altGrid.appendChild(
      createRouteCard(altView, {
        routeKey: altKey,
        isSecondary: true,
      }),
    );
  });

  altSection.hidden = activeDay.alternatives.length === 0;

  if (!altSection.hidden) {
    altToggle.textContent = alternativesExpanded
      ? `Dölj alternativa upplägg (${activeDay.alternatives.length})`
      : `Visa alternativa upplägg (${activeDay.alternatives.length})`;
    altToggle.setAttribute("aria-expanded", String(alternativesExpanded));
    altBody.hidden = !alternativesExpanded;
    altToggle.addEventListener("click", () => {
      if (expandedAlternativeDates.has(activeDay.date)) {
        expandedAlternativeDates.delete(activeDay.date);
      } else {
        expandedAlternativeDates.add(activeDay.date);
      }
      renderRouteResults();
    });
  }

  shell.append(dayTabs, dayCard);
  routeResults.appendChild(shell);
}

function renderRouteResults() {
  routeFallbackNote.hidden = routeApiAvailable !== false;

  if (routeRenderMode === "api" && plannedDays.length) {
    renderPlannedDays();
    return;
  }

  renderFallbackRoutes();
}

async function planRoutes() {
  const dates = expandDateRange(routeDateFrom.value, routeDateTo.value);
  const preferences = getSelectedPreferences();

  if (routeGuideDrawer && !routeGuideDrawer.hidden) {
    closeRouteGuide();
  }

  if (!routeApiAvailable) {
    routeRenderMode = "fallback";
    plannedDays = [];
    activePlannedDate = null;
    latestPlannerResolution = null;
    liveEditionExpanded = false;
    expandedAlternativeDates.clear();
    activeLiveDate = routeDateFrom.value || getTodayIsoDate();
    await loadCityPulse(activeLiveDate);
    renderRouteResults();
    updateRouteMatchSummary(
      "Live-ruttmotorn svarar inte just nu, så appen visar de kuraterade Rom-baserade rutterna i stället.",
    );
    setPlannerStatusMessage(
      "Live-läget svarar inte just nu, så Parranda visar sina kuraterade Rome-wide-rutter i stället.",
      "warning",
    );
    return;
  }

  const payload = {
    city: plannerCityKey,
    dates,
    home_base:
      activePlannerMode === plannerAutoMode
        ? await buildPlannerPoint("home_base")
        : { type: plannerAutoMode, label: "Parranda väljer" },
    start:
      activePlannerMode === plannerManualMode
        ? await buildPlannerPoint("start")
        : { type: plannerAutoMode, label: "Parranda väljer" },
    end:
      activePlannerMode === plannerManualMode
        ? await buildPlannerPoint("end")
        : { type: plannerAutoMode, label: "Parranda väljer" },
    walking_km_target: Number(walkingKmTarget.value),
    leg_pacing: legPacingSelect?.value || "balanced",
    preferences,
    optimizer_mode: activeOptimizerMode,
    distance_mode: activeDistanceMode,
    budget_tier: activeBudgetTier,
    modifier: activeRouteModifier,
  };
  latestPlannerSnapshot = buildPlannerSnapshot(payload, dates);

  const response = await fetchJson(`${routeApiBase}/route-recommendations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  plannedDays = response.days || [];
  latestPlannerResolution = {
    homeBase: response.resolved_home_base || null,
    start: response.resolved_start || null,
    end: response.resolved_end || null,
  };
  routeRenderMode = plannedDays.length ? "api" : "fallback";
  activeRouteKey = null;
  activePlannedDate = plannedDays[0]?.date || null;
  liveEditionExpanded = plannedDays.length > 0;
  expandedAlternativeDates.clear();

  if (plannedDays.length) {
    activeLiveDate = plannedDays[0].date;
    await loadCityPulse(activeLiveDate);
  } else {
    activeLiveDate = routeDateFrom.value || getTodayIsoDate();
    await loadCityPulse(activeLiveDate);
  }

  renderRouteResults();

  if (!plannedDays.length) {
    latestPlannerResolution = null;
    updateRouteMatchSummary(
      "Ruttmotorn gav inga tydliga träffar för de valen, så de kuraterade alternativen ligger kvar som backup.",
    );
    setPlannerStatusMessage(
      "Jag hittade ingen riktigt stark live-rutt för de här valen, så backup-spåret ligger kvar.",
      "warning",
    );
    return;
  }

  setPlannerStatusMessage("");
  updatePlannerLaunchSummary(buildPlanningResultSummary(response));
  updateRouteMatchSummary(
    buildPlannerStyleSummary(
      buildPlanningResultSummary(response),
    ),
  );
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;

    filterButtons.forEach((item) => {
      item.classList.toggle("active", item.dataset.filter === activeFilter);
    });

    renderPlaces();
  });
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.tab);
  });
});

switchTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.switchTab);
    const scrollTarget =
      button.dataset.scrollTarget ||
      `[data-tab-panel="${button.dataset.switchTab}"]`;
    document.querySelector(scrollTarget)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
});

scrollButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.scroll);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

searchInput.addEventListener("input", renderPlaces);

plannerModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setPlannerMode(button.dataset.plannerMode);
  });
});

homeBaseModeSelect?.addEventListener("change", () => {
  if (activePlannerMode !== plannerAutoMode) {
    setPlannerMode(plannerAutoMode);
    return;
  }

  syncPlannerModeUI();
});

startModeSelect?.addEventListener("change", () => {
  if (activePlannerMode !== plannerManualMode) {
    setPlannerMode(plannerManualMode);
    return;
  }

  syncPlannerModeUI();
});

endModeSelect?.addEventListener("change", () => {
  if (activePlannerMode !== plannerManualMode) {
    setPlannerMode(plannerManualMode);
    return;
  }

  syncPlannerModeUI();
});

homeBaseCustomInput?.addEventListener("input", updatePlannerAdvancedSummary);
startCustomInput?.addEventListener("input", updatePlannerAdvancedSummary);
endCustomInput?.addEventListener("input", updatePlannerAdvancedSummary);
walkingKmTarget?.addEventListener("input", updateWalkingKmLabel);
distanceModeSelect?.addEventListener("change", () => {
  activeOptimizerMode = null;
  updateOptimizerButtons();
  updateDistanceModeUI();
});
legPacingSelect?.addEventListener("change", () => {
  updateLegPacingUI();
  updateRouteMatchSummary(buildPlannerStyleSummary());
});
optimizerButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyOptimizerMode(button.dataset.optimizerMode);
  });
});
budgetTierButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyBudgetTier(button.dataset.budgetTier);
  });
});
routeModifierButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyRouteModifier(button.dataset.routeModifier);
  });
});
preferenceInputs.forEach((input) => {
  input.addEventListener("change", () => {
    activeOptimizerMode = null;
    updateOptimizerButtons();
    updatePlannerLaunchSummary();
  });
});

routeDateFrom?.addEventListener("change", () => {
  if (routeDateTo.value && routeDateTo.value < routeDateFrom.value) {
    routeDateTo.value = routeDateFrom.value;
  }

  if (!plannedDays.length) {
    activeLiveDate = routeDateFrom.value || getTodayIsoDate();
    loadCityPulse(activeLiveDate);
  }

  updatePlannerLaunchSummary();
});

routeDateTo?.addEventListener("change", () => {
  if (routeDateFrom.value && routeDateTo.value && routeDateTo.value < routeDateFrom.value) {
    routeDateTo.value = routeDateFrom.value;
  }

  if (!plannedDays.length) {
    renderCityPulse();
  }

  updatePlannerLaunchSummary();
});

useCurrentPlaceAsHomeBaseButton?.addEventListener("click", () => {
  setPlannerFieldFromLabel("home_base", selectedPlaceName);
  switchTab("routes");
  updateRouteMatchSummary(
    `${selectedPlaceName} ligger nu som mjuk boendebas. Parranda bygger dagen runt den energin utan att låsa exakt start.`,
  );
});

useCurrentPlaceButton?.addEventListener("click", () => {
  setPlannerFieldFromLabel("start", selectedPlaceName);
  switchTab("routes");
  updateRouteMatchSummary(
    `${selectedPlaceName} ligger nu som startpunkt. Planera dagen när du vill.`,
  );
});

useMapAsEndButton?.addEventListener("click", () => {
  setPlannerFieldFromLabel("end", selectedPlaceName);
  updateRouteMatchSummary(
    `${selectedPlaceName} ligger nu som slutpunkt. Planera dagen när du vill.`,
  );
});

useGeolocationAsHomeBaseButton?.addEventListener("click", async () => {
  setPlannerMode(plannerAutoMode);
  homeBaseModeSelect.value = "current_location";
  syncPlannerModeUI();

  try {
    await ensureCurrentLocation();
    updateRouteMatchSummary(
      "Min plats används nu som mjuk boendebas. Om platsåtkomst inte fungerar väljer Parranda en smart bas i stället.",
    );
  } catch (error) {
    updateRouteMatchSummary(
      "Jag kunde inte läsa din plats just nu. Om du fortsätter väljer Parranda en smart boendebas i stället.",
    );
  }
});

useGeolocationButton?.addEventListener("click", async () => {
  setPlannerMode(plannerManualMode);
  startModeSelect.value = "current_location";
  syncPlannerModeUI();

  try {
    await ensureCurrentLocation();
    updateRouteMatchSummary(
      "Min plats är nu vald som startpunkt. Om platsåtkomst inte fungerar väljer Parranda en smart start i stället.",
    );
  } catch (error) {
    updateRouteMatchSummary(
      "Jag kunde inte läsa din plats just nu. Om du fortsätter väljer Parranda en smart start i stället.",
    );
  }
});

routePlannerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  startPlannerLoadingCycle();
  updateRouteMatchSummary(
    buildPlannerStyleSummary(
      "Planerar dagar utifrån datum, gångmål, väder, live-events och dina preferenser...",
    ),
  );

  try {
    await planRoutes();
    closePlannerModal();
    focusPlannerResults();
  } catch (error) {
    routeRenderMode = "fallback";
    plannedDays = [];
    activePlannedDate = null;
    latestPlannerResolution = null;
    liveEditionExpanded = false;
    expandedAlternativeDates.clear();
    renderRouteResults();
    setRouteApiStatus(false);
    closePlannerModal();
    focusPlannerResults();
    updateRouteMatchSummary(
      "Något gick fel i live-läget, så appen föll tillbaka till de kuraterade Rom-rutterna.",
    );
    setPlannerStatusMessage(
      "Något gick fel medan dagen räknades ut, så Parranda föll tillbaka till curated-läget.",
      "error",
    );
  } finally {
    setPlannerLoadingState(false);
  }
});

routePlanStickyButton?.addEventListener("click", () => {
  routePlannerForm?.requestSubmit();
});

routeResetButton?.addEventListener("click", () => {
  setPlannerDefaults();
  setPlannerStatusMessage("");
  liveEditionExpanded = false;
  activeLiveDate = routeDateFrom.value || getTodayIsoDate();
  loadCityPulse(activeLiveDate);
  routeRenderMode = "fallback";
  plannedDays = [];
  activePlannedDate = null;
  activeRouteKey = null;
  expandedAlternativeDates.clear();
  clearRouteOverlay();
  renderRouteResults();
  updateRouteMatchSummary(
    "Planeraren är nollställd. Parranda får nu välja start och slut smart igen, och de kuraterade rutterna visas som backup.",
  );
});

districtSetStartButton?.addEventListener("click", () => {
  const guide = getActiveDistrictGuide();
  applyDistrictGuidePreset("start");
  switchTab("routes");
  openPlannerModal();
  updateRouteMatchSummary(
    `${guide.startLabel} ligger nu som startpunkt. Kombinera gärna med egen slutpunkt eller låt samma kvarter bli final också.`,
  );
});

districtSetEndButton?.addEventListener("click", () => {
  const guide = getActiveDistrictGuide();
  applyDistrictGuidePreset("end");
  switchTab("routes");
  openPlannerModal();
  updateRouteMatchSummary(
    `${guide.endLabel} ligger nu som slutpunkt. Bra om du vill låta resten av dagen byggas fram mot just den energin.`,
  );
});

districtPlanButton?.addEventListener("click", () => {
  planFromCurrentDistrictGuide();
});

districtMapButton?.addEventListener("click", () => {
  focusDistrictGuideOnMap();
});

heroWildcardApplyButton?.addEventListener("click", async () => {
  const wildcard = getActiveHeroWildcard();

  if (!wildcard) {
    return;
  }

  await applyWildcardToPlanner(wildcard, {
    autoPlan: true,
  });
});

heroWildcardShuffleButton?.addEventListener("click", () => {
  shuffleHeroWildcard();
});

heroPlannerButton?.addEventListener("click", () => {
  openPlannerModal();
});

routePlannerOpenButton?.addEventListener("click", () => {
  openPlannerModal();
});

closePlannerModalButton?.addEventListener("click", () => {
  closePlannerModal();
});

plannerModalBackdrop?.addEventListener("click", () => {
  closePlannerModal();
});

heroLiveButton?.addEventListener("click", async () => {
  switchTab("routes");
  closePlannerModal();
  await openLiveEdition({ scroll: true });
});

cityPulseTeaserButton?.addEventListener("click", async () => {
  await openLiveEdition({ scroll: true });
});

showFavoritesButton.addEventListener("click", () => {
  onlyFavorites = true;
  switchTab("overview");
  renderPlaces();
  updateFavoritesUI();
});

showAllButton.addEventListener("click", () => {
  onlyFavorites = false;
  switchTab("overview");
  renderPlaces();
  updateFavoritesUI();
});

mapFavoriteButton.addEventListener("click", () => {
  if (!mapFavoriteButton.dataset.place) {
    return;
  }

  toggleFavorite(mapFavoriteButton.dataset.place);
  refreshMarkerStyles();
});

closePlaceDrawerButton?.addEventListener("click", closePlaceDrawer);
placeDrawerBackdrop?.addEventListener("click", closePlaceDrawer);
closeRouteGuideButton?.addEventListener("click", closeRouteGuide);
routeGuideBackdrop?.addEventListener("click", closeRouteGuide);
routeGuidePrintButton?.addEventListener("click", printRouteGuide);
routeGuideShareButton?.addEventListener("click", async () => {
  try {
    await shareRouteGuide();
  } catch (_error) {
    updateRouteMatchSummary(
      "Guiden gick inte att dela just nu, men den ligger kvar öppen och kan fortfarande sparas som PDF.",
    );
  }
});
placeDrawerStartButton?.addEventListener("click", () => {
  const plannerLabel = activeDrawerItem?.label;

  if (!applyDrawerItemToPlanner("start")) {
    return;
  }

  switchTab("routes");
  closePlaceDrawer();
  openPlannerModal();
  updateRouteMatchSummary(
    buildPlannerStyleSummary(
      `${plannerLabel} ligger nu som startpunkt. Bygg vidare med egen slutpunkt eller låt Parranda hitta en stark final.`,
    ),
  );
});

placeDrawerEndButton?.addEventListener("click", () => {
  const plannerLabel = activeDrawerItem?.label;

  if (!applyDrawerItemToPlanner("end")) {
    return;
  }

  switchTab("routes");
  closePlaceDrawer();
  openPlannerModal();
  updateRouteMatchSummary(
    buildPlannerStyleSummary(
      `${plannerLabel} ligger nu som slutpunkt. Bra om du vill låta dagen landa i just den här känslan.`,
    ),
  );
});

placeDrawerPlanButton?.addEventListener("click", async () => {
  await planFromDrawerItem();
});

placeDrawerMapButton?.addEventListener("click", () => {
  if (!activeDrawerItem) {
    return;
  }

  switchTab("overview");
  window.setTimeout(() => {
    if (activeDrawerItem.best_route_id && activeDrawerItem.best_route_date) {
      focusLiveEventOnMap(activeDrawerItem);
      return;
    }

    const markerExists = markers.has(activeDrawerItem.label);
    if (markerExists) {
      focusPlaceOnMap(activeDrawerItem.label);
    } else {
      showLoosePointOnMap(activeDrawerItem);
      document
        .querySelector(".map-explorer")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 80);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && routePlannerStart && !routePlannerStart.hidden) {
    closePlannerModal();
    return;
  }

  if (event.key === "Escape" && routeGuideDrawer && !routeGuideDrawer.hidden) {
    closeRouteGuide();
    return;
  }

  if (event.key === "Escape" && placeDrawer && !placeDrawer.hidden) {
    closePlaceDrawer();
  }
});

window.addEventListener("afterprint", () => {
  document.body.classList.remove("is-printing-guide");
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButtonVisibility();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallButtonVisibility();
});

installButton?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  updateInstallButtonVisibility();
});

renderSpotlights();
renderPlaces();
renderDistrictGuide();
setPlannerDefaults();
loadCityPulse(routeDateFrom.value || getTodayIsoDate());
renderSavedRoutes();
renderRouteResults();
updateFavoritesUI();
initMap();
refreshMarkerStyles();
updateInstallButtonVisibility();
registerServiceWorker();
loadPlannerOptions().then(() => {
  syncPlannerModeUI();
  updateWalkingKmLabel();
  renderRouteResults();
});
