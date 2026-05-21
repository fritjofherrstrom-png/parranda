const romePlaces = [
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

const romeTrastevereBars = [
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

const romeTrastevereDay = [
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

const romeDistrictGuides = [
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
    stopCards: romeTrastevereBars,
    dayStops: romeTrastevereDay,
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

const romeDistrictGuideLocalizedContent = {
  monti: {
    eyebrow: { en: "MONTI MODE" },
    title: {
      en: "Monti for a cultural start, a wine-led finish, and a better late night",
    },
    description: {
      en: "Monti works best when you use it as a smart stage for churches, long glasses, and an evening that can stay low-key or stretch late without losing direction.",
    },
    selectorNote: {
      en: "Central, culture-friendly, and better than its reputation if you choose carefully.",
    },
    mapFocus: {
      summary: {
        en: "A central district for wine, culture, and a stronger evening shape.",
      },
      long_description: {
        en: "Monti works best when you pick the right side streets, let churches and piazzas give the day its rhythm, and save the showier stops for later.",
      },
    },
    stats: [
      { label: { en: "smart stops" } },
      { label: { en: "compact full day" } },
      { label: { en: "culture + wine + night" } },
    ],
    stopsTitle: {
      en: "Monti when it should feel smart, not just central",
    },
    stopsNote: {
      en: "Build Monti around real anchors and better glasses, not the most over-photographed corners.",
    },
    dayTitle: {
      en: "A Monti day with mosaics, piazza aperitivo, and a late cocktail finish",
    },
    dayNote: {
      en: "A quiet room in the morning, the piazza later in the day, and an evening choice depending on whether you want to keep it wine-led or go bigger.",
    },
    actionTitle: {
      en: "Monti works perfectly as both start and finish when you want to keep the day tight",
    },
    actionCopy: {
      en: "Set Monti as your planner base if you want the day to feel central while still staying curated, evening-friendly, and clear.",
    },
    stopCards: [
      {
        description: {
          en: "One of the best cultural stops in the area if you want to begin with something quiet, golden, and genuinely memorable.",
        },
        focus: { en: "Go here: as your first cultural anchor" },
        why: {
          en: "It gives the day depth straight away without needing half a day in a museum.",
        },
        time: { en: "Best: morning" },
      },
      {
        description: {
          en: "A smart stop when you want to give Monti a little more historical weight while still keeping the day walkable.",
        },
        focus: { en: "Go here: before lunch or on a rainy day" },
        why: {
          en: "A good counterweight if the rest of the day is going to lean more toward wine and evening energy.",
        },
        time: { en: "Best: daytime" },
      },
      {
        description: {
          en: "Not to stay all night, but to give the area a natural middle ground between culture and the first glass.",
        },
        focus: { en: "Go here: around your first aperitivo" },
        why: {
          en: "A smart meeting ground where you can feel whether the evening should grow or stay soft.",
        },
        time: { en: "Best: late afternoon" },
      },
      {
        description: {
          en: "Perhaps Monti’s safest wine anchor if you want the glass to set the pace without the evening turning stiff.",
        },
        focus: { en: "Order: wine and small plates" },
        why: {
          en: "Perfect if you want Monti to feel more low-key, grown-up, and conversation-friendly.",
        },
        time: { en: "Best: early evening" },
      },
      {
        description: {
          en: "A clear evening move when Monti should shift from wine-led district to more of a destination and more of a night out.",
        },
        focus: { en: "Order: a cocktail or something darker late" },
        why: {
          en: "A good choice when you want the evening to feel more like a program than just a walk.",
        },
        time: { en: "Best: evening to late" },
      },
      {
        description: {
          en: "For when you really do want to let Monti pull you into something more intense and cocktail-driven.",
        },
        focus: { en: "Order: a signature drink and book smart" },
        why: {
          en: "Right when you want to end on something bigger than a normal last glass.",
        },
        time: { en: "Best: late" },
      },
    ],
    dayStops: [
      {
        label: { en: "Culture start" },
        title: { en: "Santa Prassede first, Monti after" },
        description: {
          en: "Start the day with mosaics and calm before Monti wakes up as a district.",
        },
        note: {
          en: "It makes the rest of the day feel smarter, not just more central.",
        },
      },
      {
        label: { en: "Soft continuation" },
        title: { en: "San Pietro in Vincoli and the side streets back down" },
        description: {
          en: "Add a second cultural stop if you want the weight, otherwise let the walk itself carry the rhythm between church and lunch.",
        },
        note: { en: "The point is rhythm, not maximum box-ticking." },
      },
      {
        label: { en: "Lunch" },
        title: { en: "A long lunch in Monti" },
        description: {
          en: "Take lunch on a side street and let the area feel lived in rather than staged.",
        },
        note: { en: "Save the showier stops for later." },
      },
      {
        label: { en: "Aperitivo" },
        title: { en: "Piazza della Madonna dei Monti" },
        description: {
          en: "Let the piazza set the tone for the evening before you decide whether the day should turn more wine-led or more night-driven.",
        },
        note: { en: "A good moment to read the group’s energy." },
      },
      {
        label: { en: "Wine anchor" },
        title: { en: "Ai Tre Scalini" },
        description: {
          en: "This is how you do Monti right if you want to keep it warm, local, and glass-led.",
        },
        note: { en: "A strong main stop before any cocktail finale." },
      },
      {
        label: { en: "Final scene" },
        title: { en: "Blackmarket Hall or Drink Kong" },
        description: {
          en: "End depending on whether the night should feel darker and more lounge-like or more like a straight cocktail mission.",
        },
        note: { en: "Monti works best when you do not force every mood at once." },
      },
    ],
  },
  trastevere: {
    eyebrow: { en: "TRASTEVERE MODE" },
    title: {
      en: "Genuine bars, a long evening, and the right Trastevere day",
    },
    description: {
      en: "Trastevere is still strong, but now as one of several district guides. The focus here is beer, wine, culture, and nightlife without the district feeling performative.",
    },
    selectorNote: {
      en: "Genuine bars, a classic late-night finish, and the easiest path to noisy energy.",
    },
    mapFocus: {
      summary: { en: "An evening hub for wine, beer, side streets, and a safe finish." },
      long_description: {
        en: "Trastevere works best as an evening district, a return point, and a safe card when you want the day to end with a real bar finish.",
      },
    },
    stats: [
      { label: { en: "strong bar pulls" } },
      { label: { en: "full day on foot" } },
      { label: { en: "evening pulse" } },
    ],
    stopsTitle: {
      en: "High, low, and above all genuinely local",
    },
    stopsNote: {
      en: "The focus is on stops that work for beer, wine, and nightlife without feeling like pure tourist scenery.",
    },
    dayTitle: {
      en: "A full Trastevere day for beer, wine, culture, and night",
    },
    dayNote: {
      en: "A later start, lots of walking, no stressful transfers, and a curve that gets better as it gets darker.",
    },
    actionTitle: {
      en: "Trastevere is best when you want to give the whole day a safe but lively finish",
    },
    actionCopy: {
      en: "Use the district as your start, your finish, or both if you want the route to land in an area that can carry wine, beer, and late turns.",
    },
  },
  "testaccio-ostiense": {
    eyebrow: { en: "SOUTH ROME MODE" },
    title: {
      en: "Food anchors, industrial culture, and glasses that feel more local than central",
    },
    description: {
      en: "Testaccio and Ostiense are the southern track when the day should be driven by food, industrial culture, and better beer and wine stops than postcard Rome.",
    },
    selectorNote: {
      en: "Food-led, lively, and best when you want to leave the central scenery behind.",
    },
    mapFocus: {
      summary: {
        en: "South Rome for food, beer, industrial culture, and a better local rhythm.",
      },
      long_description: {
        en: "Start in Testaccio if you want the day to build around real food and move toward Ostiense when the evening should become more beer- or wine-focused.",
      },
    },
    stats: [
      { label: { en: "safe southern stops" } },
      { label: { en: "natural south loop" } },
      { label: { en: "best stretch" } },
    ],
    stopsTitle: {
      en: "South Rome when food and local rhythm should carry the day",
    },
    stopsNote: {
      en: "This day plays best if you accept that market food, industrial atmosphere, and good glasses are stronger than classic sightseeing obligations.",
    },
    dayTitle: { en: "Testaccio to Ostiense done right" },
    dayNote: {
      en: "Let lunch carry real weight, the afternoon turn cultural, and the evening lean on good beer, natural wine, or pizza without rushing.",
    },
    actionTitle: {
      en: "This is the move for anyone who wants Rome to feel more everyday and less postcard",
    },
    actionCopy: {
      en: "Send Testaccio and Ostiense into the planner if you want a day that is strong on food, evening energy, and local feel rather than classic photo points.",
    },
    stopCards: [
      {
        description: {
          en: "Start here if you want the day to get a real Roman food base without tourist theatre.",
        },
        focus: { en: "Order: lunch or smart small stops" },
        why: {
          en: "One of the best ways to make South Rome legible from the first hour.",
        },
        time: { en: "Best: lunch" },
      },
      {
        description: {
          en: "It gives the area a rougher cultural anchor that makes the day feel contemporary and less predictable.",
        },
        focus: { en: "Go here: after lunch or in the rain" },
        why: {
          en: "A good choice when you want culture to feel smarter than yet another classic museum.",
        },
        time: { en: "Best: daytime" },
      },
      {
        description: {
          en: "One of the city’s most surprising cultural collisions, with sculpture and power-station aesthetics in the same room.",
        },
        focus: { en: "Go here: as an extra culture track" },
        why: {
          en: "Perfect if the day needs a real wow without becoming touristy.",
        },
        time: { en: "Best: afternoon" },
      },
      {
        description: {
          en: "Comfortably unpolished and a very strong stop when you want to shift from food focus to glass focus without losing local feel.",
        },
        focus: { en: "Order: beer or wine depending on mood" },
        why: { en: "A good midpoint between Testaccio and Ostiense." },
        time: { en: "Best: early evening" },
      },
      {
        description: {
          en: "A smarter beer stop in Ostiense when the evening should become more specialized without losing warmth.",
        },
        focus: { en: "Order: draft beer and stay longer than planned" },
        why: {
          en: "Perfect if beer is genuinely part of why you are here.",
        },
        time: { en: "Best: evening" },
      },
      {
        description: {
          en: "When a southern day deserves a real food anchor people actually go out of their way for.",
        },
        focus: { en: "Order: pizza and book smart if you can" },
        why: { en: "Strong when the evening should be both food-led and social." },
        time: { en: "Best: dinner time" },
      },
    ],
    dayStops: [
      {
        label: { en: "Start" },
        title: { en: "Testaccio Market" },
        description: {
          en: "Start with lunch or smart small stops in the market so the day gets a real base straight away.",
        },
        note: {
          en: "South Rome works best when food is allowed to be the first headline.",
        },
      },
      {
        label: { en: "Culture" },
        title: { en: "Mattatoio or Centrale Montemartini" },
        description: {
          en: "Choose rough industrial culture or a power-station museum depending on how much depth you want to add.",
        },
        note: {
          en: "Both make the day far more memorable than a simple lunch-to-bar loop.",
        },
      },
      {
        label: { en: "Middle rhythm" },
        title: { en: "Walk via Piramide toward Ostiense" },
        description: {
          en: "Let the walk carry you between the southern districts instead of jumping straight to evening mode.",
        },
        note: { en: "The transition is what keeps the evening from feeling pasted on." },
      },
      {
        label: { en: "First glass" },
        title: { en: "L'Oasi della Birra" },
        description: {
          en: "A perfect first evening stop if the group is split between beer, wine, and simply good atmosphere.",
        },
        note: {
          en: "A good place to decide whether to stay south the whole night.",
        },
      },
      {
        label: { en: "Evening" },
        title: { en: "Latta or Da Remo" },
        description: {
          en: "Now you choose whether the evening should become more beer-centered or more pizza-heavy with steady local energy.",
        },
        note: { en: "The beauty here is that both choices feel right." },
      },
      {
        label: { en: "Final" },
        title: { en: "Stay in Ostiense or drift back slowly" },
        description: {
          en: "End where the energy feels strongest, not where the map says it is most central.",
        },
        note: { en: "South Rome rewards anyone who is not rushing back." },
      },
    ],
  },
  "pigneto-san-lorenzo": {
    eyebrow: { en: "EAST SIDE MODE" },
    title: {
      en: "A creative evening loop, cheaper glasses, and more social energy",
    },
    description: {
      en: "Pigneto and San Lorenzo are right when you want younger energy, bars with less filter, and an eastern Rome that feels lived rather than served.",
    },
    selectorNote: {
      en: "Less polished and best when you want more people than finish.",
    },
    mapFocus: {
      summary: {
        en: "East Rome for creative pulse, late glasses, and less polished districts.",
      },
      long_description: {
        en: "San Lorenzo works as the rougher warm-up and Pigneto as the more creative finish when the evening should feel social and locally grounded.",
      },
    },
    stats: [
      { label: { en: "strong evening stops" } },
      { label: { en: "east-side evening setup" } },
      { label: { en: "friendlier budget" } },
    ],
    stopsTitle: {
      en: "East Rome when you want creative pulse rather than scenery",
    },
    stopsNote: {
      en: "This area works best when you accept a little more noise, a little less polish, and much more actual evening energy.",
    },
    dayTitle: { en: "San Lorenzo to Pigneto without losing the thread" },
    dayNote: {
      en: "Start in a rougher tempo, build in one or two real glass stops, and let Pigneto take over when the evening properly begins.",
    },
    actionTitle: {
      en: "This move is strong for party, budget-smart beer, and social flow",
    },
    actionCopy: {
      en: "Choose San Lorenzo to Pigneto in the planner if you want the app to give you a clearer eastern evening than the standard central tracks.",
    },
    stopCards: [
      {
        description: {
          en: "Rougher, more student-heavy, and better than its first impression if you want cheaper glasses and more actual locals.",
        },
        focus: { en: "Go here: for the warm-up and first beer" },
        why: { en: "A good start when the group wants to feel like the evening is already underway." },
        time: { en: "Best: early evening" },
      },
      {
        description: {
          en: "Not the prettiest square in the city, but very useful as an easy meeting point before you split up or drift onward.",
        },
        focus: { en: "Go here: as a natural meeting point" },
        why: { en: "Useful with a group when the evening needs a simple first floor." },
        time: { en: "Best: evening" },
      },
      {
        description: {
          en: "One of the clearest districts when you want to leave postcard Rome behind and let the evening turn freer.",
        },
        focus: { en: "Go here: when the main evening should begin" },
        why: { en: "Pigneto carries several kinds of evenings without losing its personality." },
        time: { en: "Best: late afternoon to late" },
      },
      {
        description: {
          en: "One of the best stops when you want to give Pigneto some shape without making it feel too polished.",
        },
        focus: { en: "Order: wine or a lighter drink" },
        why: { en: "A good bridge between a softer start and a later bar run." },
        time: { en: "Best: late afternoon" },
      },
      {
        description: {
          en: "Wine-led, creative, and perfect if you want the night to keep a slightly more curated line in the middle of all the social energy.",
        },
        focus: { en: "Order: by the glass and stay a while" },
        why: { en: "A very good stop if the group wants to keep the quality level high." },
        time: { en: "Best: evening" },
      },
    ],
    dayStops: [
      {
        label: { en: "Warm-up" },
        title: { en: "San Lorenzo first" },
        description: {
          en: "Start in the rougher district with the first beer or a simple glass where evening energy already exists.",
        },
        note: { en: "A good way to keep Pigneto from feeling spent too early." },
      },
      {
        label: { en: "Meeting ground" },
        title: { en: "Piazza dei Sanniti" },
        description: {
          en: "Gather the group, read the mood, and decide whether the evening should get more budget-smart or more wine-led.",
        },
        note: { en: "It does not have to be beautiful to be functional." },
      },
      {
        label: { en: "Transition" },
        title: { en: "Walk or short hop toward Pigneto" },
        description: {
          en: "Move east when the evening actually needs to begin, not before.",
        },
        note: { en: "The rhythm between the districts is half the point." },
      },
      {
        label: { en: "First proper stop" },
        title: { en: "Necci dal 1924" },
        description: {
          en: "Let Necci give the evening some shape before it turns fully fluid.",
        },
        note: { en: "Perfect if you want to ease into Pigneto." },
      },
      {
        label: { en: "Wine curve" },
        title: { en: "Bottiglieria Pigneto" },
        description: {
          en: "Take a more curated turn before deciding whether the night should stay there or drift onward.",
        },
        note: { en: "A strong counterweight to pure party energy." },
      },
      {
        label: { en: "Late scene" },
        title: { en: "Pigneto side streets" },
        description: {
          en: "Finish where the energy feels strongest. In this area the district itself can be the last stop.",
        },
        note: { en: "East Rome is best when you stop chasing the perfect backdrop." },
      },
    ],
  },
};

const romeRoutes = [
  {
    id: "classic-loop",
    title: "Trastevere -> Ghetto -> Monti -> Colosseum -> Trastevere",
    vibe: "Klassiker utan stress",
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

const romeRouteLocalizedContent = {
  "classic-loop": {
    vibe: { en: "classic without the stress" },
    length: { en: "about 10 km" },
    anchor: { en: "Anchor: Colosseum by night + San Clemente" },
    walk: { en: "Start/end in Trastevere, calm full day" },
    summary: {
      en: "For anyone who wants one big Rome anchor while the rest of the day still feels human, bar-friendly, and much more local than touristic.",
    },
    path: {
      en: "Start: coffee in Trastevere • End: wine or beer back in Trastevere",
    },
    stops: [
      { en: "10:30 Start in Trastevere with a calm coffee and your first turn through the side streets." },
      { en: "11:30 Cross the river via Isola Tiberina and take the smart path through the Ghetto instead of walking straight into the tourist current." },
      { en: "13:00 Put lunch and side streets in Monti, where the day still feels light and open." },
      { en: "15:00 Step into San Pietro in Vincoli or, even better, San Clemente if you want to give the day a real church anchor." },
      { en: "17:30 Take a first glass around Monti before the evening pulse really starts to rise." },
      { en: "20:30 See the Colosseum only after the light has softened, then walk home slowly toward Trastevere again." },
    ],
    hiddenMentions: [
      { en: "Isola Tiberina" },
      { en: "Teatro di Marcello" },
      { en: "San Clemente" },
      { en: "Monti backstreets" },
    ],
    barMentions: [
      { en: "aperitivo around Via del Boschetto" },
      { en: "Freni e Frizioni on the way home" },
      { en: "Les Vignerons as a calm final stop" },
    ],
    matcherPitch: {
      en: "This day works best when you want a classic Rome moment but still land back in Trastevere with the right evening feeling.",
    },
  },
  "south-loop": {
    vibe: { en: "food + local energy" },
    length: { en: "about 9 km" },
    anchor: { en: "Anchor: Giardino degli Aranci + Testaccio" },
    walk: { en: "Southern loop with many natural pauses" },
    summary: {
      en: "This is the day for anyone who wants viewpoints, market food, South Rome, and an evening that feels more district than set design.",
    },
    path: {
      en: "Start: early Trastevere walk • End: wine bar or beer back across the river",
    },
    stops: [
      { en: "10:30 Start in Trastevere and walk south toward the Aventine before the city gets too warm and dense." },
      { en: "11:15 Take in Giardino degli Aranci and let the view set the day’s first tone." },
      { en: "12:30 Head down toward Testaccio and make lunch a real food anchor in or around the market." },
      { en: "15:00 Continue via Piramide and the Non-Catholic Cemetery or go straight toward Ostiense depending on mood." },
      { en: "17:00 Put aperitivo or an early glass in Ostiense as the district starts to pick up evening energy." },
      { en: "20:00 Walk slowly back to Trastevere for dinner and then choose the bar by how much night you still want left." },
    ],
    hiddenMentions: [
      { en: "Santa Sabina" },
      { en: "Non-Catholic Cemetery" },
      { en: "Piramide" },
      { en: "Centrale Montemartini" },
    ],
    barMentions: [
      { en: "L'Antidoto after you get back" },
      { en: "Bar San Calisto if you want more noise" },
      { en: "one last glass in Ostiense before turning home" },
    ],
    matcherPitch: {
      en: "Choose this when you want food, southern districts, and a day that already feels local by lunch.",
    },
  },
  "centro-wine-loop": {
    vibe: { en: "wine, churches, and centro done right" },
    length: { en: "about 8 km" },
    anchor: { en: "Anchor: Navona late + a church loop in the center" },
    walk: { en: "Central day without stress or detours" },
    summary: {
      en: "Perfect if you want something more central while still building the day around beautiful rooms, smart churches, slow food, and bars only when the time is right.",
    },
    path: {
      en: "Start: Trastevere before the noise • End: back across Ponte Sisto to the bars",
    },
    stops: [
      { en: "10:45 Start in Trastevere and cross the river over Ponte Sisto before Campo de' Fiori gets at its loudest." },
      { en: "12:00 Add the first church of the day, ideally Sant'Agostino or Santa Maria sopra Minerva depending on how far you want to walk." },
      { en: "13:30 Have lunch in the Parione or Navona area, but on side streets rather than right on the square." },
      { en: "16:00 Continue with a second cultural pause or a first glass of wine in the center as the pace settles." },
      { en: "19:30 See Piazza Navona only in the evening and use it as a mood anchor, not the whole activity." },
      { en: "22:00 Walk back to Trastevere for the real bar finale once the center begins to feel done." },
    ],
    hiddenMentions: [
      { en: "Ponte Sisto in the right light" },
      { en: "Sant'Agostino" },
      { en: "Santa Maria sopra Minerva" },
      { en: "the side streets around Parione" },
    ],
    barMentions: [
      { en: "Freni e Frizioni when you are back" },
      { en: "Enoteca Ferrara if dinner should slide into wine" },
      { en: "Bar San Calisto if you want a livelier ending" },
    ],
    matcherPitch: {
      en: "This is the right day when you want the center without feeling like you simply followed the main current all the way through.",
    },
  },
  "gianicolo-borgo-loop": {
    vibe: { en: "scenic and slow" },
    length: { en: "about 9 km" },
    anchor: { en: "Anchor: Gianicolo + Castel Sant'Angelo" },
    walk: { en: "A lot of walking, but low stress" },
    summary: {
      en: "For anyone who wants views, culture, and a slow day that feels almost cinematic, while still ending in Trastevere with the right kind of nightlife.",
    },
    path: {
      en: "Start: Trastevere’s quiet morning • End: Bar San Calisto, Ma Che, or Les Vignerons",
    },
    stops: [
      { en: "10:30 Start in Trastevere and add Villa Farnesina or the Museum of Rome in Trastevere if you want to begin with real culture." },
      { en: "12:00 Climb toward Gianicolo and Fontanone while the light is still working for you." },
      { en: "14:00 Head down toward Borgo or Prati for lunch and a pause from the denser parts of the center." },
      { en: "16:30 Let Castel Sant'Angelo become the day’s big scenic anchor, ideally without getting stuck there too long." },
      { en: "18:30 Start walking home over the bridge and choose whether the evening should slow down or gather speed." },
      { en: "21:00 Back in Trastevere, choose your bar depending on whether the night should mean wine, beer, or just more noise." },
    ],
    hiddenMentions: [
      { en: "Villa Farnesina" },
      { en: "Fontanone" },
      { en: "quiet streets in Borgo" },
      { en: "Ponte Vittorio on the way home" },
    ],
    barMentions: [
      { en: "Ma Che Siete Venuti a Fà for beer" },
      { en: "Les Vignerons for a calmer wine ending" },
      { en: "Bar San Calisto for the last burst of energy" },
    ],
    matcherPitch: {
      en: "This is the best day when you want the city to feel large and beautiful while still landing back in Trastevere before the last glass of the night.",
    },
  },
};

function getFrontendFallbackRoutes() {
  return hasRomeFrontendContent
    ? localizeContentCollection(romeRoutes, romeRouteLocalizedContent)
    : [];
}

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
const heroEyebrow = document.getElementById("heroEyebrow");
const heroHeadline = document.getElementById("heroHeadline");
const heroLead = document.getElementById("heroLead");
const heroPlannerButton = document.getElementById("heroPlannerButton");
const heroLiveButton = document.getElementById("heroLiveButton");
const tabNav = document.querySelector(".tab-nav");
const overviewTabButton = document.querySelector('[data-tab="overview"]');
const districtsTabButton = document.querySelector('[data-tab="districts"]');
const overviewPanel = document.querySelector('[data-tab-panel="overview"]');
const districtsPanel = document.querySelector('[data-tab-panel="districts"]');
const heroBlitzLabel = document.getElementById("heroBlitzLabel");
const heroBlitzTitle = document.getElementById("heroBlitzTitle");
const heroBlitzSummary = document.getElementById("heroBlitzSummary");
const heroBlitzMeta = document.getElementById("heroBlitzMeta");
const heroBlitzFollowup = document.getElementById("heroBlitzFollowup");
const heroBlitzTags = document.getElementById("heroBlitzTags");
const heroBlitzApplyButton = document.getElementById("heroBlitzApplyButton");
const heroBlitzShuffleButton = document.getElementById("heroBlitzShuffleButton");
const heroBlitzOriginSwitch = document.getElementById("heroBlitzOriginSwitch");
const heroBlitzSelectedOriginButton = document.getElementById("heroBlitzSelectedOriginButton");
const heroBlitzCurrentOriginButton = document.getElementById("heroBlitzCurrentOriginButton");
const heroBlitzCard = document.querySelector(".hero-idea-strip");
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
const cityPulseLiveChip = cityPulseStart?.querySelector(".city-pulse-live") || null;
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
const routePlannerManualButton = document.getElementById("routePlannerManualButton");
const plannerRestoreNotice = document.getElementById("plannerRestoreNotice");
const plannerRestoreSummary = document.getElementById("plannerRestoreSummary");
const plannerRestoreButton = document.getElementById("plannerRestoreButton");
const plannerRestoreDismissButton = document.getElementById("plannerRestoreDismissButton");
const closePlannerModalButton = document.getElementById("closePlannerModalButton");
const plannerModalBackdrop = document.getElementById("plannerModalBackdrop");
const plannerModalTitle = document.getElementById("plannerModalTitle");
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
const districtStopTemplate = document.getElementById("districtStopTemplate");
const timelineStopTemplate = document.getElementById("timelineStopTemplate");
const routeCardTemplate = document.getElementById("routeCardTemplate");
const plannerDayTemplate = document.getElementById("plannerDayTemplate");
const activeDayRouteTemplate = document.getElementById("activeDayRouteTemplate");
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
function humanizeCityKey(cityKey) {
  const normalized = normalizeText(cityKey || "");

  if (!normalized) {
    return "";
  }

  if (normalized === "rome") {
    return "Rom";
  }

  return normalized
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getFrontendCityConfig() {
  const bootstrap = window.__PARRANDA_CITY__ || {};
  const bodyKey = normalizeText(document.body?.dataset.cityKey?.trim() || bootstrap.key || "rome") || "rome";
  const bodyLabel =
    document.body?.dataset.cityLabel?.trim() || bootstrap.displayLabel || bootstrap.label || "Staden";
  const key = normalizeText(bootstrap.key || bodyKey || "rome") || "rome";
  const requestedKey = normalizeText(bootstrap.requestedKey || "");

  return {
    key,
    label: bodyLabel,
    resolvedLabel: bootstrap.label || bodyLabel,
    visibility: bootstrap.visibility || "public",
    timezone: bootstrap.timezone || "UTC",
    locale: bootstrap.locale || "sv-SE",
    currency: bootstrap.currency || "EUR",
    center: bootstrap.center || null,
    searchLabel: bootstrap.searchLabel || bodyLabel,
    requestedKey,
    fallbackUsed: Boolean(bootstrap.fallbackUsed),
  };
}

const plannerCity = getFrontendCityConfig();
const plannerCityKey = plannerCity.key;
const plannerCityLabel = plannerCity.label;
const plannerResolvedCityLabel = plannerCity.resolvedLabel || plannerCityLabel;
const plannerCitySearchLabel = plannerCity.searchLabel || plannerCityLabel;
const plannerCityVisibility = plannerCity.visibility || "public";
const plannerRequestedCityKey = plannerCity.requestedKey || "";
const plannerRequestedCityLabel = humanizeCityKey(plannerRequestedCityKey);
const isPreviewCityMode = plannerCityVisibility === "preview";
const isFallbackRequestedCity =
  Boolean(plannerCity.fallbackUsed) &&
  Boolean(plannerRequestedCityKey) &&
  plannerRequestedCityKey !== plannerCityKey;
const isCuratedPublicMode =
  !plannerCity.fallbackUsed && plannerCityVisibility !== "internal" && !isPreviewCityMode;
const hasRomeFrontendContent = isCuratedPublicMode && plannerCityKey === "rome";
const isRomeCuratedMode = hasRomeFrontendContent;
const isInternalCityMode = plannerCityVisibility === "internal";
const plannerDisplayCityLabel = plannerCityLabel || plannerRequestedCityLabel || plannerResolvedCityLabel || "Staden";
const plannerTimeZone = plannerCity.timezone;
const plannerLocale = plannerCity.locale;
const uiI18nBootstrap =
  window.__PARRANDA_I18N__ && typeof window.__PARRANDA_I18N__ === "object"
    ? window.__PARRANDA_I18N__
    : { fallbackLanguage: "sv", supportedLanguages: ["sv", "en"], translations: { sv: {}, en: {} } };
const fallbackUiLanguage = String(uiI18nBootstrap.fallbackLanguage || "sv").toLowerCase();
const supportedUiLanguages = new Set(
  Array.isArray(uiI18nBootstrap.supportedLanguages) && uiI18nBootstrap.supportedLanguages.length
    ? uiI18nBootstrap.supportedLanguages.map((lang) => String(lang).toLowerCase())
    : [fallbackUiLanguage],
);
const requestedUiLanguage = String(window.__PARRANDA_LANGUAGE__ || document.body?.dataset.lang || "").toLowerCase();
const activeUiLanguage = supportedUiLanguages.has(requestedUiLanguage) ? requestedUiLanguage : fallbackUiLanguage;
const isEnglishUi = activeUiLanguage === "en";
// Date formatting locale follows the UI language, never the city locale.
// A Swedish-UI visitor to Barcelona must see "Onsdag 21 maj" not "Miércoles 21 de mayo".
const uiDateLocale = activeUiLanguage === "en" ? "en-US" : "sv-SE";
const uiText =
  uiI18nBootstrap.translations && typeof uiI18nBootstrap.translations === "object"
    ? uiI18nBootstrap.translations
    : { sv: {}, en: {} };

function t(key, fallback = "") {
  return uiText[activeUiLanguage]?.[key] || uiText[fallbackUiLanguage]?.[key] || fallback || key;
}

function tf(key, replacements = {}, fallback = "") {
  return Object.entries(replacements).reduce(
    (text, [token, value]) => text.split(`{${token}}`).join(String(value)),
    t(key, fallback),
  );
}

function createLocalizedContent(sv, en) {
  return { sv, en };
}

function isLocalizedContentValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => key === "sv" || key === "en");
}

function readLocalizedContent(value, lang = activeUiLanguage) {
  if (!isLocalizedContentValue(value)) {
    return value;
  }

  return value[lang] ?? value[fallbackUiLanguage] ?? value.sv ?? value.en ?? "";
}

function mergeLocalizedContentOverlay(baseValue, overlayValue) {
  if (overlayValue === undefined) {
    return baseValue;
  }

  if (isLocalizedContentValue(overlayValue)) {
    return overlayValue;
  }

  if (Array.isArray(baseValue) && Array.isArray(overlayValue)) {
    return baseValue.map((item, index) =>
      mergeLocalizedContentOverlay(item, overlayValue[index]),
    );
  }

  if (
    baseValue &&
    typeof baseValue === "object" &&
    !Array.isArray(baseValue) &&
    overlayValue &&
    typeof overlayValue === "object" &&
    !Array.isArray(overlayValue)
  ) {
    const merged = { ...baseValue };
    Object.entries(overlayValue).forEach(([key, value]) => {
      merged[key] = mergeLocalizedContentOverlay(baseValue[key], value);
    });
    return merged;
  }

  return overlayValue;
}

function resolveLocalizedContentTree(value, lang = activeUiLanguage) {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveLocalizedContentTree(entry, lang));
  }

  if (isLocalizedContentValue(value)) {
    return readLocalizedContent(value, lang);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveLocalizedContentTree(entry, lang)]),
    );
  }

  return value;
}

function localizeContentCollection(items = [], overlayById = {}) {
  return items.map((item) =>
    resolveLocalizedContentTree(
      mergeLocalizedContentOverlay(item, overlayById[item.id] || {}),
    ),
  );
}

function formatApproxKm(distanceKm) {
  return isEnglishUi ? `about ${distanceKm} km` : `ca ${distanceKm} km`;
}

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

// `payloadSignals` are the active compatibility tags that this planner layer
// actually sends to the route API today. `aliases` are taxonomy metadata for
// broader multi-city language, not live recommendation logic on their own.
const plannerIntentDefinitions = [
  {
    key: "food_drink",
    label: t("planner.intent.food_drink", "Mat & dryck"),
    payloadSignals: ["mat", "vin", "öl", "cocktail"],
    aliases: ["food", "drink", "restaurant", "aperitivo", "wine", "beer", "cocktail", "mat", "vin", "öl"],
    coverageTags: ["mat", "vin", "öl", "cocktail", "aperitivo", "pizza"],
  },
  {
    key: "culture",
    label: t("planner.intent.culture", "Kultur"),
    payloadSignals: ["kultur", "kyrkor"],
    aliases: ["culture", "museum", "gallery", "architecture", "church", "kultur", "kyrkor"],
    coverageTags: ["kultur", "kyrkor"],
  },
  {
    key: "second_hand",
    label: t("planner.intent.second_hand", "Second hand"),
    payloadSignals: ["second_hand"],
    aliases: [
      "second_hand",
      "vintage",
      "thrift",
      "charity_shop",
      "used_clothing",
      "retro",
      "flea_market",
      "antique",
      "market",
      "shopping",
      "preloved",
      "resale",
      "consignment",
    ],
    coverageTags: [
      "second_hand",
      "vintage",
      "thrift",
      "charity_shop",
      "used_clothing",
      "retro",
      "flea_market",
      "antique",
      "market",
      "shopping",
      "preloved",
      "resale",
      "consignment",
    ],
  },
  {
    key: "hidden_gems",
    label: t("planner.intent.hidden_gems", "Hidden gems"),
    payloadSignals: ["hidden gems", "low-key"],
    aliases: ["hidden_gems", "local", "unusual", "under_the_radar", "hidden gems", "lokalt", "ovanligt"],
    coverageTags: ["hidden gems"],
  },
  {
    key: "views",
    label: t("planner.intent.views", "Utsikt"),
    payloadSignals: ["utsikt", "hidden gems"],
    aliases: ["view", "panorama", "rooftop", "golden_hour", "utsikt"],
    coverageTags: ["utsikt", "golden hour"],
  },
  {
    key: "nightlife",
    label: t("planner.intent.nightlife", "Kvällsliv"),
    payloadSignals: ["nattliv", "kväll", "cocktail", "party"],
    aliases: ["nightlife", "evening", "bar", "cocktail", "late", "party-light", "nattliv", "kväll"],
    coverageTags: ["nattliv", "kväll", "cocktail", "öl", "vin", "party"],
  },
  {
    key: "history",
    label: t("planner.intent.history", "Historia"),
    payloadSignals: ["klassiker", "kyrkor", "kultur"],
    aliases: ["history", "ancient", "ruins", "archaeology", "classic", "church", "museum", "historia", "antikt", "ruiner", "klassiker"],
    coverageTags: ["kultur", "kyrkor", "klassiker"],
  },
  {
    key: "green_walk",
    label: t("planner.intent.green_walk", "Grönt & promenad"),
    payloadSignals: ["low-key", "utsikt", "hidden gems"],
    aliases: ["park", "garden", "walk", "waterfront", "green", "outdoor", "promenad", "trädgård", "vatten"],
    coverageTags: ["utsikt", "hidden gems", "low-key"],
  },
];

const plannerIntentByKey = new Map(
  plannerIntentDefinitions.map((intent) => [intent.key, intent]),
);
const defaultPlannerIntentKeys = ["food_drink", "culture", "hidden_gems", "nightlife"];
const defaultPlannerIntentKeySet = new Set(defaultPlannerIntentKeys);
const plannerIntentCoverageTagSet = new Set([
  "aperitivo",
  "cocktail",
  "golden hour",
  "hidden gems",
  "klassiker",
  "kultur",
  "kyrkor",
  "kväll",
  "low-key",
  "mat",
  "nattliv",
  "party",
  "pizza",
  "utsikt",
  "vin",
  "öl",
]);
let plannerIntentSelectionMode = "default_seed";
const plannerTrust = window.ParrandaPlannerTrust || {};
const latestPlannerPlanSchemaVersion =
  plannerTrust.LATEST_PLANNER_PLAN_SCHEMA_VERSION || 1;
const latestPlannerPlanMaxAgeMs =
  plannerTrust.DEFAULT_LATEST_PLANNER_PLAN_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000;
const plannerTrustBuildLoadingMessages =
  plannerTrust.buildPlannerLoadingMessages ||
  ((dayCount = 1) =>
    dayCount > 1
      ? [
          `Bygger ${dayCount} dagar...`,
          "Sätter ihop första dagen...",
          "Väger in nästa dag...",
          "Sätter ihop rutten...",
        ]
      : [
          "Bygger dagen...",
          "Sätter ihop rutten...",
          "Väger in dagens signaler...",
          "Finjusterar flödet...",
        ]);
function buildPlannerLoadingMessagesForUi(dayCount = 1) {
  if (!isEnglishUi) {
    return plannerTrustBuildLoadingMessages(dayCount);
  }

  return dayCount > 1
    ? [
        tf("planner.loadingMultiBuild", { count: dayCount }),
        t("planner.loadingFirst"),
        t("planner.loadingNext"),
        t("planner.loadingRouteFinal"),
      ]
    : [
        t("planner.loadingSingleBuild"),
        t("planner.loadingRouteFinal"),
        t("planner.loadingSignals"),
        t("planner.loadingFineTune"),
      ];
}
const plannerTrustCreateLatestPlannerPlanRecord =
  plannerTrust.createLatestPlannerPlanRecord ||
  ((record) => ({ schemaVersion: latestPlannerPlanSchemaVersion, ...record }));
const plannerTrustNormalizeLatestPlannerPlanRecord =
  plannerTrust.normalizeLatestPlannerPlanRecord || ((record) => record);
const plannerTrustBuildLatestPlannerPlanDismissSignature =
  plannerTrust.buildLatestPlannerPlanDismissSignature ||
  ((record) => `${record?.cityKey || ""}:${record?.timestamp || ""}`);
const plannerTrustCollectSelectedIntentVisibility =
  plannerTrust.collectSelectedIntentVisibility ||
  (() => ({ perDay: [], firstDayIndexByKey: {}, missingIntentKeys: [], laterIntentKeys: [] }));

const favoritesStorageKey = `parranda:${plannerCityKey}:favorites`;
const savedRoutesStorageKey = `parranda:${plannerCityKey}:saved-routes`;
const latestPlannerPlanStorageKey = "parranda:latest-planner-plan";
const latestPlannerPlanDismissStorageKey = `parranda:${plannerCityKey}:latest-planner-plan-dismissed`;
const routeApiBase = "/api";
const plannerAutoMode = "auto";
const plannerManualMode = "manual";
const legPacingLabels = {
  short: t("planner.legShortSummary", "Kort ben"),
  balanced: t("planner.legBalancedSummary", "Balans"),
  flexible: t("planner.legFlexibleSummary", "Friare ben"),
};
const legPacingHints = {
  short: "Kort försöker hålla varje enskilt ben tätare och mer sammanhängande.",
  balanced: "Balans håller benen rimliga utan att bli onödigt strikt.",
  flexible: "Spelar mindre roll låter motorn ta större hopp om helheten blir bättre.",
};
let plannerLoadingMessages = buildPlannerLoadingMessagesForUi(1);
const romePlannerDistrictCatalog = [
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

function getFrontendPlaces() {
  return hasRomeFrontendContent ? romePlaces : [];
}

function getFrontendDistrictGuides() {
  return hasRomeFrontendContent
    ? localizeContentCollection(romeDistrictGuides, romeDistrictGuideLocalizedContent)
    : [];
}

function getFrontendPlannerDistrictCatalog() {
  return hasRomeFrontendContent ? romePlannerDistrictCatalog : [];
}

function getPreviewCityLabel() {
  return plannerDisplayCityLabel || plannerRequestedCityLabel || plannerResolvedCityLabel || "Staden";
}

function buildUnavailableCityLabel() {
  return getPreviewCityLabel();
}

function getMapCityFallbackLabel() {
  return plannerDisplayCityLabel || plannerResolvedCityLabel || buildUnavailableCityLabel();
}

const districtUiCopy = {
  selectorEyebrow: createLocalizedContent("UTVALDA KVARTER", "SELECTED DISTRICTS"),
  selectorTitle: createLocalizedContent(
    "Välj kvarteret som ska bära dagen",
    "Choose the district that should carry the day",
  ),
  selectorNote: createLocalizedContent(
    "Här väljer du vilket kvarter som ska fungera som redaktionell bas för dagen.",
    "Choose the district that should act as the editorial base for the day.",
  ),
  dayEyebrow: createLocalizedContent("PERFEKTA DAGEN", "PERFECT DAY"),
  actionEyebrow: createLocalizedContent("GÖR NÅGOT AV DET", "MAKE IT USEFUL"),
  actionSetStart: createLocalizedContent("Sätt som start", "Set as start"),
  actionSetEnd: createLocalizedContent("Sätt som mål", "Set as end"),
  actionPlan: createLocalizedContent("Planera dag härifrån", "Plan from here"),
  actionMap: createLocalizedContent("Visa kvarteret på karta", "Show district on map"),
  showOnMap: createLocalizedContent("Visa på karta", "Show on map"),
};

function buildLiveScopeAllLabel() {
  return tf("pulse.allCity", { city: buildUnavailableCityLabel() }, `Hela ${buildUnavailableCityLabel()}`);
}

function buildNonRomeRouteSummary() {
  const cityLabel = buildUnavailableCityLabel();

  if (isFallbackRequestedCity) {
    return tf("planner.previewFallback", { city: cityLabel }, `${cityLabel} har ännu inget eget kuraterat Parranda-läge. Shellen är på plats, men kvartersguider, fallback-rutter och LIVE-idéer hålls tillbaka tills staden har ett riktigt city pack.`);
  }

  if (isInternalCityMode) {
    return tf("planner.previewInternal", { city: cityLabel }, `${cityLabel} kör som intern arkitekturstub. Planner och city-core går att verifiera här, men Rome-baserade fallback-rutter och stadsdelsguider är avsiktligt dolda.`);
  }

  if (isPreviewCityMode) {
    return tf("preview.routesNotReadyBody", { city: cityLabel }, `${cityLabel} är registrerad i Parranda, men kuraterade ${cityLabel}-rutter är inte redo än. Därför visas inga Rome-rutter eller fake citypack-idéer här.`);
  }

  return tf("planner.previewNeutral", { city: cityLabel }, `${cityLabel} använder ett neutralt city-läge. Kuraterat innehåll visas först när staden har ett eget pack.`);
}

function buildNonRomePlannerLaunchSummary() {
  const cityLabel = buildUnavailableCityLabel();

  if (isFallbackRequestedCity) {
    return tf("planner.nonRomeFallback", { city: cityLabel }, `${cityLabel} har ännu inte ett eget planner-läge. Parranda visar därför en ärlig shell och väntar med kuraterat innehåll tills staden stöds på riktigt.`);
  }

  if (isInternalCityMode) {
    return tf("planner.nonRomeInternal", { city: cityLabel }, `${cityLabel} är en intern preview. Planner och city-core går att testa, men kuraterade kvarter och wildcard-idéer är avsiktligt avstängda här.`);
  }

  if (isPreviewCityMode) {
    return tf("planner.nonRomePreview", { city: cityLabel }, `${cityLabel} är aktiv som city-core preview. Kuraterade kvarter, rutter och Pulse kommer först när citypacket är redo.`);
  }

  return tf("planner.nonRomeNeutral", { city: cityLabel }, `${cityLabel} kör i neutralt city-läge. Kuraterade fallback-idéer visas först när staden har ett eget pack.`);
}

function buildNonRomeFallbackNote() {
  const cityLabel = buildUnavailableCityLabel();

  if (isFallbackRequestedCity) {
    return tf("planner.fallbackNote", { city: cityLabel }, `${cityLabel} har ännu inget eget kuraterat lager. Parranda visar därför inte Rome-fallback som om ${cityLabel} redan vore lanserat.`);
  }

  if (isInternalCityMode) {
    return tf("planner.internalNote", { city: cityLabel }, `${cityLabel} är ett internt arkitekturläge. Rome-baserade fallback-rutter visas inte här.`);
  }

  if (isPreviewCityMode) {
    return tf("planner.previewNote", { city: cityLabel }, `${cityLabel} är registrerad men inte curated ännu. Parranda visar inga Rome-rutter som ersättning.`);
  }

  return tf("planner.noCuratedYet", { city: cityLabel }, `${cityLabel} saknar ännu ett eget curated-lager. Fallback-rutter visas inte som ersättning.`);
}

function syncShellModeState() {
  document.body?.classList.toggle("mode-rome-curated", isRomeCuratedMode);
  document.body?.classList.toggle("mode-city-preview", !isRomeCuratedMode);
  document.body?.classList.toggle("mode-city-fallback", isFallbackRequestedCity);
  document.body?.classList.toggle("mode-city-internal", isInternalCityMode);
  document.body?.classList.toggle("mode-city-registered-preview", isPreviewCityMode);
  document.body?.classList.toggle("has-active-plan", routeRenderMode === "api" && plannedDays.length > 0);
}

function buildPreviewRouteEmptyState() {
  const cityLabel = buildUnavailableCityLabel();

  if (isFallbackRequestedCity) {
    return {
      title: tf("preview.preparingTitle", { city: cityLabel }, `${cityLabel} förbereds fortfarande`),
      body: tf(
        "planner.previewFallback",
        { city: cityLabel },
        `City-core-grunden finns nu i appen, men ${cityLabel} har ännu inget eget kuraterat innehåll. Därför visas inga Rome-baserade fallback-rutter här.`,
      ),
    };
  }

  if (isInternalCityMode) {
    return {
      title: tf("preview.internalTitle", { city: cityLabel }, `${cityLabel} kör i intern preview`),
      body: t(
        "planner.previewInternal",
        "Det här läget används för att verifiera city-core, shell och planner utan att blanda in Rome-specifikt fallback-innehåll.",
      ),
    };
  }

  if (isPreviewCityMode) {
    return {
      title: tf("preview.routesNotReadyTitle", { city: cityLabel }, `Kuraterade ${cityLabel}-rutter är inte redo än`),
      body: tf(
        "preview.routesNotReadyBody",
        { city: cityLabel },
        `${cityLabel} är registrerad i Parranda, men route cards och fallback-rutter kommer först när citypacket har riktiga platser och rutter.`,
      ),
    };
  }

  return {
    title: tf("preview.neutralTitle", { city: cityLabel }, `${cityLabel} saknar curated-läge ännu`),
    body: t(
      "planner.previewNeutral",
      "Parranda visar ett neutralt grundläge tills staden har ett eget city pack och ett riktigt innehållslager.",
    ),
  };
}

function buildPreviewHeroCard() {
  const cityLabel = buildUnavailableCityLabel();

  if (isFallbackRequestedCity) {
    return {
      label: t("preview.cityStatus", "CITY-STATUS"),
      title: tf("preview.preparingTitle", { city: cityLabel }, `${cityLabel} förbereds fortfarande`),
      summary: t(
        "preview.preparingSummary",
        "Parranda visar shellen och city-core-grunden, men blandar inte in Rome-kvarter eller fallback-idéer som om staden redan vore kurerad.",
      ),
      meta: t("preview.preparingMeta", "Ingen publik city-lansering ännu."),
      tags: [cityLabel, t("preview.preparingTag", "Förbereds"), t("preview.neutralShellTag", "Neutral shell")],
    };
  }

  if (isInternalCityMode) {
    return {
      label: t("preview.internalStub", "INTERN STUB"),
      title: tf("preview.internalTitle", { city: cityLabel }, `${cityLabel} kör i preview`),
      summary: t(
        "preview.internalSummary",
        "Det här läget finns för att bevisa att en andra stad kan leva ovanpå city-core utan att importera Rome-moduler eller Rome-fallback.",
      ),
      meta: t("preview.internalMeta", "Intern verifiering • inte en produktstad."),
      tags: [cityLabel, t("preview.internalTag", "Intern"), t("preview.cityCoreTag", "City-core")],
    };
  }

  if (isPreviewCityMode) {
    return {
      label: t("preview.cityStatus", "CITY-STATUS"),
      title: tf("preview.cityCoreTitle", { city: cityLabel }, `${cityLabel} har city-core aktivt`),
      summary: tf(
        "preview.cityCoreSummary",
        { city: cityLabel },
        `${cityLabel} är en riktig registrerad stad i Parranda nu, men kuraterade kvarter, rutter och Pulse hålls tillbaka tills de finns på riktigt.`,
      ),
      meta: t("preview.cityCoreMeta", "Registrerad stad • inte curated ännu."),
      tags: [cityLabel, t("preview.previewTag", "Preview"), t("preview.cityCoreTag", "City-core")],
    };
  }

  return {
    label: t("preview.cityStatus", "CITY-STATUS"),
    title: tf("preview.neutralTitle", { city: cityLabel }, `${cityLabel} använder neutral city-mode`),
    summary: t(
      "preview.neutralSummary",
      "Plannern kan använda city-identiteten, men kuraterat innehåll och fallback-idéer kommer först när staden har ett eget pack.",
    ),
    meta: t("preview.neutralMeta", "Groundwork först, content senare."),
    tags: [cityLabel, t("preview.previewTag", "Preview")],
  };
}

function buildGenericFallbackPulse(dateString = getTodayIsoDate()) {
  const date = dateString || getTodayIsoDate();
  const dateLabels = getFallbackPulseDateLabels(date);
  const cityLabel = buildUnavailableCityLabel();
  const item = {
    id: "preview-city-status",
    level: "city",
    kind: isInternalCityMode ? t("preview.internalStub", "INTERN STUB") : t("preview.cityStatus", "CITY-STATUS"),
    title: isFallbackRequestedCity
      ? tf("preview.preparingTitle", { city: cityLabel }, `${cityLabel} har ännu inget eget LIVE-lager`)
      : isPreviewCityMode
        ? tf("preview.pulseNotReadyTitle", { city: cityLabel }, `Kuraterad Pulse för ${cityLabel} är inte redo än`)
        : tf("preview.neutralTitle", { city: cityLabel }, `${cityLabel} använder neutral LIVE-grund`),
    where: cityLabel,
    when: t("pulse.now", "Just nu"),
    blurb: isFallbackRequestedCity
      ? t(
          "planner.previewFallback",
          "Sidan visar shell och bootstrap på rätt stad, men väntar med curated LIVE och fallback-idéer tills city-packet finns.",
        )
      : isPreviewCityMode
        ? tf(
            "preview.pulseNotReadyBody",
            { city: cityLabel },
            `${cityLabel} har city-core aktivt, men ingen egen Pulse/editorial-layer ännu. Parranda visar därför inte Rome Pulse här.`,
          )
      : t(
          "planner.previewNeutral",
          "Det här läget använder no-op eller neutral city-puls tills staden får ett riktigt editorial-lager.",
        ),
    why_it_matters: t(
      "pulse.reasonFallback",
      "Det gör city-core ärlig: inga Rome-idéer visas här om staden inte faktiskt är kurerad.",
    ),
    matches_vibes: [],
    priority: 1,
  };

  return {
    date,
    weekday_label: dateLabels.weekdayLabel,
    date_label: dateLabels.dateLabel,
    headline: isEnglishUi ? `${cityLabel} city-core is active` : `${cityLabel} city-core är aktivt`,
    subhead: isFallbackRequestedCity
      ? t("planner.fallbackNote", "Det här är en ärlig city-fallback utan lånat Rome-innehåll.")
      : isPreviewCityMode
        ? tf("preview.pulseNotReadyTitle", { city: cityLabel }, `Kuraterad Pulse för ${cityLabel} är inte redo än`)
      : t("planner.previewNeutral", "Neutral puls tills staden får ett riktigt lokalt lager."),
    note: isFallbackRequestedCity
      ? t("planner.previewFallback", "Curated LIVE och wildcard-idéer hålls tillbaka tills staden stöds på riktigt.")
      : isPreviewCityMode
        ? tf("preview.pulseNotReadyBody", { city: cityLabel }, `${cityLabel} har ingen egen Pulse/editorial-layer ännu.`)
      : t("planner.previewNeutral", "No-op- eller neutral city-puls används medvetet här."),
    footer_note: t("preview.neutralMeta", "City-core är aktivt. Editorial och curated-lager kommer senare."),
    items: [item],
    moments: [
      {
        id: item.id,
        kindLabel: item.kind,
        title: item.title,
        note: item.blurb,
        areas: [item.where],
        tags: [],
        linked_wildcard_id: null,
      },
    ],
    official_events: [],
    wildcards: [],
  };
}

function removePlannerModeOption(select, value) {
  const option = select?.querySelector(`option[value="${value}"]`);

  if (!select || !option) {
    return;
  }

  option.remove();

  if (select.value === value) {
    select.value = plannerAutoMode;
  }
}

function applyCityModeToShell() {
  syncShellModeState();

  if (heroHeadline) {
    heroHeadline.textContent = isRomeCuratedMode
      ? (isEnglishUi ? "Your day starts here." : "Din dag börjar här.")
      : isInternalCityMode
        ? (isEnglishUi ? `${buildUnavailableCityLabel()} is running in preview.` : `${buildUnavailableCityLabel()} kör i preview.`)
        : isPreviewCityMode
          ? (isEnglishUi ? `${buildUnavailableCityLabel()} city-core is active.` : `${buildUnavailableCityLabel()} city-core är aktivt.`)
        : (isEnglishUi ? `${buildUnavailableCityLabel()} is still being prepared.` : `${buildUnavailableCityLabel()} förbereds fortfarande.`);
  }

  if (heroLead) {
    heroLead.textContent = isRomeCuratedMode
      ? (isEnglishUi
        ? `${plannerDisplayCityLabel} is the active city. Choose a mood and let Parranda build the main day.`
        : `${plannerDisplayCityLabel} är aktiv stad. Välj känsla och låt Parranda bygga huvuddagen.`)
      : isInternalCityMode
        ? (isEnglishUi ? "Planner, shell, and city-core can be tested here without Rome-curated layers." : "Planner, shell och city-core går att prova här utan Rome-curated lager.")
        : isPreviewCityMode
          ? (isEnglishUi ? "Curated districts, routes, and Pulse are not ready yet, so Parranda shows no borrowed Rome content." : "Kuraterade kvarter, rutter och Pulse är inte redo än, så Parranda visar inget lånat Rome-innehåll.")
        : (isEnglishUi ? "Parranda shows an honest preview until this city has its own curated pack." : "Parranda visar ett ärligt preview-läge tills staden har ett eget kuraterat pack.");
  }

  if (heroEyebrow && !isRomeCuratedMode) {
    heroEyebrow.textContent = isInternalCityMode
      ? `${buildUnavailableCityLabel().toUpperCase()} · INTERN PREVIEW`
      : `${buildUnavailableCityLabel().toUpperCase()} · PREVIEW`;
  }

  if (plannerModalTitle) {
    plannerModalTitle.textContent = isRomeCuratedMode
      ? (isEnglishUi ? `Plan your time in ${plannerDisplayCityLabel}` : `Planera din tid i ${plannerDisplayCityLabel}`)
      : isInternalCityMode
        ? (isEnglishUi ? `Planner preview • ${buildUnavailableCityLabel()}` : `Planner-preview • ${buildUnavailableCityLabel()}`)
        : isPreviewCityMode
          ? (isEnglishUi ? `${buildUnavailableCityLabel()} city-core preview` : `${buildUnavailableCityLabel()} city-core-preview`)
        : (isEnglishUi ? `Plan when ${buildUnavailableCityLabel()} is ready` : `Planera när ${buildUnavailableCityLabel()} är redo`);
  }

  if (heroLiveButton) {
    const heroLiveLabel = heroLiveButton.querySelector("span:last-child");

    if (heroLiveLabel) {
      heroLiveLabel.textContent = "Pulse";
    }
  }

  if (routePlannerOpenButton && !isRomeCuratedMode) {
    routePlannerOpenButton.textContent = isInternalCityMode
      ? (isEnglishUi ? "Open preview" : "Öppna preview")
      : (isEnglishUi ? "See planner preview" : "Se planner-preview");
  }
  if (routePlannerManualButton && !isRomeCuratedMode) {
    routePlannerManualButton.hidden = true;
  }

  if (!isRomeCuratedMode) {
    if (tabNav) {
      tabNav.hidden = true;
    }
    if (overviewTabButton) {
      overviewTabButton.hidden = true;
    }
    if (districtsTabButton) {
      districtsTabButton.hidden = true;
    }
    if (overviewPanel) {
      overviewPanel.hidden = true;
    }
    if (districtsPanel) {
      districtsPanel.hidden = true;
    }
    if (plannerLaunchSummary) {
      plannerLaunchSummary.textContent = buildNonRomePlannerLaunchSummary();
    }
    if (routeMatchSummary) {
      routeMatchSummary.textContent = buildNonRomeRouteSummary();
    }
  } else if (routePlannerOpenButton) {
    routePlannerOpenButton.textContent = isEnglishUi ? "Plan the day" : "Planera dagen";
    if (routePlannerManualButton) {
      routePlannerManualButton.hidden = false;
      routePlannerManualButton.textContent = isEnglishUi ? "Manual controls" : "Jag vill styra själv";
    }
  }
}

function applyPlannerModeRestrictions() {
  if (isRomeCuratedMode) {
    return;
  }

  [homeBaseModeSelect, startModeSelect, endModeSelect].forEach((select) => {
    removePlannerModeOption(select, "preset");
  });
}

let activeFilter = "all";
let onlyFavorites = false;
let selectedPlaceName = getFrontendPlaces()[0]?.name || "";
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
let blitzState = null;
let blitzMemory = null;
let blitzLoading = false;
let blitzInlineStatus = "";
let blitzLoadRequestId = 0;
let blitzOriginMode = "selected_place";
let blitzContextKey = "";
let activePulseScope = "all";
let activePulseTime = "now";
let activePulseLevel = "all";
let plannerLoadingTimer = null;
let plannerLoadingStops = [];
let plannerLoadingSkeletonClear = null;
let cityPulseScopeStatus = "";
let activePulseRadiusKey = "5";
let activeLiveDate = getTodayIsoDate();
let liveEditionExpanded = false;
const expandedAlternativeDates = new Set();
const heroBlitzMaxWalkMinutes = 180;
const heroBlitzReasonMaxLength = 148;
const heroBlitzFollowupMaxLength = 110;

const cityPulseScopeMeta = {
  all: {
    label: buildLiveScopeAllLabel(),
  },
  nearby: {
    label: t("pulse.nearMe", "Nära mig"),
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
    label: t("pulse.now", "Just nu"),
  },
  tonight: {
    label: t("pulse.tonight", "Ikväll"),
  },
  weekend: {
    label: t("pulse.weekend", "I helgen"),
  },
};

const cityPulseLevelMeta = {
  city: {
    label: t("pulse.cityRhythm", "Stadens rytm"),
    sub: t("pulse.cityRhythmSub", "Det en lokal bär med sig utan att tänka på det"),
    mark: "I",
  },
  neighborhood: {
    label: t("pulse.neighborhood", "Kvarterspuls"),
    sub: t("pulse.neighborhoodSub", "Vad som faktiskt spelar bättre i olika delar av stan just nu"),
    mark: "II",
  },
  venue: {
    label: t("pulse.venue", "Ställesnivå"),
    sub: t("pulse.venueSub", "Plats- och live-signaler som kan förändra dagen på riktigt"),
    mark: "III",
  },
};

const cityPulseVibeLabels = {
  slow: isEnglishUi ? "slow" : "långsam",
  buzzy: isEnglishUi ? "buzzy" : "pulsig",
  romantic: isEnglishUi ? "romantic" : "romantisk",
  curious: isEnglishUi ? "curious" : "nyfiken",
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

const routeModifierLabels = {
  evening: "Mer kväll",
  culture: "Mer kultur",
  low_key: "Mer low-key",
  party: "Mer party",
};

function getPlannerIntentLabel(intentKey) {
  return plannerIntentByKey.get(intentKey)?.label || intentKey;
}

function getSelectedIntentKeys() {
  return [...preferenceInputs]
    .filter((input) => input.checked)
    .map((input) => input.value)
    .filter((value) => plannerIntentByKey.has(value));
}

function getExplicitSelectedIntentKeys() {
  return plannerIntentSelectionMode === "explicit" ? getSelectedIntentKeys() : [];
}

function matchesDefaultPlannerIntentKeys(intentKeys = []) {
  if (intentKeys.length !== defaultPlannerIntentKeys.length) {
    return false;
  }

  return intentKeys.every((intentKey) => defaultPlannerIntentKeySet.has(intentKey));
}

function setSelectedIntentKeys(intentKeys = [], options = {}) {
  const selectedKeys = new Set(intentKeys.filter((intentKey) => plannerIntentByKey.has(intentKey)));
  preferenceInputs.forEach((input) => {
    input.checked = selectedKeys.has(input.value);
  });
  plannerIntentSelectionMode =
    options.allowDefaultSeed && matchesDefaultPlannerIntentKeys([...selectedKeys])
      ? "default_seed"
      : "explicit";
}

function applyPlannerIntentKeySelection(intentKeys = [], options = {}) {
  setSelectedIntentKeys(intentKeys, options);
  updatePlannerAdvancedSummary();
  updatePlannerLaunchSummary();
  updateRouteMatchSummary(buildPlannerStyleSummary());
}

function normalizePlannerIntentSelectionAfterChange() {
  const selectedKeys = getSelectedIntentKeys();

  if (!selectedKeys.length) {
    setSelectedIntentKeys(defaultPlannerIntentKeys, { allowDefaultSeed: true });
    return;
  }

  plannerIntentSelectionMode = matchesDefaultPlannerIntentKeys(selectedKeys)
    ? "default_seed"
    : "explicit";
}

function expandIntentKeysToPreferenceSignals(intentKeys = []) {
  return [...new Set(
    intentKeys.flatMap((intentKey) => plannerIntentByKey.get(intentKey)?.payloadSignals || []),
  )];
}

function inferIntentKeysFromPreferences(preferences = []) {
  const selectedPreferences = new Set(preferences || []);
  const inferredKeys = [];

  if (["mat", "vin", "öl", "pizza"].some((tag) => selectedPreferences.has(tag))) {
    inferredKeys.push("food_drink");
  }

  if (selectedPreferences.has("kultur")) {
    inferredKeys.push("culture");
  }

  if (
    [
      "second_hand",
      "vintage",
      "thrift",
      "charity_shop",
      "used_clothing",
      "retro",
      "flea_market",
      "antique",
      "market",
      "shopping",
      "preloved",
      "resale",
      "consignment",
    ].some((tag) => selectedPreferences.has(tag))
  ) {
    inferredKeys.push("second_hand");
  }

  if (selectedPreferences.has("hidden gems")) {
    inferredKeys.push("hidden_gems");
  }

  if (
    selectedPreferences.has("utsikt") ||
    selectedPreferences.has("golden hour")
  ) {
    inferredKeys.push("views");
  }

  if (
    selectedPreferences.has("nattliv") ||
    selectedPreferences.has("kväll") ||
    selectedPreferences.has("party")
  ) {
    inferredKeys.push("nightlife");
  }

  if (
    selectedPreferences.has("klassiker") ||
    selectedPreferences.has("historia") ||
    selectedPreferences.has("antikt") ||
    selectedPreferences.has("ruiner") ||
    selectedPreferences.has("kyrkor")
  ) {
    inferredKeys.push("history");
  }

  if (
    selectedPreferences.has("promenad") ||
    selectedPreferences.has("trädgård") ||
    selectedPreferences.has("vatten") ||
    (selectedPreferences.has("utsikt") && selectedPreferences.has("low-key"))
  ) {
    inferredKeys.push("green_walk");
  }

  return inferredKeys;
}

function getIntentLabelsForSnapshot(snapshot = {}) {
  const intentKeys =
    Array.isArray(snapshot.intentKeys) && snapshot.intentKeys.length
      ? snapshot.intentKeys.filter((intentKey) => plannerIntentByKey.has(intentKey))
      : inferIntentKeysFromPreferences(snapshot.preferences || []);

  return intentKeys.map(getPlannerIntentLabel);
}

function plannerIntentHasCoverage(intentKey) {
  const intent = plannerIntentByKey.get(intentKey);

  if (!intent) {
    return false;
  }

  return (intent.coverageTags || []).some((tag) => plannerIntentCoverageTagSet.has(tag));
}

function getBudgetTierLabel(tier) {
  const labels = {
    standard: t("planner.budgetStandard", "Standard"),
    budget: t("planner.budgetSmart", "Budgetsmart"),
    "dolce-vita": hasRomeFrontendContent ? "La Dolce Vita" : t("planner.budgetPremium", "Premium"),
  };

  return labels[tier] || null;
}

function getBudgetTierCopy(tier) {
  const copy = {
    standard: t(
      "planner.budgetStandardCopy",
      "Standardnivå är aktiv. Parranda försöker nu hålla balansen mellan starka stopp, rimlig nota och tydlig personlighet.",
    ),
    budget: t(
      "planner.budgetSmartCopy",
      "Budgetsmart är aktivt. Motorn väger nu upp billigare öl, prisvänlig mat och stopp där notan kan hållas nere utan att känslan dör.",
    ),
    "dolce-vita": hasRomeFrontendContent
      ? t(
          "planner.budgetDolceCopy",
          "La Dolce Vita är aktivt. Motorn jagar nu mer premium, bokningsvärda glas och stopp som får kvällen att kännas större och lite lyxigare.",
        )
      : t(
          "planner.budgetPremiumCopy",
          "Premium är aktivt. Motorn jagar nu mer bokningsvärda glas och stopp som får kvällen att kännas större och lite lyxigare.",
        ),
  };

  return copy[tier] || null;
}

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

function buildRomeFallbackWildcards(dateString = getTodayIsoDate()) {
  if (!isRomeCuratedMode) {
    return [];
  }

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
  const date = parseIsoDateToUtcNoon(dateString);

  if (!date) {
    return "";
  }

  const formatted = new Intl.DateTimeFormat(uiDateLocale, {
    timeZone: "UTC",
    ...options,
  }).format(date);

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

function buildRomeFallbackPulseItems(dateString = getTodayIsoDate()) {
  const date = dateString || getTodayIsoDate();
  const probe = parseIsoDateToUtcNoon(date);
  const weekday = probe?.getUTCDay() ?? 0;
  const month = (probe?.getUTCMonth() ?? -1) + 1;
  const items = [];

  if (weekday === 5 || weekday === 6) {
    items.push({
      id: "fallback-city-weekend",
      level: "city",
      kind: isEnglishUi ? "City rhythm" : "Stadens rytm",
      title: isEnglishUi
        ? "Weekend evenings in Rome hit hardest late"
        : "Helgkvällar i Rom blir starkast sent",
      where: isEnglishUi
        ? "Monti, Testaccio, Pigneto, and Ostiense"
        : "Monti, Testaccio, Pigneto och Ostiense",
      when: isEnglishUi ? "After 19:00" : "Efter 19:00",
      blurb: isEnglishUi
        ? "Save your main energy for later. Neighborhoods that feel half-calm at aperitivo can be exactly right once the evening has properly settled."
        : "Spara gärna huvudenergin till sent. De kvarter som känns halvlugna vid aperitivo kan vara helt rätt först när kvällen hunnit sätta sig.",
      why_it_matters: isEnglishUi
        ? "A better weekend day in Rome usually comes from fewer neighborhoods and more patience, not from trying to cover everything before dinner."
        : "En bättre helgdag i Rom kommer ofta från färre kvarter och mer tålamod, inte från att försöka täcka allt före middagen.",
      matches_vibes: ["buzzy"],
      linked_wildcard_id: "fallback-san-lorenzo-pigneto",
      priority: 5,
    });
  } else {
    items.push({
      id: "fallback-city-smart",
      level: "city",
      kind: isEnglishUi ? "City rhythm" : "Stadens rytm",
      title: isEnglishUi
        ? "Rome usually gets better when the day grows into the evening"
        : "Rom blir oftast bättre när dagen får växa in i kvällen",
      where: isEnglishUi ? "Across the city" : "Hela staden",
      when: isEnglishUi ? "After lunch into late evening" : "Efter lunch till sent",
      blurb: isEnglishUi
        ? "Most things feel more alive after the afternoon has landed. That is especially true if you want the city to feel less ticked off and more genuinely lived."
        : "Det mesta känns mer levande efter att eftermiddagen landat. Det gäller särskilt om du vill att staden ska kännas mindre avbockad och mer upplevd.",
      why_it_matters: isEnglishUi
        ? "Do not build the day too early. When the tempo is allowed to grow, even a simple route feels more convincing."
        : "Bygg inte dagen för tidigt. När tempot får växa blir även en enkel rutt mer trovärdig.",
      matches_vibes: ["slow", "curious"],
      linked_wildcard_id: "fallback-monti-testaccio",
      priority: 4,
    });
  }

  if (month >= 4 && month <= 5) {
    items.push({
      id: "fallback-city-spring",
      level: "city",
      kind: isEnglishUi ? "Season" : "Säsong",
      title: isEnglishUi ? "Spring makes Rome especially strong on foot" : "Våren gör Rom extra bra till fots",
      where: isEnglishUi ? "All of Rome" : "Hela Rom",
      when: isEnglishUi ? "Golden hour into late evening" : "Golden hour till sent",
      blurb: isEnglishUi
        ? "This is the moment for longer walks, cleaner shifts between neighborhoods, and routes that can be a little broader without feeling stressed."
        : "Det är läge för längre promenader, snyggare skiften mellan kvarter och rutter som får vara lite bredare utan att kännas stressade.",
      why_it_matters: isEnglishUi
        ? "This season rewards treating the walk as part of the experience, not just as transport."
        : "Just den här säsongen vinner på att låta promenaden bli en del av upplevelsen, inte bara transporten.",
      matches_vibes: ["romantic", "slow"],
      linked_wildcard_id: "fallback-monti-testaccio",
      priority: 3,
    });
  }

  items.push({
    id: "fallback-neighborhood",
    level: "neighborhood",
    kind: isEnglishUi ? "Neighborhood pulse" : "Kvarterspuls",
    title: isEnglishUi
      ? "Two strong neighborhoods usually beat a full checklist"
      : "Två starka kvarter slår oftare en full checklista",
    where:
      weekday === 5 || weekday === 6
        ? isEnglishUi
          ? "Monti + Testaccio or Pigneto + San Lorenzo"
          : "Monti + Testaccio eller Pigneto + San Lorenzo"
        : isEnglishUi
          ? "Garbatella + Ostiense or Monti + Testaccio"
          : "Garbatella + Ostiense eller Monti + Testaccio",
    when: isEnglishUi ? "All day" : "Hela dagen",
    blurb: isEnglishUi
      ? "Stick to one clear track and let the walk between stops become part of the rhythm instead of chasing too many points."
      : "Håll dig gärna till ett tydligt spår och låt promenaden mellan stoppen vara en del av rytmen i stället för att jaga för många punkter.",
    why_it_matters: isEnglishUi
      ? "That is how the day feels more local and less like a list you are trying to beat."
      : "Det är så dagen känns mer lokal och mindre som en lista du försöker vinna över.",
    matches_vibes: ["curious"],
    linked_wildcard_id: "fallback-garbatella-ostiense",
    priority: 4,
  });

  items.push({
    id: "fallback-venue-wine",
    level: "venue",
    kind: isEnglishUi ? "Venue level" : "Ställesnivå",
    title: isEnglishUi
      ? "Let a wine or beer anchor carry the evening"
      : "Låt ett vin- eller ölankare bära kvällen",
    where: isEnglishUi
      ? "Monti, Testaccio, Garbatella, or Trastevere"
      : "Monti, Testaccio, Garbatella eller Trastevere",
    when: isEnglishUi ? "Late afternoon into evening" : "Sen eftermiddag till kväll",
    blurb: isEnglishUi
      ? "A proper glass stop often matters more than one more half-spontaneous place. Choose a room with a clear feeling and build from there."
      : "Ett riktigt glasstopp gör ofta större skillnad än ännu ett halvspontant ställe. Välj ett rum med tydlig känsla och bygg vidare därifrån.",
    why_it_matters: isEnglishUi
      ? "When one stop really carries the mood, the rest of the route becomes easier to trust."
      : "När ett stopp verkligen bär stämningen blir resten av rutten enklare att lita på.",
    matches_vibes: ["slow", "buzzy"],
    linked_wildcard_id: "fallback-monti-testaccio",
    priority: 3,
  });

  return items;
}

function buildRomeFallbackCityPulse(dateString = getTodayIsoDate()) {
  if (!isRomeCuratedMode) {
    return buildGenericFallbackPulse(dateString);
  }

  const date = dateString || getTodayIsoDate();
  const dateLabels = getFallbackPulseDateLabels(date);
  const items = buildRomeFallbackPulseItems(date);

  return {
    date,
    weekday_label: dateLabels.weekdayLabel,
    date_label: dateLabels.dateLabel,
    headline: isEnglishUi
      ? "What is actually happening in Rome right now."
      : "Vad som faktiskt händer i Rom just nu.",
    subhead: isEnglishUi
      ? "Fallback mode keeps city rhythm, neighborhood pulse, and venue-level signals alive so Pulse still helps you read the day smartly."
      : "Fallback-läget håller kvar stadens rytm, kvarterspuls och platsnivå så att LIVE fortfarande går att använda smart.",
    note: isEnglishUi
      ? "Showing a local fallback with city pulse and evening ideas while the live layer loads or the network is acting up."
      : "Visar en lokal fallback med stadspuls och kvällsidéer medan live-lagret laddar eller om nätet inte spelar med.",
    footer_note: isEnglishUi
      ? "Fallback mode is active. Pulse should still help you decide what is worth weighing into the planner flow."
      : "Fallback-läge är aktivt. LIVE ska fortfarande hjälpa dig avgöra vad som är värt att väga in i planner-flödet.",
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
    wildcards: buildRomeFallbackWildcards(date),
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

function getSelectedBlitzOriginSource() {
  const selectedPlace = getPlaceByName(selectedPlaceName);

  if (selectedPlace) {
    return {
      label: selectedPlace.name,
      lat: selectedPlace.lat,
      lng: selectedPlace.lng,
      source: "selected_place",
    };
  }

  return {
    label: buildUnavailableCityLabel(),
    lat: plannerCity.center?.lat,
    lng: plannerCity.center?.lng,
    source: "fallback",
  };
}

function getBlitzDateValue() {
  return activeLiveDate || routeDateFrom?.value || getTodayIsoDate();
}

function getBlitzRouteContextKey() {
  if (activeRouteKey) {
    return String(activeRouteKey);
  }

  const activeRoute = getActiveRoutePayloadForBlitz();

  if (!activeRoute) {
    return "none";
  }

  return [activeRoute.date || getBlitzDateValue(), activeRoute.id || activeRoute.title || "route"]
    .filter(Boolean)
    .join(":");
}

function buildBlitzContextKey(origin = null) {
  const intentKeys = getBlitzIntentKeys();
  const normalizedOrigin =
    origin ||
    (blitzOriginMode === "current_location"
      ? {
          type: "current_location",
          label: "Min plats",
          lat: currentLocationCoords?.lat,
          lng: currentLocationCoords?.lng,
        }
      : {
          type: "selected_place",
          ...getSelectedBlitzOriginSource(),
        });

  const originType = normalizedOrigin?.type || blitzOriginMode || "selected_place";
  const originLabel = normalizedOrigin?.label || buildUnavailableCityLabel();
  const originLat =
    typeof normalizedOrigin?.lat === "number" ? normalizedOrigin.lat.toFixed(5) : "na";
  const originLng =
    typeof normalizedOrigin?.lng === "number" ? normalizedOrigin.lng.toFixed(5) : "na";

  return [
    plannerCityKey,
    getBlitzDateValue(),
    originType,
    originLabel,
    originLat,
    originLng,
    intentKeys.join("|"),
    getBlitzRouteContextKey(),
  ].join("::");
}

function syncBlitzContextState(nextContextKey, { clearState = true } = {}) {
  if (!nextContextKey || nextContextKey === blitzContextKey) {
    return false;
  }

  blitzContextKey = nextContextKey;
  blitzMemory = null;
  blitzInlineStatus = "";

  if (clearState) {
    blitzState = null;
  }

  return true;
}

async function resolveBlitzOriginPayload() {
  if (blitzOriginMode === "current_location") {
    try {
      const coords = await ensureCurrentLocation();
      return {
        type: "current_location",
        label: "Min plats",
        lat: coords.lat,
        lng: coords.lng,
      };
    } catch (_error) {
      blitzOriginMode = "selected_place";
      blitzInlineStatus = "Min plats gick inte att läsa just nu, så Blitz använder vald plats i stället.";
      renderHeroBlitz();
    }
  }

  const selectedOrigin = getSelectedBlitzOriginSource();

  if (
    selectedOrigin &&
    typeof selectedOrigin.lat === "number" &&
    typeof selectedOrigin.lng === "number"
  ) {
    return {
      type: "selected_place",
      label: selectedOrigin.label,
      lat: selectedOrigin.lat,
      lng: selectedOrigin.lng,
    };
  }

  return {
    type: "preset",
    label: buildUnavailableCityLabel(),
  };
}

function getBlitzIntentKeys() {
  const selectedIntentKeys = getSelectedIntentKeys();

  if (selectedIntentKeys.length) {
    return selectedIntentKeys;
  }

  if (Array.isArray(latestPlannerSnapshot?.intentKeys) && latestPlannerSnapshot.intentKeys.length) {
    return latestPlannerSnapshot.intentKeys.filter((intentKey) => plannerIntentByKey.has(intentKey));
  }

  return [...defaultPlannerIntentKeys];
}

function getActiveRoutePayloadForBlitz() {
  if (routeRenderMode !== "api" || !plannedDays.length) {
    return null;
  }

  const activeDay = getActivePlannedDay();

  if (!activeDay?.primary_route) {
    return null;
  }

  if (!activeRouteKey) {
    return activeDay.primary_route;
  }

  const [routeDate, routeId, variant] = String(activeRouteKey).split(":");
  const matchingDay = plannedDays.find((day) => day.date === routeDate) || activeDay;

  if (!matchingDay?.primary_route) {
    return null;
  }

  if (variant === "primary") {
    return matchingDay.primary_route;
  }

  if (variant?.startsWith("alt-")) {
    return (
      (matchingDay.alternatives || []).find((route) => route.id === routeId) ||
      matchingDay.primary_route
    );
  }

  return matchingDay.primary_route;
}

function isSaneHeroBlitzWalkMinutes(value) {
  return Number.isFinite(value) && value >= 0 && value <= heroBlitzMaxWalkMinutes;
}

function formatHeroBlitzWalkMeta(value, { unknownLabel = "gångtid okänd" } = {}) {
  return isSaneHeroBlitzWalkMinutes(value) ? `${value} min gång` : unknownLabel;
}

function getBlitzMoveTags(move) {
  if (!move) {
    return [];
  }

  if (move.kind === "mini_route_60") {
    return uniqueNonEmpty((move.route?.stops || []).flatMap((stop) => stop.tags || []));
  }

  return uniqueNonEmpty(move.stop?.tags || []);
}

function compressHeroBlitzReason(text) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] || normalized;
  const tightened = firstSentence
    .replace(
      /ligger nära nog för att kännas som ett faktiskt nästa drag, inte som en omväg\.?/gi,
      "Låg friktion för ett snabbt nästa drag.",
    )
    .replace(
      /ligger tillräckligt nära för att vara ett snabbt och trovärdigt nästa steg från där du står\.?/gi,
      "Enkel att ta nu utan att planera om resten av dagen.",
    )
    .replace(/här och nu utan att du behöver blåsa upp det till en hel dagsplan\.?/gi, "här och nu.")
    .replace(/\s+/g, " ")
    .trim();

  return clipText(tightened, heroBlitzReasonMaxLength);
}

function buildSpecificHeroBlitzReason(result) {
  const move = result?.best_move || null;

  if (!move) {
    return "";
  }

  const tags = new Set(getBlitzMoveTags(move));
  const area = move.stop?.area || move.route?.stops?.[0]?.area || "";
  const availability = move.availability || {};
  const pulseTitle = move.pulse_context?.title || "";
  const contextualReasons = Array.isArray(move.contextual_reasons) ? move.contextual_reasons : [];
  const secondaryReason = contextualReasons[1] || contextualReasons[0] || "";
  const pulseActive = Boolean(move.pulse_context?.title);
  const hasCalmSignal = tags.has("low-key") || tags.has("hidden gems");
  const hasDrinksSignal =
    tags.has("vin") || tags.has("öl") || tags.has("cocktail") || tags.has("nattliv");
  const hasFoodSignal = tags.has("mat");
  const hasSecondHandSignal =
    tags.has("second_hand") || tags.has("vintage") || tags.has("shopping") || tags.has("market");
  const hasViewSignal = tags.has("utsikt");

  if (hasSecondHandSignal && availability.kind === "shop" && availability.day_fit !== "strong") {
    return "Butiksspåret är starkare än marknad idag.";
  }

  if (pulseActive && pulseTitle) {
    if (hasViewSignal) {
      return "Pulse pekar mot utsiktsspåret just nu.";
    }

    if (hasDrinksSignal) {
      return "Pulse gör det här till ett starkt nästa glas just nu.";
    }
  }

  if (hasDrinksSignal && hasCalmSignal) {
    return `Bra nu för vin och lågmäld kväll${area ? ` i ${area}` : ""}.`;
  }

  if (hasDrinksSignal && !hasCalmSignal) {
    return `Starkast i området om du vill hålla kvällen lokal${area ? ` i ${area}` : ""}.`;
  }

  if (hasFoodSignal && hasCalmSignal) {
    return "Bra reset utan att blåsa upp kvällen.";
  }

  if (hasFoodSignal) {
    return `Låg friktion och lätt att fortsätta${area ? ` mot ${area}` : ""}.`;
  }

  if (hasViewSignal) {
    return "Bra nu om du vill få in utsikt utan att dra i gång en större runda.";
  }

  if (move.what_to_do_after) {
    const followup = String(move.what_to_do_after || "").trim();

    if (/ostiense/i.test(followup)) {
      return "Låg friktion och lätt att fortsätta mot Ostiense.";
    }

    if (/\b(vin|glas|drink|bar)\b/i.test(followup)) {
      return "Bra nu om du vill landa i ett glas utan att spräcka kvällen.";
    }
  }

  if (availability.day_fit === "weak" && availability.note) {
    return "Dubbelkolla läget, men det här spåret håller fortfarande ihop nu.";
  }

  if (secondaryReason) {
    return compressHeroBlitzReason(secondaryReason);
  }

  return "";
}

function buildHeroBlitzLabel(move) {
  if (!move) {
    return "BLITZ";
  }

  return move.kind === "mini_route_60" ? "BLITZ · 60 MIN" : "BLITZ";
}

function buildHeroBlitzMeta(result) {
  const move = result?.best_move || null;

  if (!move) {
    return isEnglishUi
      ? "Place, time, Pulse, and availability are weighed in the same decision."
      : "Plats, tid, Pulse och availability vägs in i samma beslut.";
  }

  if (move.kind === "mini_route_60") {
    const stopCount = Array.isArray(move.route?.stops) ? move.route.stops.length : 0;
    const km = Number.isFinite(move.route?.estimated_km) ? `${move.route.estimated_km} km` : null;
    const startMinutes = move.route?.stops?.[0]?.walk_from_previous_minutes;

    return [
      "60 min",
      stopCount ? `${stopCount} stopp` : null,
      km,
      formatHeroBlitzWalkMeta(startMinutes, { unknownLabel: "starttid okänd" }),
    ]
      .filter(Boolean)
      .join(" • ");
  }

  return [
    move.stop?.area || result?.context?.origin_label || null,
    formatHeroBlitzWalkMeta(move.walking_minutes),
    move.effort || null,
  ]
    .filter(Boolean)
    .join(" • ");
}

function buildHeroBlitzSummary(result) {
  const move = result?.best_move || null;

  if (!move) {
    return t("blitz.defaultSummary", "När du redan är ute i staden väljer Blitz vad som känns starkast just nu.");
  }

  return (
    buildSpecificHeroBlitzReason(result) ||
    compressHeroBlitzReason(move.why_now) ||
    compressHeroBlitzReason(move.contextual_reasons?.[0]) ||
    t("blitz.defaultFallback", "Blitz valde det här som det tydligaste nästa draget just nu.")
  );
}

function buildHeroBlitzFollowup(result) {
  const move = result?.best_move || null;

  if (!move?.what_to_do_after) {
    return "";
  }

  const followup = String(move.what_to_do_after || "").trim();

  if (!followup) {
    return "";
  }

  if (!/\b(stanna|låt|fortsätt|kör)\b/i.test(followup)) {
    return "";
  }

  return clipText(followup, heroBlitzFollowupMaxLength);
}

function buildBlitzFollowupText(result) {
  const followup = buildHeroBlitzFollowup(result);

  return followup ? `Sedan: ${followup}` : "";
}

function buildBlitzTagTexts(result) {
  const move = result?.best_move || {};
  const tags = [];

  tags.push(move.kind === "mini_route_60" ? "60 min" : t("blitz.nextStop", "Nästa stopp"));

  if (move.pulse_context?.title) {
    tags.push("Pulse");
  }

  if (move.availability?.verify_recommended && tags.length < 2) {
    tags.push(t("blitz.check", "Dubbelkolla läget"));
  }

  return tags.slice(0, 2);
}

function createBlitzGuideStop(stop, index, originLabel, previousLabel = null) {
  return {
    order: index + 1,
    label: stop.label,
    area: stop.area,
    summary: stop.tags?.length
      ? `Blitz valde stoppet för ${stop.tags.slice(0, 3).join(", ")}.`
      : "Kompakt Blitz-stopp för nästa timme.",
    meta: [
      index === 0 ? `Från ${originLabel}` : null,
      Number.isFinite(stop.walk_from_previous_minutes)
        ? `${stop.walk_from_previous_minutes} min gång`
        : null,
    ]
      .filter(Boolean)
      .join(" • "),
    incomingLeg:
      index === 0
        ? null
        : {
            fromLabel: previousLabel || originLabel,
            toLabel: stop.label,
            distanceKm: null,
            minutes: stop.walk_from_previous_minutes || null,
          },
  };
}

function buildBlitzRouteGuideView(result) {
  const move = result?.best_move;
  const context = result?.context || {};

  if (!move || move.kind !== "mini_route_60" || !move.route) {
    return null;
  }

  const routeStops = Array.isArray(move.route.stops) ? move.route.stops : [];
  const lastStop = routeStops[routeStops.length - 1] || null;
  const routePoints = [
    {
      label: context.origin_label || "Start",
      lat: context.origin?.lat,
      lng: context.origin?.lng,
    },
    ...routeStops.map((stop) => ({
      label: stop.label,
      lat: stop.lat,
      lng: stop.lng,
    })),
  ].filter((point) => typeof point.lat === "number" && typeof point.lng === "number");

  return {
    title: move.title,
    vibe: "Blitz",
    length: formatApproxKm(move.route.estimated_km),
    summary: move.why_now,
    why: [...(move.contextual_reasons || []), move.what_to_do_after].filter(Boolean).join(" "),
    path:
      routeStops.length > 1
        ? `${context.origin_label} -> ${routeStops.map((stop) => stop.label).join(" -> ")}`
        : `${context.origin_label} -> ${routeStops[0]?.label || "nästa stopp"}`,
    anchor: `Start: ${context.origin_label || "Din plats"}`,
    walk: `Mini-rutt • slut: ${lastStop?.area || lastStop?.label || "öppet"}`,
    startAnchorLabel: context.origin_label || "Din plats",
    endAnchorLabel: lastStop?.label || context.origin_label || "Din plats",
    routeShapeLabel: "Blitz",
    routeShape: "arc",
    routeLink: createRouteDirectionsUrl(routePoints),
    mapRoutePoints: routePoints,
    mapPathPoints: routePoints,
    openingWarnings: move.caution_notes || [],
    pulseNote: move.pulse_context?.why_it_matters || null,
    liveEventFitNote: null,
    venueSpecials: move.local_truth?.route_context_notes?.map((note) => note.text) || [],
    budgetNote: null,
    hiddenMentions: [],
    barMentions: [],
    dateLabel: context.date ? formatSwedishDate(context.date) : "Blitz just nu",
    dayProfileLabel: "Nästa timmen",
    pacingLabel: move.effort || "Kompakt",
    anchorZone: lastStop?.area || buildUnavailableCityLabel(),
    geoFitNote: null,
    longestLegMinutes: Math.max(...routeStops.map((stop) => Number(stop.walk_from_previous_minutes) || 0), 0),
    longestLegKm: null,
    averageLegMinutes: routeStops.length
      ? Math.round(
          routeStops.reduce((sum, stop) => sum + (Number(stop.walk_from_previous_minutes) || 0), 0) /
            routeStops.length,
        )
      : 0,
    legSummary: Number.isFinite(move.walking_minutes)
      ? `${move.walking_minutes} min gång fördelat över nästa timme.`
      : null,
    engineBadges: ["Blitz", move.availability?.kind || null].filter(Boolean),
    anchorExplanation:
      move.availability?.day_fit === "strong"
        ? "Blitz trycker upp det här spåret eftersom dagen faktiskt passar den här typen av stopp just nu."
        : "Blitz håller rutten kompakt och väljer stopp som fungerar här och nu utan att bli en halv dagsplan.",
    guideStops: routeStops.map((stop, index) =>
      createBlitzGuideStop(
        stop,
        index,
        context.origin_label || "Din plats",
        index === 1 ? context.origin_label || "Din plats" : routeStops[index - 1]?.label || null,
      ),
    ),
    stopItems: routeStops.map((stop, index) => ({
      order: index + 1,
      label: stop.label,
      area: stop.area,
      tagSummary: (stop.tags || []).slice(0, 3).join(" • "),
      summary: stop.tags?.length ? stop.tags.join(", ") : "Blitz-stopp",
      text: `${index + 1}. ${stop.label}`,
      query: stop.label,
      source: "curated",
      sourceLabel: "Blitz",
      incomingLeg:
        index === 0
          ? null
          : {
              fromLabel: routeStops[index - 1]?.label || context.origin_label || "Start",
              toLabel: stop.label,
              distanceKm: null,
              minutes: stop.walk_from_previous_minutes || null,
            },
    })),
  };
}

function openHeroBlitzMove() {
  if (!blitzState?.best_move) {
    loadHeroBlitz({ openAfter: true }).catch(() => {});
    return;
  }

  if (blitzState.best_move.kind === "mini_route_60") {
    const guideView = buildBlitzRouteGuideView(blitzState);

    if (guideView) {
      openRouteGuide(guideView);
    }

    return;
  }

  openPlaceDrawerByQuery(blitzState.best_move.stop?.label || blitzState.best_move.title);
}

function renderHeroBlitz() {
  if (!isRomeCuratedMode) {
    const previewCard = buildPreviewHeroCard();

    if (heroBlitzCard) {
      heroBlitzCard.dataset.blitzKind = "preview";
    }
    heroBlitzLabel.textContent = previewCard.label;
    heroBlitzTitle.textContent = previewCard.title;
    heroBlitzSummary.textContent = previewCard.summary;
    heroBlitzMeta.textContent = previewCard.meta;
    heroBlitzFollowup.hidden = true;
    heroBlitzTags.innerHTML = "";
    previewCard.tags.forEach((tagText) => {
      const chip = document.createElement("span");
      chip.textContent = tagText;
      heroBlitzTags.appendChild(chip);
    });
    heroBlitzOriginSwitch.hidden = true;
    heroBlitzApplyButton.hidden = true;
    heroBlitzShuffleButton.hidden = true;
    heroBlitzApplyButton.disabled = true;
    heroBlitzShuffleButton.disabled = true;
    return;
  }

  heroBlitzOriginSwitch.hidden = false;
  heroBlitzSelectedOriginButton?.classList.toggle(
    "is-active",
    blitzOriginMode === "selected_place",
  );
  heroBlitzCurrentOriginButton?.classList.toggle(
    "is-active",
    blitzOriginMode === "current_location",
  );
  heroBlitzApplyButton.hidden = false;
  heroBlitzShuffleButton.hidden = false;

  if (blitzLoading && !blitzState?.best_move) {
    if (heroBlitzCard) {
      heroBlitzCard.dataset.blitzKind = "loading";
    }
    heroBlitzLabel.textContent = "BLITZ";
    heroBlitzTitle.textContent = t("blitz.loadingTitle", "Laddar nästa drag...");
    heroBlitzSummary.textContent =
      t("blitz.loadingSummary", "Blitz väljer ett trovärdigt nästa drag utifrån plats, tid och stadspuls.");
    heroBlitzMeta.textContent =
      blitzOriginMode === "current_location"
        ? (isEnglishUi ? "Uses my location if it can be read." : "Utgår från min plats om den går att läsa.")
        : (isEnglishUi ? "Uses selected place and today’s intent." : "Utgår från vald plats och dagens intent.");
    heroBlitzFollowup.hidden = !blitzInlineStatus;
    heroBlitzFollowup.textContent = blitzInlineStatus;
    heroBlitzTags.innerHTML = "";
    [(isEnglishUi ? "Now" : "Nu"), "Reroll"].forEach((tagText) => {
      const chip = document.createElement("span");
      chip.textContent = tagText;
      heroBlitzTags.appendChild(chip);
    });
    heroBlitzApplyButton.textContent = t("blitz.apply", "Kör Blitz");
    heroBlitzShuffleButton.textContent = `↻ ${isEnglishUi ? "New" : "Nytt"}`;
    heroBlitzApplyButton.disabled = true;
    heroBlitzShuffleButton.disabled = true;
    return;
  }

  const move = blitzState?.best_move || null;

  if (!move) {
    if (heroBlitzCard) {
      heroBlitzCard.dataset.blitzKind = "empty";
    }
    heroBlitzLabel.textContent = "BLITZ";
    heroBlitzTitle.textContent = blitzInlineStatus
      ? t("blitz.reloadTitle", "Blitz hämtar nytt läge")
      : t("shell.curated.wildcardTitle", "Nästa drag, just nu");
    heroBlitzSummary.textContent = blitzInlineStatus
      ? t("blitz.reloadSummary", "Planner och Pulse fungerar fortfarande medan nästa drag laddar om i bakgrunden.")
      : t("shell.curated.wildcardSummary", "Plats, tid och dagens signaler vägs in.");
    heroBlitzMeta.textContent = t(
      "blitz.defaultMeta",
      "Utgå från plats och tid när du bara vill veta vad som känns starkast nu.",
    );
    heroBlitzFollowup.hidden = !blitzInlineStatus;
    heroBlitzFollowup.textContent = blitzInlineStatus;
    heroBlitzTags.innerHTML = "";
    heroBlitzApplyButton.textContent = t("blitz.apply", "Kör Blitz");
    heroBlitzShuffleButton.textContent = `↻ ${isEnglishUi ? "New" : "Nytt"}`;
    heroBlitzApplyButton.disabled = blitzLoading;
    heroBlitzShuffleButton.disabled = true;
    heroBlitzShuffleButton.hidden = true;
    return;
  }

  if (heroBlitzCard) {
    heroBlitzCard.dataset.blitzKind = move.kind || "single_stop";
  }
  blitzInlineStatus = "";
  heroBlitzLabel.textContent = buildHeroBlitzLabel(move);
  heroBlitzTitle.textContent = move.title;
  heroBlitzMeta.textContent = buildHeroBlitzMeta(blitzState);
  heroBlitzSummary.textContent = buildHeroBlitzSummary(blitzState);

  const followupText = buildBlitzFollowupText(blitzState);
  heroBlitzFollowup.hidden = !followupText;
  heroBlitzFollowup.textContent = followupText;
  heroBlitzTags.innerHTML = "";
  buildBlitzTagTexts(blitzState).forEach((tagText) => {
    const chip = document.createElement("span");
    chip.textContent = tagText;
    heroBlitzTags.appendChild(chip);
  });
  heroBlitzApplyButton.textContent =
    move.kind === "mini_route_60"
      ? t("blitz.openMiniRoute", "Öppna mini-rutt")
      : t("blitz.openStop", "Öppna stopp");
  heroBlitzShuffleButton.textContent = `↻ ${isEnglishUi ? "New" : "Nytt"}`;
  heroBlitzApplyButton.disabled = blitzLoading;
  heroBlitzShuffleButton.disabled = blitzLoading;
}

async function applyWildcardToPlanner(wildcard, { autoPlan = true, sourceLabel = null } = {}) {
  if (!wildcard?.snapshot) {
    return;
  }

  activeHeroWildcardId = wildcard.id;
  applyPlannerSnapshot(wildcard.snapshot);
  renderHeroBlitz();
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
      !isRomeCuratedMode
        ? buildNonRomeRouteSummary()
        : "Kvällsidén laddades, men live-planeringen svarade inte just nu. De kuraterade Rom-rutterna ligger kvar som fallback.",
    );
  }
}

async function loadHeroBlitz({ openAfter = false } = {}) {
  if (!isRomeCuratedMode) {
    renderHeroBlitz();
    return null;
  }

  let requestId = blitzLoadRequestId;
  blitzLoading = true;
  renderHeroBlitz();

  try {
    const origin = await resolveBlitzOriginPayload();
    const contextChanged = syncBlitzContextState(buildBlitzContextKey(origin));
    requestId = ++blitzLoadRequestId;

    if (contextChanged) {
      renderHeroBlitz();
    }
    const response = await fetch("/api/blitz", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        city: plannerCityKey,
        date: getBlitzDateValue(),
        now: new Date().toISOString(),
        origin,
        intent_keys: getBlitzIntentKeys(),
        memory: blitzMemory,
        previous_route: getActiveRoutePayloadForBlitz(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Blitz failed: ${response.status}`);
    }

    const payload = await response.json();

    if (requestId !== blitzLoadRequestId) {
      return payload;
    }

    blitzState = payload;
    blitzMemory = payload.memory || blitzMemory;
    blitzInlineStatus = "";
    renderHeroBlitz();

    if (openAfter) {
      openHeroBlitzMove();
    }

    return payload;
  } catch (error) {
    if (requestId !== blitzLoadRequestId) {
      return null;
    }

    blitzState = null;
    blitzInlineStatus = t("blitz.inlineBusy", "Blitz hämtar nytt läge just nu. Försök igen om en liten stund.");
    renderHeroBlitz();
    throw error;
  } finally {
    if (requestId === blitzLoadRequestId) {
      blitzLoading = false;
      renderHeroBlitz();
    }
  }
}

function buildLegacyPulseItems(moments = []) {
  const levelOrder = ["city", "neighborhood", "venue", "venue"];

  return moments.map((moment, index) => ({
    id: moment.id || `legacy-pulse-${index}`,
    level: levelOrder[index] || "venue",
    kind: moment.kindLabel || (isEnglishUi ? "City pulse" : "Stadspuls"),
    title: moment.title,
    where: (moment.areas || []).join(" • ") || buildUnavailableCityLabel(),
    when: isEnglishUi ? "Today" : "I dag",
    blurb: moment.note,
    why_it_matters: isEnglishUi
      ? "Use the signal as a small steering hint while you build the day below."
      : "Använd signalen som ett litet styrmedel när du bygger dagen nedan.",
    matches_vibes: moment.tags || [],
    linked_wildcard_id: moment.linked_wildcard_id || null,
    priority: 1,
  }));
}

function buildPulseMetaLabel(filteredItems) {
  // Replaces the old "N signaler • M nivåer" string with a label that
  // uses real user-facing vocabulary. Live count is derived from the
  // engine signals[] when present; otherwise we just show the total.
  const total = filteredItems.length;

  if (total === 0) {
    return tf(
      "pulse.metaSignalsZero",
      {},
      isEnglishUi ? "No signals today" : "Inga signaler idag",
    );
  }

  const signals = Array.isArray(cityPulseState?.signals) ? cityPulseState.signals : [];
  const liveCount = signals.filter((signal) => signal?.type === "live_event_nearby").length;

  if (liveCount > 0) {
    // When every signal is a live event, "2 signaler · 2 live" is redundant.
    // Collapse to "2 live-signaler idag" / "2 live signals today".
    if (liveCount === total) {
      if (total === 1) {
        return t(
          "pulse.metaSignalsAllLiveOne",
          isEnglishUi ? "1 live signal today" : "1 live-signal idag",
        );
      }
      return tf(
        "pulse.metaSignalsAllLive",
        { signals: total },
        isEnglishUi ? `${total} live signals today` : `${total} live-signaler idag`,
      );
    }
    return tf(
      "pulse.metaSignalsWithLive",
      { signals: total, live: liveCount },
      isEnglishUi
        ? `${total} signals · ${liveCount} live`
        : `${total} signaler · ${liveCount} live`,
    );
  }

  if (total === 1) {
    return t(
      "pulse.metaSignalsOne",
      isEnglishUi ? "1 signal today" : "1 signal idag",
    );
  }

  return tf(
    "pulse.metaSignals",
    { signals: total },
    isEnglishUi ? `${total} signals today` : `${total} signaler idag`,
  );
}

function getNormalizedCityPulseItems() {
  // Prefer the new engine signals[] when present. Falls back to the
  // legacy items[] shape during the one-release compat window, and to
  // buildLegacyPulseItems() if neither is populated.
  if (Array.isArray(cityPulseState?.signals) && cityPulseState.signals.length) {
    return cityPulseState.signals.filter(Boolean);
  }

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

function getPulseReferenceTime(dateString, timeKey) {
  const romeNow = getCityDateTimeSnapshot();

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

  let label = item.when || (isEnglishUi ? "Today" : "I dag");

  if (status === "live") {
    label = Number.isFinite(endMinutes)
      ? isEnglishUi
        ? `Live now • until ${formatPulseClock(endMinutes)}`
        : `Pågår nu • till ${formatPulseClock(endMinutes)}`
      : isEnglishUi
        ? "Live now"
        : "Pågår nu";
  } else if (status === "upcoming") {
    label = Number.isFinite(startMinutes)
      ? isEnglishUi
        ? `Soon • ${formatPulseClock(startMinutes)}`
        : `Snart • ${formatPulseClock(startMinutes)}`
      : isEnglishUi
        ? "Soon"
        : "Snart";
  } else if (status === "later") {
    label = Number.isFinite(startMinutes)
      ? isEnglishUi
        ? `Later • ${formatPulseClock(startMinutes)}`
        : `Senare • ${formatPulseClock(startMinutes)}`
      : item.when || (isEnglishUi ? "Later today" : "Senare i dag");
  } else if (status === "past") {
    label = Number.isFinite(endMinutes)
      ? isEnglishUi
        ? `Passed • ${formatPulseClock(endMinutes)}`
        : `Passerade • ${formatPulseClock(endMinutes)}`
      : isEnglishUi
        ? "Passed"
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
  const day = parseIsoDateToUtcNoon(dateString || getTodayIsoDate())?.getUTCDay();
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
  const catalog = hasRomeFrontendContent ? new Map(getRomeFallbackPointCatalog()) : new Map();

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
      label: item.title || item.where || buildUnavailableCityLabel(),
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
    return isEnglishUi ? "risk of rain" : "risk för regn";
  }

  if (weather.condition === "sun") {
    return weather.isDay === false
      ? (isEnglishUi ? "clear evening" : "klar kväll")
      : (isEnglishUi ? "clear and open" : "klart och öppet");
  }

  if (weather.condition === "clouds") {
    return isEnglishUi ? "cloudy but walkable" : "molnigt men gångbart";
  }

  return isEnglishUi ? "mixed weather" : "blandat väder";
}

function getPulseClothingAdvice(weather) {
  if (!weather) {
    return "";
  }

  const maxTemp = Number(weather.maxTemp);
  const minTemp = Number(weather.minTemp);
  const rainNote = weather.condition === "rain"
    ? (isEnglishUi ? ", umbrella helps" : ", gärna paraply")
    : "";

  if (Number.isFinite(maxTemp) && maxTemp >= 30) {
    return isEnglishUi
      ? `as light as possible in the middle of the day${rainNote}`
      : `så lätt som möjligt mitt på dagen${rainNote}`;
  }

  if (Number.isFinite(maxTemp) && maxTemp >= 24 && Number.isFinite(minTemp) && minTemp >= 17) {
    return isEnglishUi
      ? `a t-shirt or shirt is enough, add a light layer later${rainNote}`
      : `t-shirt eller skjorta räcker, tunt lager sent${rainNote}`;
  }

  if (Number.isFinite(maxTemp) && maxTemp >= 20) {
    return isEnglishUi
      ? `a light layer works by day, a thin jacket makes the evening better${rainNote}`
      : `lätt lager funkar dagtid, tunn jacka gör kvällen bättre${rainNote}`;
  }

  if (Number.isFinite(maxTemp) && maxTemp >= 15) {
    return isEnglishUi
      ? `a thin jacket or knit layer feels smart${rainNote}`
      : `tunn jacka eller stickat känns smart${rainNote}`;
  }

  return isEnglishUi
    ? `a jacket is recommended even during the day${rainNote}`
    : `jacka rekommenderas även dagtid${rainNote}`;
}

function buildPulseWeatherBrief(weather, dateString) {
  if (!weather) {
    return isEnglishUi
      ? "Weather is missing right now, so Pulse is leaning only on city rhythm and venue-level signals."
      : "Väder saknas just nu, så LIVE lutar sig bara på stadspuls och platsnivå.";
  }

  // The weather card headline already carries the temperature lead
  // (e.g. "20° nu"). The clothing card already carries the clothing
  // advice. Repeating either here would create the "20° nu • molnigt
  // men gångbart • lätt lager…" cascade where every line says the same
  // thing twice. Keep the brief to a single piece of honest signal:
  // the condition label. If we have no condition for today, fall back
  // to a tomorrow/range hint so the line is never empty when weather
  // is present.
  const cityNow = getCityDateTimeSnapshot();
  const isToday = (dateString || cityNow.date) === cityNow.date;
  const maxTemp = Number.isFinite(weather.maxTemp) ? Math.round(weather.maxTemp) : null;
  const minTemp = Number.isFinite(weather.minTemp) ? Math.round(weather.minTemp) : null;
  const rangeLabel =
    Number.isFinite(minTemp) && Number.isFinite(maxTemp) ? `${minTemp}–${maxTemp}°` : null;

  const condition = getPulseConditionLabel(weather);
  if (condition) {
    return condition;
  }

  if (!isToday && rangeLabel) {
    return isEnglishUi ? `${rangeLabel} expected` : `${rangeLabel} väntat`;
  }

  return isEnglishUi ? "Weather set" : "Väder klart";
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
    ? isEnglishUi
      ? `Selected day • ${formatCompactSwedishDate(dateString)}`
      : `Vald dag • ${formatCompactSwedishDate(dateString)}`
    : isEnglishUi
      ? `Now ${reference.label} in ${buildUnavailableCityLabel()}`
      : `Nu ${reference.label} i ${buildUnavailableCityLabel()}`;

  if (liveItems.length && nextItem && nextItem !== liveItems[0]) {
    const nextTime = Number.isFinite(nextItem.timing?.startMinutes)
      ? formatPulseClock(nextItem.timing.startMinutes)
      : isEnglishUi
        ? "later"
        : "senare";
    return isEnglishUi
      ? `${prefix} • ${liveItems.length} live • next ${nextTime} ${truncatePulseLabel(nextItem.title, 34)}`
      : `${prefix} • ${liveItems.length} pågår • nästa ${nextTime} ${truncatePulseLabel(nextItem.title, 34)}`;
  }

  if (liveItems.length) {
    return isEnglishUi
      ? `${prefix} • ${liveItems.length} signal${liveItems.length > 1 ? "s" : ""} live now`
      : `${prefix} • ${liveItems.length} signal${liveItems.length > 1 ? "er" : ""} pågår nu`;
  }

  if (nextItem) {
    const nextTime = Number.isFinite(nextItem.timing?.startMinutes)
      ? formatPulseClock(nextItem.timing.startMinutes)
      : isEnglishUi
        ? "soon"
        : "snart";
    return isEnglishUi
      ? `${prefix} • next ${nextTime} ${truncatePulseLabel(nextItem.title, 34)}`
      : `${prefix} • nästa ${nextTime} ${truncatePulseLabel(nextItem.title, 34)}`;
  }

  return reference.isPreview
    ? isEnglishUi
      ? `Selected day • ${formatCompactSwedishDate(dateString)} • no strong signals yet`
      : `Vald dag • ${formatCompactSwedishDate(dateString)} • inga starka signaler ännu`
    : isEnglishUi
      ? `Now ${reference.label} in ${buildUnavailableCityLabel()} • no strong signals right now`
      : `Nu ${reference.label} i ${buildUnavailableCityLabel()} • inga starka signaler just nu`;
}

function buildPulseWeatherValue(weather, dateString) {
  if (!weather) {
    return isEnglishUi ? "Weather missing" : "Väder saknas";
  }

  const romeNow = getCityDateTimeSnapshot();
  const isToday = (dateString || romeNow.date) === romeNow.date;
  const currentTemp = Number.isFinite(weather.currentTemp) ? Math.round(weather.currentTemp) : null;
  const maxTemp = Number.isFinite(weather.maxTemp) ? Math.round(weather.maxTemp) : null;
  const minTemp = Number.isFinite(weather.minTemp) ? Math.round(weather.minTemp) : null;

  if (isToday && currentTemp !== null) {
    return isEnglishUi ? `${currentTemp}° now` : `${currentTemp}° nu`;
  }

  if (maxTemp !== null && minTemp !== null) {
    return isEnglishUi ? `${maxTemp}° / ${minTemp}° evening` : `${maxTemp}° / ${minTemp}° kväll`;
  }

  if (maxTemp !== null) {
    return isEnglishUi ? `${maxTemp}° expected` : `${maxTemp}° väntat`;
  }

  return isEnglishUi ? "Weather set" : "Väder klart";
}

function getPulseClothingHeadline(weather) {
  if (!weather) {
    return isEnglishUi ? "Local layer" : "Lokalt lager";
  }

  const maxTemp = Number(weather.maxTemp);

  if (Number.isFinite(maxTemp) && maxTemp >= 28) {
    return isEnglishUi ? "Cool and light" : "Svalt och lätt";
  }

  if (Number.isFinite(maxTemp) && maxTemp >= 22) {
    return isEnglishUi ? "T-shirt + light layer" : "T-shirt + lätt lager";
  }

  if (Number.isFinite(maxTemp) && maxTemp >= 17) {
    return isEnglishUi ? "Shirt + thin jacket" : "Skjorta + tunn jacka";
  }

  return isEnglishUi ? "Jacket recommended" : "Jacka rekommenderas";
}

function buildPulseTeaserSummary() {
  const availableDates = getLiveEditionDates();
  const targetDate = availableDates[0] || cityPulseState?.date || getTodayIsoDate();
  const dayCount = plannedDays.length || availableDates.length;
  const weatherLine = buildPulseWeatherBrief(cityPulseState?.weather, targetDate);
  const plannedContext = routeRenderMode === "api" && plannedDays.length;

  if (plannedContext) {
    const activeDate = activePlannedDate || targetDate;
    return `${formatSwedishDate(activeDate)} • ${weatherLine}`;
  }

  if (plannedDays.length) {
    return isEnglishUi
      ? `Tied to ${dayCount} selected day${dayCount > 1 ? "s" : ""}. ${weatherLine}`
      : `Kopplad till ${dayCount} vald dag${dayCount > 1 ? "ar" : ""}. ${weatherLine}`;
  }

  return isEnglishUi
    ? `${weatherLine} Open Pulse when you want to read today’s edition more like a local layer.`
    : `${weatherLine} Öppna live-läget när du vill läsa dagens edition mer som en lokal utgåva.`;
}

function focusActiveDayLiveSection() {
  const dayCard = routeResults?.querySelector(".planner-day-card");
  const dayEvents = dayCard?.querySelector(".planner-day-events:not([hidden])");
  const target = dayEvents || dayCard;

  if (!target) {
    return false;
  }

  target.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });

  return true;
}

function renderCityPulseTeaser() {
  if (!cityPulseTeaser || !cityPulseTeaserTitle || !cityPulseTeaserSummary || !cityPulseTeaserLabel) {
    return;
  }

  const targetDate = ensureActiveLiveDate();
  const plannedContext = routeRenderMode === "api" && plannedDays.length;
  const prePlanContext = !plannedContext;
  const activeDay = getActivePlannedDay();
  const activeDayEventCount = activeDay?.live_events?.length || 0;
  const weekdayLabel =
    cityPulseState?.weekday_label ||
    getFallbackPulseDateLabels(targetDate).weekdayLabel;
  const dateLabel =
    cityPulseState?.date_label ||
    getFallbackPulseDateLabels(targetDate).dateLabel;

  cityPulseTeaser.classList.toggle("is-route-context", plannedContext);
  cityPulseTeaser.classList.toggle("is-day-handoff", plannedContext);
  cityPulseTeaser.classList.toggle("is-pre-plan", prePlanContext);

  if (plannedContext) {
    cityPulseTeaserLabel.textContent = t("pulse.teaserPlannedLabel", "PASSAR DIN DAG");
    cityPulseTeaserTitle.textContent = activeDayEventCount
      ? tf(
          "pulse.teaserPlannedTitle",
          { count: Math.min(activeDayEventCount, 2) },
          `${Math.min(activeDayEventCount, 2)} live-spår ligger nära rutten`,
        )
      : t("pulse.teaserPlannedTitleEmpty", "Live-lagret finns längre ner om du vill justera dagen");
    cityPulseTeaserSummary.textContent = activeDayEventCount
      ? tf(
          "pulse.teaserPlannedSummary",
          { date: formatSwedishDate(activeDay?.date || targetDate) },
          `De starkaste spåren ligger direkt efter huvudrutten för ${formatSwedishDate(activeDay?.date || targetDate)}.`,
        )
      : tf(
          "pulse.teaserPlannedSummaryEmpty",
          { city: buildUnavailableCityLabel() },
          `Öppna live-läget längre ner när du vill väga in ${buildUnavailableCityLabel()} utan att lämna planen.`,
        );
  } else {
    if (isRomeCuratedMode) {
      cityPulseTeaserLabel.textContent = t("pulse.teaserPrePlanLabel", "Dagens signaler");
      cityPulseTeaserTitle.textContent = t("pulse.teaserPrePlanTitle", "Öppna Pulse när du vill väga in läget");
      cityPulseTeaserSummary.textContent = t(
        "pulse.teaserPrePlanSummary",
        "Helt valfritt före planeringen. Tänk det som ett extra lager ovanpå dagen.",
      );
    } else {
      cityPulseTeaserLabel.textContent = isInternalCityMode
        ? t("preview.internalStub", "INTERN STUB")
        : tf(
            "pulse.previewTimeMeta",
            { city: buildUnavailableCityLabel(), weekday: weekdayLabel, date: dateLabel },
            `Just nu i ${buildUnavailableCityLabel()} • ${weekdayLabel} ${dateLabel}`,
          );
      cityPulseTeaserTitle.textContent =
        cityPulseState?.headline ||
        (isEnglishUi
          ? `Current in ${buildUnavailableCityLabel()}`
          : `Aktuellt i ${buildUnavailableCityLabel()}`);
      cityPulseTeaserSummary.textContent =
        cityPulseState?.subhead || cityPulseState?.note || buildPulseTeaserSummary();
    }
  }

  if (cityPulseTeaserButton) {
    cityPulseTeaserButton.textContent = plannedContext
      ? activeDayEventCount
        ? t("pulse.teaserButtonLive", "Se dagens live")
        : "Pulse"
      : isRomeCuratedMode
        ? "Pulse"
        : t("pulse.teaserButtonPreview", "Läs preview");
  }
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

  return `${tf("place.bestWithRoute", { label: formatSwedishDate(day.date) }, `Passar bäst med ${formatSwedishDate(day.date)}`)}${event.best_route_label ? ` • ${event.best_route_label}` : ""}`;
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
      ? `${isEnglishUi ? "Day" : "Dag"} ${index + 1} • ${formatCompactSwedishDate(date)}`
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
      marker.title = `${item.title} • ${item.timing?.label || item.when || t("pulse.today", "I dag")}`;
      marker.addEventListener("click", () => {
        openCityPulseItem(item);
      });
      track.appendChild(marker);
    });

  const nowMarker = document.createElement("span");
  nowMarker.className = "city-pulse-timeline-now";
  nowMarker.style.left = `${pulseTimelineOffset(reference.totalMinutes)}%`;
  nowMarker.textContent = reference.isPreview
    ? tf("pulse.timelinePreview", { label: reference.label }, `Preview • ${reference.label}`)
    : tf("pulse.timelineNow", { label: reference.label }, `Nu • ${reference.label}`);
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
  const scopeLabel =
    activePulseScope === "all"
      ? buildLiveScopeAllLabel()
      : cityPulseScopeMeta[activePulseScope]?.label || buildLiveScopeAllLabel();
  const timeLabel = cityPulseTimeMeta[activePulseTime]?.label || "Just nu";
  const radiusLabel = cityPulseRadiusMeta[activePulseRadiusKey]?.label || "5 km";

  if (cityPulseScopeStatus) {
    return cityPulseScopeStatus;
  }

  if (activePulseScope === "nearby") {
    return tf(
      "pulse.utilityNearby",
      { scope: scopeLabel, visible: visibleItems.length, radius: radiusLabel, time: timeLabel },
      `${scopeLabel} visar ${visibleItems.length} signaler inom cirka ${radiusLabel}. ${timeLabel} håller fokus på det som faktiskt spelar roll nu.`,
    );
  }

  return tf(
    "pulse.utilityAll",
    {
      scope: scopeLabel,
      total: totalItems.length,
      radius: radiusLabel,
      timeLower: timeLabel.toLowerCase(),
    },
    `${scopeLabel} visar ${totalItems.length} signaler. Växla till Nära mig för ett närmare lager inom cirka ${radiusLabel}, eller låt ${timeLabel.toLowerCase()} rensa bort det som inte är aktuellt.`,
  );
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

function buildPulseSourceLabel(item) {
  const source = item?.source;
  if (!source || !source.kind) return "";
  if (source.kind === "editorial") return "";

  const label = String(source.label || "").trim();
  if (!label) return "";

  if (source.kind === "live_feed") {
    return isEnglishUi ? `via ${label}` : `via ${label}`;
  }
  // computed | weather — show short tag only when it adds clarity
  return label;
}

function createPulseEntry(item) {
  const article = document.createElement("article");
  const top = document.createElement("div");
  const signalChip = document.createElement("span");
  const kind = document.createElement("span");
  const when = document.createElement("span");
  const where = document.createElement("p");
  const blurb = document.createElement("p");
  const sourceLabel = document.createElement("p");
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
  signalChip.className = `pulse-entry-signal pulse-entry-signal-${item.type || item.signal_type || "default"}`;
  kind.className = "pulse-entry-kind";
  when.className = `pulse-entry-when pulse-entry-when-${status}`;
  where.className = "pulse-entry-where";
  blurb.className = "pulse-entry-blurb";
  sourceLabel.className = "pulse-entry-source";
  matchNote.className = "pulse-entry-match";
  reasonWrap.className = "pulse-entry-reason";
  reasonLabel.className = "pulse-entry-reason-label";
  reason.className = "pulse-entry-reason-copy";
  tags.className = "pulse-entry-tags";
  actions.className = "pulse-entry-actions";

  // Primary chip: signal_label (when chippable). Falls back to kind so
  // older items without a signal_label keep rendering.
  const primaryLabel = item.signal_label || null;
  signalChip.textContent = primaryLabel || "";
  signalChip.hidden = !primaryLabel;

  kind.textContent = item.kind || (isEnglishUi ? "City pulse" : "Stadspuls");
  when.textContent = item.timing?.label || item.when || (isEnglishUi ? "Today" : "I dag");

  if (item.when && item.timing?.label && item.timing.label !== item.when) {
    when.title = item.when;
  }

  // Selective source label: shown only when it adds clarity to the user.
  // Live feeds get "via {label}", computed sources show a short tag like
  // "sunset". Editorial sources never show a badge in v1.
  sourceLabel.textContent = buildPulseSourceLabel(item);
  sourceLabel.hidden = !sourceLabel.textContent;

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

  where.textContent = item.where ? `◉ ${item.where}` : `◉ ${buildUnavailableCityLabel()}`;
  blurb.textContent = item.blurb || item.note || "";
  matchNote.textContent = getLiveMatchSummaryForPulseItem(item);
  matchNote.hidden = !matchNote.textContent;
  reasonLabel.textContent = t("pulse.reason", "Varför det spelar roll");
  reason.textContent =
    item.why_it_matters ||
    t("pulse.reasonFallback", "Det här är tänkt som en liten lokal signal som hjälper dagens rutt kännas mer självklar.");

  if (primaryLabel) {
    top.appendChild(signalChip);
  }
  top.append(kind, when);
  reasonWrap.append(reasonLabel, reason);
  article.append(top, title, where, blurb);
  if (sourceLabel.textContent) {
    article.appendChild(sourceLabel);
  }
  if (matchNote.textContent) {
    article.appendChild(matchNote);
  }
  article.appendChild(reasonWrap);

  (item.matches_vibes || []).slice(0, 4).forEach((vibe) => {
    const chip = document.createElement("span");
    chip.textContent = `${t("pulse.fits", "passar")} • ${cityPulseVibeLabels[vibe] || vibe}`;
    tags.appendChild(chip);
  });

  if (tags.childNodes.length) {
    article.appendChild(tags);
  }

  if (hasInternalTarget) {
    const detailButton = document.createElement("button");
    detailButton.type = "button";
    detailButton.className = "ghost-button pulse-action-button";
    detailButton.textContent = item.official_event_id ? t("pulse.openLive", "Öppna live-info") : t("pulse.openPlace", "Öppna plats");
    detailButton.addEventListener("click", () => {
      openCityPulseItem(item);
    });
    actions.appendChild(detailButton);
  }

  if (item.linked_wildcard_id && getWildcardById(item.linked_wildcard_id)) {
    const plannerButton = document.createElement("button");
    plannerButton.type = "button";
    plannerButton.className = "secondary-button pulse-action-button";
    plannerButton.textContent = t("pulse.buildDay", "Bygg dag av detta");
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
    cityPulseState = hasRomeFrontendContent
      ? buildRomeFallbackCityPulse(ensureActiveLiveDate())
      : buildGenericFallbackPulse(ensureActiveLiveDate());
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
    cityPulseEditionLabel.textContent = `${tf("pulse.currentIn", { city: buildUnavailableCityLabel() }, `Aktuellt i ${buildUnavailableCityLabel()}`)} · ${weekdayLabel} ${dateLabel}`;
  }

  // Prefer the server-built masthead (engine-driven) over the legacy
  // shell headline/subhead. Falls back gracefully when an older server
  // response doesn't include a masthead object.
  cityPulseHeadline.textContent =
    cityPulseState.masthead?.headline ||
    cityPulseState.headline ||
    tf("pulse.currentInNow", { city: buildUnavailableCityLabel() }, `Aktuellt i ${buildUnavailableCityLabel()} just nu.`);
  cityPulseSubhead.textContent =
    cityPulseState.masthead?.subhead ||
    cityPulseState.subhead ||
    cityPulseState.note ||
    (isEnglishUi
      ? "This layer helps you weigh what is actually relevant right now."
      : "Det här lagret hjälper dig väga in det som faktiskt är relevant just nu.");
  cityPulseEditionDate.textContent = `${weekdayLabel}\n${dateLabel}`;
  cityPulseMeta.textContent = buildPulseMetaLabel(filteredItems);

  // Hide the JUST NU / RIGHT NOW live chip when no signals are present.
  // The chip implies active live coverage — showing it on an empty edition
  // creates a false sense of activity.
  if (cityPulseLiveChip) {
    const hasSignals = Array.isArray(cityPulseState?.signals) && cityPulseState.signals.length > 0;
    cityPulseLiveChip.hidden = !hasSignals;
  }
  cityPulseFooter.textContent =
    cityPulseState.footer_note ||
    t("pulse.footer", "Den här sektionen blandar säkra lokala rytmer med det som är värt att väga in just nu.");

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
      ? `${t("pulse.clothing", "Klädsel")}: ${getPulseClothingAdvice(cityPulseState.weather)}.`
      : t("pulse.clothingPending", "Parranda lägger till klädråd så snart vädret är laddat.");
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
        label: buildLiveScopeAllLabel(),
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
            cityPulseScopeStatus = isEnglishUi
              ? `Location access is unavailable right now, so Pulse shows ${buildLiveScopeAllLabel().toLowerCase()} instead of nearby signals.`
              : `Platsåtkomst saknas just nu, så LIVE visar ${buildLiveScopeAllLabel().toLowerCase()} i stället för nära dig.`;
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
                cityPulseScopeStatus = isEnglishUi
                  ? `Location access is unavailable right now, so Pulse shows ${buildLiveScopeAllLabel().toLowerCase()} until Near me can be used.`
                  : `Platsåtkomst saknas just nu, så LIVE visar ${buildLiveScopeAllLabel().toLowerCase()} tills Nära mig kan användas.`;
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
      ? isEnglishUi
        ? `This edition is tied to ${formatSwedishDate(activePlannedDay.date)}. Pulse now helps you read what fits that day's main route and alternatives.`
        : `Editionen är kopplad till ${formatSwedishDate(activePlannedDay.date)}. LIVE hjälper dig nu läsa vad som passar med just den dagens huvudrutt och alternativ.`
      : buildPulseUtilityCopy(filteredItems, items);
  }

  cityPulseFilters.innerHTML = "";
  cityPulseFilters.appendChild(
    createPulseFilterButton("all", t("pulse.all", "Allt"), filteredItems.length),
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
        ? `<h3>${t("pulse.emptyNearbyTitle", "Inget starkt live-lager nära dig just nu")}</h3><p>${tf("pulse.emptyNearbyBody", { scope: buildLiveScopeAllLabel() }, `Byt till ${buildLiveScopeAllLabel()} eller ett bredare tidsläge för att se fler signaler.`)}</p>`
        : `<h3>${t("pulse.emptyTitle", "Inga starka signaler just nu")}</h3><p>${t("pulse.emptyBody", "Parranda lyckades inte hämta några tydliga dagensnotiser, men route buildern och wildcardet fungerar fortfarande.")}</p>`;
    cityPulseLevels.appendChild(emptyState);
  }
}

async function loadCityPulse(dateString = getTodayIsoDate()) {
  const targetDate = dateString || getTodayIsoDate();

  activeLiveDate = targetDate;

  if (cityPulseCache.has(targetDate)) {
    cityPulseState = cityPulseCache.get(targetDate);
    renderHeroBlitz();
    renderCityPulse();
    loadHeroBlitz().catch(() => {});
    return;
  }

  const fallbackPulse = hasRomeFrontendContent
    ? buildRomeFallbackCityPulse(targetDate)
    : buildGenericFallbackPulse(targetDate);

  try {
    const response = await fetchJson(
      `${routeApiBase}/city-pulse?city=${encodeURIComponent(plannerCityKey)}&date=${encodeURIComponent(targetDate)}&lang=${encodeURIComponent(activeUiLanguage)}`,
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
      signals: Array.isArray(response.signals) ? response.signals : [],
      moments: Array.isArray(response.moments) ? response.moments : [],
      official_events: Array.isArray(response.official_events) ? response.official_events : [],
      weather: response.weather || null,
      wildcards:
        Array.isArray(response.wildcards) && response.wildcards.length
          ? response.wildcards
          : hasRomeFrontendContent
            ? buildRomeFallbackWildcards(dateString)
            : fallbackPulse.wildcards || [],
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
  renderHeroBlitz();
  renderCityPulse();
  loadHeroBlitz().catch(() => {});
}

function createMapUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function withPlannerCitySearchLabel(query) {
  return [query, plannerCitySearchLabel].filter(Boolean).join(" ");
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

function getLatestPlannerPlanDismissSignature() {
  try {
    return window.sessionStorage.getItem(latestPlannerPlanDismissStorageKey) || "";
  } catch (_error) {
    return "";
  }
}

function setLatestPlannerPlanDismissSignature(signature = "") {
  try {
    if (!signature) {
      window.sessionStorage.removeItem(latestPlannerPlanDismissStorageKey);
      return;
    }

    window.sessionStorage.setItem(latestPlannerPlanDismissStorageKey, signature);
  } catch (_error) {
    // Ignore session storage failures and keep the restore affordance available.
  }
}

function buildLatestPlannerPlanRecord(response) {
  if (!latestPlannerSnapshot || !Array.isArray(response?.days) || !response.days.length) {
    return null;
  }

  return plannerTrustCreateLatestPlannerPlanRecord({
    cityKey: plannerCityKey,
    cityLabel: plannerDisplayCityLabel,
    timestamp: Date.now(),
    plannerSnapshot: latestPlannerSnapshot,
    intentKeys: getSelectedIntentKeys(),
    preferences: [...(latestPlannerSnapshot.preferences || [])],
    plannerResponse: {
      days: response.days,
      resolved_home_base: response.resolved_home_base || null,
      resolved_start: response.resolved_start || null,
      resolved_end: response.resolved_end || null,
    },
    activePlannedDate: activePlannedDate || response.days[0]?.date || null,
  });
}

function readLatestPlannerPlanRecord() {
  try {
    const stored = window.localStorage.getItem(latestPlannerPlanStorageKey);

    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored);
    const record = plannerTrustNormalizeLatestPlannerPlanRecord(parsed, {
      cityKey: plannerCityKey,
      schemaVersion: latestPlannerPlanSchemaVersion,
      maxAgeMs: latestPlannerPlanMaxAgeMs,
      now: Date.now(),
    });

    if (record) {
      return record;
    }
  } catch (_error) {
    // Fall through and clear the invalid payload below.
  }

  try {
    window.localStorage.removeItem(latestPlannerPlanStorageKey);
  } catch (_error) {
    // Ignore local storage failures and continue without restore data.
  }

  return null;
}

function persistLatestPlannerPlan(response) {
  const record = buildLatestPlannerPlanRecord(response);

  if (!record) {
    return null;
  }

  try {
    window.localStorage.setItem(latestPlannerPlanStorageKey, JSON.stringify(record));
    setLatestPlannerPlanDismissSignature("");
    return record;
  } catch (_error) {
    return null;
  }
}

function hideLatestPlannerRestoreNotice() {
  if (plannerRestoreNotice) {
    plannerRestoreNotice.hidden = true;
  }

  if (plannerRestoreSummary) {
    plannerRestoreSummary.textContent = "";
  }
}

function formatPlannerIntentLabelList(labels = []) {
  if (!labels.length) {
    return "";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} och ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")} och ${labels[labels.length - 1]}`;
}

function buildLatestPlannerRestoreSummary(record) {
  if (!record?.plannerSnapshot) {
    return "Senaste plan finns kvar om du vill fortsätta där du slutade.";
  }

  const dates = Array.isArray(record.plannerSnapshot.dates) ? record.plannerSnapshot.dates : [];
  const dateLabel =
    dates.length > 1
      ? `${formatCompactSwedishDate(dates[0])} → ${formatCompactSwedishDate(dates[dates.length - 1])}`
      : formatCompactSwedishDate(dates[0] || record.plannerSnapshot.dateFrom || getTodayIsoDate());
  const explicitIntentLabels =
    Array.isArray(record.intentKeys) && record.intentKeys.length && !matchesDefaultPlannerIntentKeys(record.intentKeys)
      ? record.intentKeys
          .filter((intentKey) => plannerIntentByKey.has(intentKey))
          .map(getPlannerIntentLabel)
          .slice(0, 2)
      : [];
  const dayCount = record.plannerResponse?.days?.length || 1;
  const countLabel = `${dayCount} ${dayCount === 1 ? (isEnglishUi ? "day" : "dag") : (isEnglishUi ? "days" : "dagar")}`;

  return [dateLabel, countLabel, explicitIntentLabels.join(" • ")]
    .filter(Boolean)
    .join(" • ");
}

function updateLatestPlannerRestoreNotice() {
  if (!plannerRestoreNotice || !plannerRestoreSummary) {
    return;
  }

  if (plannedDays.length) {
    hideLatestPlannerRestoreNotice();
    return;
  }

  const record = readLatestPlannerPlanRecord();

  if (!record) {
    hideLatestPlannerRestoreNotice();
    return;
  }

  const dismissSignature = plannerTrustBuildLatestPlannerPlanDismissSignature(record);

  if (dismissSignature && dismissSignature === getLatestPlannerPlanDismissSignature()) {
    hideLatestPlannerRestoreNotice();
    return;
  }

  plannerRestoreSummary.textContent = buildLatestPlannerRestoreSummary(record);
  plannerRestoreButton?.setAttribute("aria-label", "Fortsätt med senaste plan");
  plannerRestoreNotice.hidden = false;
}

function applyPlannerResponseState(response, options = {}) {
  plannedDays = Array.isArray(response?.days) ? response.days : [];
  const resolvedState = {
    homeBase: response?.resolved_home_base || null,
    start: response?.resolved_start || null,
    end: response?.resolved_end || null,
  };

  latestPlannerResolution =
    resolvedState.homeBase || resolvedState.start || resolvedState.end ? resolvedState : null;
  routeRenderMode = plannedDays.length ? "api" : "fallback";
  activeRouteKey = null;
  liveEditionExpanded = plannedDays.length > 0;
  expandedAlternativeDates.clear();

  const nextActiveDate = options.activePlannedDate || plannedDays[0]?.date || null;

  activePlannedDate = plannedDays.some((day) => day.date === nextActiveDate)
    ? nextActiveDate
    : plannedDays[0]?.date || null;
  activeLiveDate = plannedDays.length
    ? activePlannedDate || plannedDays[0].date
    : options.fallbackDate || routeDateFrom.value || getTodayIsoDate();
}

function restoreLatestPlannerPlan() {
  const record = readLatestPlannerPlanRecord();

  if (!record) {
    hideLatestPlannerRestoreNotice();
    return;
  }

  latestPlannerSnapshot = record.plannerSnapshot;
  applyPlannerSnapshot(record.plannerSnapshot);
  applyPlannerResponseState(record.plannerResponse, {
    activePlannedDate: record.activePlannedDate,
    fallbackDate: record.plannerSnapshot.dateFrom,
  });
  switchTab("routes");
  renderRouteResults();
  updatePlannerLaunchSummary(buildPlanningResultSummary(record.plannerResponse));
  updateRouteMatchSummary("");
  setPlannerStatusMessage("Senaste plan återställd.", "info");
  hideLatestPlannerRestoreNotice();
  focusPlannerResults();
  loadCityPulse(activeLiveDate).catch(() => {});
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
  return getFrontendPlaces().find((place) => place.name === name);
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

  return getFrontendPlaces().filter((place) => {
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
    const nextText = typeof text === "string" ? text.trim() : "";
    routeMatchSummary.textContent = nextText;
    routeMatchSummary.hidden = !nextText;
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
    return normalizePlannerSelectionLabel(controls.presetSelect?.value) || t("planner.choose", "Parranda väljer");
  }

  if (mode === "custom") {
    return controls.customInput?.value?.trim() || (isEnglishUi ? "custom address" : "egen adress");
  }

  if (mode === "current_location") {
    return isEnglishUi ? "my location" : "min plats";
  }

  return t("planner.choose", "Parranda väljer");
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
    const startSummary = getPlannerPointSummary("start");
    const endSummary = getPlannerPointSummary("end");

    if (startSummary === t("planner.choose", "Parranda väljer") && endSummary === t("planner.choose", "Parranda väljer")) {
      pieces.push(t("planner.autoStartEnd", "Start och slut väljs automatiskt"));
    } else {
      pieces.push(`${t("route.start", "Start")}: ${startSummary}`);
      pieces.push(`${t("route.end", "Slut")}: ${endSummary}`);
    }
  } else {
    const homeBaseSummary = getPlannerPointSummary("home_base");
    pieces.push(
      homeBaseSummary === t("planner.choose", "Parranda väljer")
        ? t("planner.autoStartEnd", "Start och slut väljs automatiskt")
        : `${t("planner.whereStaying", "Där du bor")}: ${homeBaseSummary}`,
    );
  }

  const activeBudgetLabel = getBudgetTierLabel(activeBudgetTier);
  if (activeBudgetTier && activeBudgetTier !== "standard" && activeBudgetLabel) {
    pieces.push(activeBudgetLabel);
  }

  if (legPacingSelect?.value && legPacingSelect.value !== "balanced") {
    pieces.push(legPacingLabels[legPacingSelect.value] || legPacingSelect.value);
  }

  plannerAdvancedSummary.textContent = pieces.join(" • ");

  if (plannerModeLead) {
    plannerModeLead.textContent =
      activePlannerMode === plannerManualMode
        ? t("planner.modeManualLead", "Du styr själv var dagen ska börja eller sluta. Lås bara det som verkligen behöver vara exakt.")
        : t("planner.modeAutoLead", "Håll det lätt. Datum, känsla och eventuell plats där du bor räcker.");
  }

  if (routePlannerModeChip && !isFallbackRequestedCity && !isInternalCityMode && !isPreviewCityMode) {
    routePlannerModeChip.textContent =
      activePlannerMode === plannerManualMode
        ? t("planner.manualChip", "Manuell start/slut")
        : routeApiAvailable
          ? t("planner.autoChip", "Parranda väljer start och slut")
          : t("planner.fallbackChip", "Fallback-läge på");
  }

  updatePlannerLaunchSummary();
}

function buildPlannerStyleSummary(prefix = "") {
  const leading = prefix ? [prefix.trim()] : [];
  const activeParts = [];
  const selectedIntentKeys = getSelectedIntentKeys();

  if (activeOptimizerMode && optimizerModeLabels[activeOptimizerMode]) {
    activeParts.push(optimizerModeLabels[activeOptimizerMode]);
  }

  const activeBudgetLabel = getBudgetTierLabel(activeBudgetTier);
  if (activeBudgetTier && activeBudgetTier !== "standard" && activeBudgetLabel) {
    activeParts.push(activeBudgetLabel);
  }

  if (activeRouteModifier && routeModifierLabels[activeRouteModifier]) {
    activeParts.push(routeModifierLabels[activeRouteModifier]);
  }

  if (legPacingSelect?.value && legPacingSelect.value !== "balanced") {
    activeParts.push(legPacingLabels[legPacingSelect.value] || legPacingSelect.value);
  }

  if (selectedIntentKeys.length === 1) {
    activeParts.push(`${t("planner.clearTheme", "Tydligt tema")}: ${getPlannerIntentLabel(selectedIntentKeys[0])}`);
  }

  if (activeParts.length) {
    leading.push(`${t("planner.activeNow", "Aktivt nu")}: ${activeParts.join(" • ")}.`);
  }

  if (
    selectedIntentKeys.includes("second_hand") &&
    !plannerIntentHasCoverage("second_hand")
  ) {
    leading.push(
      t("planner.secondHandSoft", "Second hand är valt som intent, men staden har ännu inte stark second hand-data. Parranda behandlar det därför som en mjuk signal i stället för att låtsas full träffsäkerhet."),
    );
  }

  return leading.join(" ");
}

function buildPlannerSnapshot(payload, dates) {
  return {
    plannerMode: activePlannerMode,
    intentKeys: getSelectedIntentKeys(),
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
  const resolvedStart = response.resolved_start?.label || t("planner.smartStart", "en smart start");
  const resolvedEnd = response.resolved_end?.label || t("planner.clearEnd", "en tydlig slutpunkt");

  if (activePlannerMode === plannerAutoMode) {
    return plannedCount > 1 ? `${plannedCount} ${t("planner.daysPlanned", "dagar planerade")}.` : t("planner.planReady", "Din plan är klar.");
  }

  if (usedAutoStart && usedAutoEnd) {
    return plannedCount > 1 ? `${plannedCount} ${t("planner.daysPlanned", "dagar planerade")}.` : t("planner.planReady", "Din plan är klar.");
  }

  if (!usedAutoStart && usedAutoEnd) {
    return plannedCount > 1 ? `${plannedCount} ${t("planner.daysPlanned", "dagar planerade")} ${t("planner.from", "från")} ${resolvedStart}.` : t("planner.planReady", "Din plan är klar.");
  }

  if (usedAutoStart && !usedAutoEnd) {
    return plannedCount > 1 ? `${plannedCount} ${t("planner.daysPlanned", "dagar planerade")} ${t("planner.withEnd", "med")} ${resolvedEnd} ${isEnglishUi ? "" : "som slutpunkt"}.`.replace(/\s+\./, ".") : t("planner.planReady", "Din plan är klar.");
  }

  return plannedCount > 1
    ? `${plannedCount} ${t("planner.daysPlanned", "dagar planerade")} ${t("planner.between", "mellan")} ${resolvedStart} ${isEnglishUi ? "and" : "och"} ${resolvedEnd}.`
    : t("planner.planReady", "Din plan är klar.");
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
  const dateLabel =
    dates.length > 1
      ? `${formatCompactSwedishDate(dates[0])} → ${formatCompactSwedishDate(dates[dates.length - 1])}`
      : formatCompactSwedishDate(dates[0] || getTodayIsoDate());
  const summary =
    prefix ||
    (activePlannerMode === plannerManualMode
      ? `${dateLabel} • ${t("planner.launchManual", "Du styr start och slut. Parranda fyller dagen.")}`
      : `${dateLabel} • ${t("planner.launchAuto", "Parranda väljer start, slut och tempo utifrån din känsla.")}`);

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

function openPlannerModalForMode(mode = plannerAutoMode) {
  setPlannerMode(mode);

  if (mode === plannerManualMode && plannerFineTuneDetails) {
    plannerFineTuneDetails.open = true;
  }

  openPlannerModal();
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
  return `https://www.google.com/search?q=${encodeURIComponent(
    withPlannerCitySearchLabel(query),
  )}`;
}

function getPlannerModeHint(pointKey, mode) {
  const isStart = pointKey === "start";
  const isHomeBase = pointKey === "home_base";

  if (mode === plannerAutoMode) {
    if (isHomeBase) {
      return t("planner.homeBaseAutoHint", "Hoppa över om platsen inte spelar roll. Parranda väljer en naturlig utgångspunkt.");
    }

    return isStart
      ? t("planner.startAutoHint", "Lämna öppet om Parranda får välja bästa öppning.")
      : t("planner.endAutoHint", "Lämna öppet om Parranda får välja bästa avslut.");
  }

  if (mode === "current_location") {
    if (isHomeBase) {
      return t("planner.homeCurrentHint", "Använd om du vill att området där du bor eller står ska väga in mjukt.");
    }

    return isStart
      ? t("planner.startCurrentHint", "Starta nära där du står just nu.")
      : t("planner.endCurrentHint", "Låt dagen landa nära där du faktiskt är.");
  }

  if (mode === "custom") {
    if (isHomeBase) {
      return t("planner.homeCustomHint", "Skriv hotell, adress eller område. Det styr riktningen men låser inte exakt start.");
    }

    return isStart
      ? t("planner.startCustomHint", "Skriv platsen där dagen ska börja.")
      : t("planner.endCustomHint", "Skriv platsen där dagen ska sluta.");
  }

  if (isHomeBase) {
    return t("planner.homePresetHint", "Välj område om du vill ge Parranda en mjuk plats att utgå från.");
  }

  return isStart
    ? t("planner.startPresetHint", "Välj område om du vill låsa öppningen lite tydligare.")
    : t("planner.endPresetHint", "Välj område om du vill styra var dagen landar.");
}

function getPlannerDistrictGroups() {
  if (!isRomeCuratedMode) {
    return [];
  }

  return getFrontendPlannerDistrictCatalog().map((item) => ({
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
    return createMapUrl(withPlannerCitySearchLabel("city center"));
  }

  if (points.length === 1) {
    return createMapUrl(
      points[0].label
        ? withPlannerCitySearchLabel(points[0].label)
        : withPlannerCitySearchLabel("city center"),
    );
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

function parseIsoDateToUtcNoon(dateString) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
}

function getCityDateTimeSnapshot(referenceDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: plannerTimeZone,
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

function getTodayIsoDate() {
  return getCityDateTimeSnapshot().date;
}

function formatSwedishDate(dateString) {
  const date = parseIsoDateToUtcNoon(dateString);

  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat(uiDateLocale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function formatCompactSwedishDate(dateString) {
  if (!dateString) {
    return "";
  }

  const date = parseIsoDateToUtcNoon(dateString);

  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat(uiDateLocale, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatSavedTimestamp(dateString) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat(uiDateLocale, {
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

  if (isFallbackRequestedCity || isPreviewCityMode) {
    routePlannerModeChip.textContent = tf(
      "planner.fallbackPreparing",
      { city: buildUnavailableCityLabel() },
      `${buildUnavailableCityLabel()} förbereds`,
    );
    routeFallbackNote.hidden = false;
    routeFallbackNote.textContent = buildNonRomeFallbackNote();
    return;
  }

  if (isInternalCityMode) {
    routePlannerModeChip.textContent = isAvailable
      ? t("planner.internalPreviewActive", "Intern city-preview aktiv")
      : t("planner.internalPreviewFallback", "Intern preview • fallback");
    routeFallbackNote.hidden = false;
    routeFallbackNote.textContent = buildNonRomeFallbackNote();
    return;
  }

  if (isAvailable) {
    routePlannerModeChip.textContent =
      activePlannerMode === plannerManualMode
        ? t("planner.manualChip", "Manuell start/slut")
        : t("planner.autoChip", "Parranda väljer start och slut");
    routeFallbackNote.hidden = true;
    return;
  }

  routePlannerModeChip.textContent = t("planner.fallbackChip", "Fallback-läge på");
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
    emptyOption.textContent = t("planner.choose", "Parranda väljer");
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

  const label = item.label || "Staden";
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

function paLoading(button, label) {
  if (!button) {
    return () => {};
  }

  const previousLabel = button.dataset.paPrevLabel || button.textContent || "";
  button.dataset.paPrevLabel = previousLabel;
  button.classList.add("pa-loading");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (label) {
    button.textContent = label;
  }

  return () => {
    button.classList.remove("pa-loading");
    button.disabled = false;
    button.removeAttribute("aria-busy");
    if (button.dataset.paPrevLabel) {
      button.textContent = button.dataset.paPrevLabel;
      delete button.dataset.paPrevLabel;
    }
  };
}

function paSkeleton(container, lines = 3) {
  if (!container) {
    return () => {};
  }

  const count = Math.max(1, lines | 0 || 3);
  const nodes = [];

  for (let index = 0; index < count; index += 1) {
    const row = document.createElement("span");
    row.className = "pa-skeleton";
    row.style.width = `${68 + ((index * 11) % 24)}%`;
    container.appendChild(row);
    nodes.push(row);
  }

  return () => {
    nodes.forEach((node) => {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
  };
}

function ensurePlannerLoadingSlot() {
  if (!routeResults || !plannerDayTemplate) {
    return null;
  }

  routeResults.innerHTML = "";

  const shell = document.createElement("section");
  shell.className = "planner-results-shell is-loading";

  const dayCard = plannerDayTemplate.content.firstElementChild.cloneNode(true);
  dayCard.classList.add("is-loading");
  dayCard.querySelector(".planner-day-date").textContent = t("planner.loadingDay", "Planerar dagen");
  dayCard.querySelector(".planner-day-title").textContent = t("planner.loadingTitle", "Parranda bygger ditt första upplägg");
  dayCard.querySelector(".planner-day-summary").textContent =
    t("planner.loadingSummary", "Resultatet landar här så fort rutten är klar.");
  dayCard.querySelector(".planner-day-outline").innerHTML = "";
  dayCard.querySelector(".planner-day-signals").hidden = true;
  dayCard.querySelector(".planner-day-events").hidden = true;
  dayCard.querySelector(".planner-alt-section").hidden = true;
  dayCard.querySelector(".planner-primary-route-line").textContent = t("planner.loadingRoute", "Laddar rutt och stopp...");

  const primarySlot = dayCard.querySelector(".planner-primary-slot");
  shell.appendChild(dayCard);
  routeResults.appendChild(shell);
  return primarySlot;
}

function syncPlannerLoadingSkeleton(isLoading) {
  if (isLoading) {
    if (plannerLoadingSkeletonClear) {
      return;
    }

    const slot = ensurePlannerLoadingSlot();
    if (slot) {
      plannerLoadingSkeletonClear = paSkeleton(slot, 4);
    }
    return;
  }

  if (plannerLoadingSkeletonClear) {
    plannerLoadingSkeletonClear();
    plannerLoadingSkeletonClear = null;
  }

  const loadingShell = routeResults?.querySelector(".planner-results-shell.is-loading");
  if (loadingShell) {
    loadingShell.remove();
  }
}

function setPlannerLoadingState(isLoading, message = plannerLoadingMessages[0]) {
  const buttons = [routePlanButton, routePlanStickyButton].filter(Boolean);
  const label = t("planner.loadingButton", "Planerar...");

  if (isLoading) {
    plannerLoadingStops = buttons.map((button) => paLoading(button, label));
  } else {
    plannerLoadingStops.forEach((stop) => stop());
    plannerLoadingStops = [];
  }

  buttons.forEach((button) => {
    button.classList.toggle("is-loading", isLoading);
  });

  if (routeResetButton) {
    routeResetButton.disabled = isLoading;
  }

  if (isLoading) {
    syncPlannerLoadingSkeleton(true);
    setPlannerStatusMessage(message, "loading");
    return;
  }

  if (plannerLoadingTimer) {
    clearInterval(plannerLoadingTimer);
    plannerLoadingTimer = null;
  }

  syncPlannerLoadingSkeleton(false);
}

function startPlannerLoadingCycle() {
  const dayCount = expandDateRange(routeDateFrom?.value, routeDateTo?.value).length;
  let messageIndex = 0;

  if (plannerLoadingTimer) {
    clearInterval(plannerLoadingTimer);
    plannerLoadingTimer = null;
  }

  plannerLoadingMessages = buildPlannerLoadingMessagesForUi(dayCount);
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
    const label = getBudgetTierLabel(button.dataset.budgetTier);
    if (label) {
      button.textContent = label;
    }
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
  setSelectedIntentKeys(inferIntentKeysFromPreferences(config.preferences));
  walkingKmTarget.value = String(config.km);
  distanceModeSelect.value = config.distanceMode;
  updateDistanceModeUI();
  updateWalkingKmLabel();
  updateOptimizerButtons();
  updateRouteMatchSummary(
    buildPlannerStyleSummary(`${optimizerModeLabels[mode] || "Optimizer-läget"} är aktivt.`),
  );
  updatePlannerLaunchSummary(
    `${optimizerModeLabels[mode] || "Specialläge"} • Parranda anpassar dagen efter läget.`,
  );
}

function applyBudgetTier(tier) {
  activeBudgetTier = getBudgetTierCopy(tier) ? tier : "standard";
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

  setSelectedIntentKeys(defaultPlannerIntentKeys, { allowDefaultSeed: true });

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
  setSelectedIntentKeys(
    Array.isArray(snapshot.intentKeys) && snapshot.intentKeys.length
      ? snapshot.intentKeys
      : inferIntentKeysFromPreferences(snapshot.preferences || []),
    {
      allowDefaultSeed:
        Array.isArray(snapshot.intentKeys) &&
        matchesDefaultPlannerIntentKeys(snapshot.intentKeys),
    },
  );
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
  const startDate = parseIsoDateToUtcNoon(start);
  const endDate = parseIsoDateToUtcNoon(end);
  const dates = [];

  if (!startDate || !endDate) {
    return [];
  }

  for (
    let cursor = new Date(startDate);
    cursor <= endDate && dates.length < 5;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    dates.push(cursor.toISOString().slice(0, 10));
  }

  return dates;
}

function getSelectedPreferences() {
  const selected = expandIntentKeysToPreferenceSignals(getSelectedIntentKeys());

  return selected.length
    ? selected
    : expandIntentKeysToPreferenceSignals(defaultPlannerIntentKeys);
}

window.__parrandaApplyPlannerIntentKeySelection = applyPlannerIntentKeySelection;

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
    legs: [...(routeView.legs || [])],
    longestLegKm: routeView.longestLegKm || null,
    longestLegMinutes: routeView.longestLegMinutes || null,
    averageLegMinutes: routeView.averageLegMinutes || null,
    legFitNote: routeView.legFitNote || null,
    geoFitNote: routeView.geoFitNote || null,
    anchorZone: routeView.anchorZone || null,
    anchorExplanation: routeView.anchorExplanation || null,
    engineBadges: [...(routeView.engineBadges || [])],
    usefulSignals: [...(routeView.usefulSignals || [])],
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
    intentKeys: Array.isArray(snapshot.intentKeys)
      ? [...snapshot.intentKeys]
      : inferIntentKeysFromPreferences(snapshot.preferences || []),
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

  remixed.intentKeys = inferIntentKeysFromPreferences(remixed.preferences);

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
      !isRomeCuratedMode
        ? buildNonRomeRouteSummary()
        : "Remixen gick inte att köra i live-läget just nu, så Parranda föll tillbaka till sina kuraterade rutter.",
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
    "dolce-vita": getBudgetTierLabel("dolce-vita"),
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

  getIntentLabelsForSnapshot(snapshot)
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
      !isRomeCuratedMode
        ? buildNonRomeRouteSummary()
        : "Planeringen från den valda platsen gick inte att köra live just nu, så fallback-rutterna ligger kvar.",
    );
  }
}

function openPlaceDrawer(item) {
  activeDrawerItem = item;
  placeDrawerType.textContent = `${item.type || t("place.typeFallback", "plats")} • ${item.area || buildUnavailableCityLabel()}`;
  placeDrawerTitle.textContent = item.label;
  placeDrawerSummary.textContent =
    item.summary ||
    item.vibe ||
    tf("place.curatedStopFallback", { city: buildUnavailableCityLabel() }, `Kuraterat stopp i ${buildUnavailableCityLabel()}.`);
  placeDrawerRouteFit.hidden = !item.route_fit_note;
  placeDrawerRouteFit.textContent = item.route_fit_note || "";
  placeDrawerDescription.textContent = item.long_description || item.summary || "";
  placeDrawerHappyHour.hidden = !item.happy_hour_note;
  placeDrawerHappyHour.textContent = item.happy_hour_note
    ? tf("place.goodToKnow", { note: item.happy_hour_note }, `Bra att veta: ${item.happy_hour_note}`)
    : "";
  placeDrawerMapsLink.href =
    item.external_map_url || createMapUrl(withPlannerCitySearchLabel(item.label));
  placeDrawerSearchLink.href = item.external_search_url || createGoogleInfoUrl(item.label);
  placeDrawerMapsLink.textContent = item.external_maps_label || "Google Maps";
  placeDrawerSearchLink.textContent = item.external_search_label || t("place.googleInfo", "Google-info");
  placeDrawerExtraLink.hidden = !item.external_extra_url;
  placeDrawerExtraLink.href = item.external_extra_url || "#";
  placeDrawerExtraLink.textContent = item.external_extra_label || t("place.extraLink", "Extra länk");

  const plannerReady = drawerItemCanBeUsedInPlanner(item);
  placeDrawerStartButton.hidden = !plannerReady;
  placeDrawerEndButton.hidden = !plannerReady;
  placeDrawerPlanButton.hidden = !plannerReady;
  placeDrawerPlannerNote.hidden = !plannerReady;
  placeDrawerPlannerNote.textContent = plannerReady
    ? tf(
        "place.drawerPlannerNote",
        { label: item.label },
        `${item.label} kan nu användas direkt som startpunkt, slutpunkt eller ny grund i planeringen.`,
      )
    : "";

  placeDrawerMeta.innerHTML = "";
  [
    item.price_level ? tf("place.metaPrice", { value: item.price_level }, `Pris: ${item.price_level}`) : null,
    item.best_time ? tf("place.metaBest", { value: item.best_time }, `Bäst: ${item.best_time}`) : null,
    item.opening_summary ? tf("place.metaWhen", { value: item.opening_summary }, `När: ${item.opening_summary}`) : null,
    item.group_size ? tf("place.metaGroup", { value: item.group_size }, `Grupp: ${item.group_size}`) : null,
    item.booking_required === true
      ? t("place.metaBooking", "Bokning smart")
      : item.hide_dropin_note
        ? null
        : t("place.metaDropIn", "Drop-in går ofta bra"),
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
    isRomeCuratedMode &&
    (Boolean(item.best_route_id && item.best_route_date) ||
      markers.has(item.label) ||
      (typeof item.lat === "number" && typeof item.lng === "number"));

  placeDrawerMapButton.disabled = !canFocusOnMap;
  placeDrawerMapButton.textContent =
    item.best_route_id && item.best_route_date
      ? t("place.mapMatchedDay", "Visa matchande dag på kartan")
      : t("place.mapInApp", "Visa på kartan i appen");

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
      type: t("place.editorialMention", "redaktionell mention"),
      area: buildUnavailableCityLabel(),
      summary: t("place.fetchFallbackSummary", "Kunde inte hämta full intern info just nu."),
      long_description:
        t(
          "place.fetchFallbackDescription",
          "Du kan fortfarande hoppa vidare till Google eller Google Maps för att läsa mer om det här stoppet.",
        ),
      external_search_url: createGoogleInfoUrl(query),
      external_map_url: createMapUrl(withPlannerCitySearchLabel(query)),
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
    area: event.venue || buildUnavailableCityLabel(),
    summary:
      event.route_fit_note ||
      event.match_reason ||
      event.summary ||
      tf("place.officialEvent", { city: buildUnavailableCityLabel() }, `Officiellt event i ${buildUnavailableCityLabel()}.`),
    long_description: [
      timing ? `Pågår: ${timing}.` : null,
      venueLine,
      event.summary,
      event.route_fit_note,
    ]
      .filter(Boolean)
      .join(" "),
    opening_summary: timing || null,
    group_size: event.buy_url ? t("place.bookable", "Bäst om ni vill kunna boka") : null,
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
        event.best_route_label
          ? tf("place.bestWithRoute", { label: event.best_route_label }, `Passar bäst med ${event.best_route_label}`)
          : null,
        event.date ? formatSwedishDate(event.date) : null,
        event.route_fit_note || null,
      ]
        .filter(Boolean)
        .join(" • ") || null,
    external_map_url: createMapUrl(withPlannerCitySearchLabel(event.venue || event.title)),
    external_search_url: event.url || createGoogleInfoUrl(event.title),
    external_search_label: event.url ? t("place.officialSite", "Officiell sida") : t("place.googleInfo", "Google-info"),
    external_extra_url: event.buy_url || null,
    external_extra_label: event.buy_url ? t("place.ticket", "Köp biljett") : null,
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

function getRomeFallbackPointCatalog() {
  return new Map(
    [
      ...romePlaces.map((place) => [
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

function buildRomeFallbackRoutePoints(routeId) {
  const pointCatalog = getRomeFallbackPointCatalog();
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
  const mapRoutePoints = buildRomeFallbackRoutePoints(route.id);
  const routeView = {
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
      summary: null,
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

  routeView.usefulSignals = buildUsefulRouteSignals(routeView);
  return routeView;
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
  const picked = sentences
    .slice(0, maxSentences)
    .join(" ")
    .replace(/(\d)\.\s+(\d)/gu, "$1.$2")
    .trim();
  return clipText(picked, maxLength);
}

function buildRouteLine(routeView) {
  if (routeView?.path) {
    return routeView.path.replace(/\s*->\s*/g, " → ");
  }

  const points = routeView?.mapRoutePoints || [];
  if (!points.length) {
    return getMapCityFallbackLabel();
  }

  const labels = [points[0]?.label, points[points.length - 1]?.label].filter(Boolean);
  return labels.join(" → ");
}

function formatLegDistance(distanceKm) {
  if (!Number.isFinite(distanceKm)) {
    return null;
  }

  const formattedDistance = isEnglishUi
    ? String(distanceKm)
    : String(distanceKm).replace(".", ",");
  return `${formattedDistance} km`;
}

function formatLegMinutes(minutes) {
  if (!Number.isFinite(minutes)) {
    return null;
  }

  return `${minutes} min`;
}

function buildLegSummary(route) {
  return null;
}

function stopSourceLabel(stop) {
  if (stop?.isLiveEvent) {
    return "Live";
  }

  if (stop?.source === "swapped") {
    return "Inbytt";
  }

  return null;
}

function buildAnchorExplanation(route) {
  return null;
}

function normalizeRouteResultCopy(text = "") {
  if (!text) {
    return "";
  }

  return String(text)
    .replace(/^En tydlig båge/iu, isEnglishUi ? "A clear route" : "En tydlig rutt")
    .replace(/\bi bågen\b/giu, isEnglishUi ? "in the route" : "i rutten")
    .replace(/(\d)\.\s+(\d)/gu, "$1.$2")
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => !/\bbåge\b|benläng|gångben|heuristisk routing/iu.test(sentence))
    .join(" ")
    .trim();
}

const usefulRouteSignalLabels = {
  rain: t("signal.rain", "Bra vid regn"),
  live: t("signal.live", "Bra just nu"),
  easyWalk: t("signal.easyWalk", "Lätt att gå"),
  roundTrip: t("signal.roundTrip", "Rundtur"),
  evening: t("signal.evening", "Kvällsvänlig"),
  indoor: t("signal.indoor", "Inomhusvänlig"),
};

function normalizeRouteSignalText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function routeSignalLooksConcrete(note = "") {
  const text = normalizeRouteSignalText(note);
  return /just nu|ikväll|i kväll|torsdag|fredag|lördag|söndag|marknad|konsert|spelning|bar|barer|klubb|scen|live/u.test(
    text,
  );
}

function routeSignalIsRainSafe(note = "") {
  return /regn|inomhus|under tak|vädersäker|regnsäker/u.test(normalizeRouteSignalText(note));
}

function routeSignalIsIndoor(note = "") {
  return /inomhus|under tak|vädersäker|regnsäker/u.test(normalizeRouteSignalText(note));
}

function routeSignalFeelsEvening(route = {}) {
  const text = normalizeRouteSignalText(
    [route.liveEventFitNote, route.pulseNote, route.summary, route.visibleWhy].filter(Boolean).join(" "),
  );
  return /kväll|senare|aperitivo|natt|middag|cocktail|vinbar|barhäng/u.test(text);
}

function routeSignalIsRoundTrip(route = {}) {
  const start = normalizeRouteSignalText(route.startAnchorLabel || "");
  const end = normalizeRouteSignalText(route.endAnchorLabel || "");
  return route.routeShape === "loop" && Boolean(start) && start === end;
}

function buildUsefulRouteSignals(route = {}) {
  const candidates = [];

  if (route.weatherNote && routeSignalIsRainSafe(route.weatherNote)) {
    candidates.push({
      key: routeSignalIsIndoor(route.weatherNote) ? "indoor" : "rain",
      label: routeSignalIsIndoor(route.weatherNote)
        ? usefulRouteSignalLabels.indoor
        : usefulRouteSignalLabels.rain,
    });
  }

  if (
    Number.isFinite(route.longestLegMinutes) &&
    Number.isFinite(route.averageLegMinutes) &&
    route.longestLegMinutes <= 15 &&
    route.averageLegMinutes <= 10
  ) {
    candidates.push({
      key: "easyWalk",
      label: usefulRouteSignalLabels.easyWalk,
    });
  }

  if (route.liveEventFitNote && routeSignalLooksConcrete(route.liveEventFitNote)) {
    candidates.push({
      key: "live",
      label: usefulRouteSignalLabels.live,
    });
  } else if (route.pulseNote && routeSignalLooksConcrete(route.pulseNote)) {
    candidates.push({
      key: "live",
      label: usefulRouteSignalLabels.live,
    });
  }

  if (routeSignalFeelsEvening(route)) {
    candidates.push({
      key: "evening",
      label: usefulRouteSignalLabels.evening,
    });
  }

  if (routeSignalIsRoundTrip(route)) {
    candidates.push({
      key: "roundTrip",
      label: usefulRouteSignalLabels.roundTrip,
    });
  }

  const seenKeys = new Set();
  return candidates
    .filter((candidate) => {
      if (!candidate?.label || seenKeys.has(candidate.key)) {
        return false;
      }
      seenKeys.add(candidate.key);
      return true;
    })
    .slice(0, 2);
}

function buildVisibleWhy(route) {
  return takeLeadSentences(normalizeRouteResultCopy(route.why || route.summary), 2, 220);
}

function createApiRouteView(
  route,
  label = "Huvudrutt",
  liveEvents = [],
  savePayload = null,
  dayDate = null,
) {
  const stopLabels = route.main_stops.map((stop) => stop.label).join(" • ");
  const liveEventById = new Map((liveEvents || []).map((event) => [String(event.id), event]));
  const mapPathPoints = Array.isArray(route.map_path_points) && route.map_path_points.length
    ? route.map_path_points
    : route.map_route_points;
  const routeView = {
    id: route.id,
    title: route.title,
    vibe: label,
    length: formatApproxKm(route.estimated_km),
    summary: normalizeRouteResultCopy(route.summary),
    why: normalizeRouteResultCopy(route.why_recommended),
    curatorVoice: route.curator_voice || null,
    visibleWhy: buildVisibleWhy(route),
    path: `${route.start_label} -> ${stopLabels} -> ${route.end_label}`,
    anchor: route.start_label ? `Start: ${route.start_label}` : null,
    walk: route.end_label ? `${isEnglishUi ? "End" : "Slut"}: ${route.end_label}` : null,
    startAnchorLabel: route.start_label,
    endAnchorLabel: route.end_label,
    routeShapeLabel: null,
    legSummary: buildLegSummary(route),
    stops: route.main_stops.map(
      (stop, index) =>
        `${index + 1}. ${stop.label} • ${stop.area} • ${stop.tags.join(", ")}`,
    ),
    stopItems: route.main_stops.map((stop, index) => ({
      order: index + 1,
      label: stop.label,
      area: stop.area,
      tagSummary: stop.tags.slice(0, 3).join(" • "),
      summary: normalizeRouteResultCopy(stop.summary || stop.vibe || stop.tags.join(", ")),
      text: `${index + 1}. ${stop.label} • ${stop.area} • ${stop.tags.join(", ")}`,
      query: stop.drawer_query || stop.label,
      isLiveEvent: Boolean(stop.is_live_event),
      source: stop.is_live_event ? "live" : "curated",
      sourceLabel: stopSourceLabel({ isLiveEvent: Boolean(stop.is_live_event) }),
      anchorWeight: typeof stop.anchor_weight === "number" ? stop.anchor_weight : null,
      eventId: stop.event_id || null,
      liveEvent: stop.event_id ? liveEventById.get(String(stop.event_id)) || null : null,
      incomingLeg: route.legs?.[index]
        ? {
            fromLabel: route.legs[index].from_label,
            toLabel: route.legs[index].to_label,
            distanceKm: route.legs[index].distance_km,
            minutes: route.legs[index].estimated_walk_minutes,
          }
        : null,
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
    legs: route.legs || [],
    longestLegKm: route.longest_leg_km || null,
    longestLegMinutes: route.longest_leg_minutes || null,
    averageLegMinutes: route.average_leg_minutes || null,
    legFitNote: route.leg_fit_note || null,
    geoFitNote: route.geo_fit_note || null,
    anchorZone: route.anchor_zone || null,
    anchorExplanation: null,
    engineBadges: [],
    guideStops: route.main_stops.map((stop, index) => ({
      order: index + 1,
      label: stop.label,
      area: stop.area,
      summary: normalizeRouteResultCopy(stop.summary || stop.vibe || stop.tags.join(", ")),
      meta: [
        stop.is_live_event ? (isEnglishUi ? "Live right now" : "Live just nu") : null,
        stop.best_time ? `${isEnglishUi ? "Best" : "Bäst"}: ${stop.best_time}` : null,
        stop.price_level ? `${isEnglishUi ? "Price" : "Pris"}: ${stop.price_level}` : null,
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

  routeView.usefulSignals = buildUsefulRouteSignals(routeView);
  return routeView;
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
    routeView.dateLabel || `${t("route.guide", "Parranda-guide")} ${isEnglishUi ? "in" : "i"} ${buildUnavailableCityLabel()}`,
    buildRouteLine(routeView),
    `${routeView.length} • ${routeView.anchorZone || routeView.startAnchorLabel || buildUnavailableCityLabel()}`,
    clipText(routeView.summary, 180),
    "",
    `${t("route.mainStopHeading", "Huvudstopp")}:`,
    ...guideStops.map((stop) => `- ${stop.label}${stop.area ? ` (${stop.area})` : ""}`),
    "",
    `${t("route.openWalking", "Gångrutt")}: ${routeView.routeLink}`,
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
        summary: stop.summary || null,
        meta: null,
      }));

  activeGuideRouteView = routeView;
  routeGuideKicker.textContent = routeView.vibe
    ? `${t("route.guide", "Parranda guide")} • ${routeView.vibe}`
    : t("route.guide", "Parranda guide");
  routeGuideTitle.textContent = routeView.title;
  routeGuideMeta.textContent = [
    routeView.dateLabel || t("route.plannedDay", "Planerad dag"),
    routeView.length,
  ]
    .filter(Boolean)
    .join(" • ");
  routeGuideRouteLine.textContent = buildRouteLine(routeView);
  routeGuideSummary.textContent = routeView.summary || "";
  routeGuideWhy.textContent =
    takeLeadSentences(
        routeView.why ||
        routeView.geoFitNote ||
        t("route.whyFallback", "Parranda valde den här rutten som dagens tydligaste huvudspår."),
      3,
      340,
    );
  routeGuideDirectionsLink.href = routeView.routeLink || "#";

  routeGuideStats.innerHTML = "";
  [
    { label: t("route.start", "Start"), value: routeView.startAnchorLabel || routeView.mapRoutePoints?.[0]?.label || buildUnavailableCityLabel() },
    { label: t("route.end", "Slut"), value: routeView.endAnchorLabel || routeView.mapRoutePoints?.[routeView.mapRoutePoints.length - 1]?.label || buildUnavailableCityLabel() },
    { label: t("route.zone", "Zon"), value: routeView.anchorZone || null },
  ]
    .filter((stat) => stat.value)
    .forEach((stat) => {
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
    summary.textContent = stop.summary || "";
    summary.hidden = !summary.textContent;
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
        label: pointKey === "home_base" ? "Där jag bor" : "Min plats",
        lat: coords.lat,
        lng: coords.lng,
      };
    } catch (error) {
      updateRouteMatchSummary(
        pointKey === "home_base"
          ? "Platsåtkomst nekades eller saknades, så Parranda väljer ett område själv."
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
  plannerOptions = isRomeCuratedMode ? createLocalPlannerOptions() : [];
  populatePresetSelects();

  if (isFallbackRequestedCity) {
    setRouteApiStatus(false);
    return;
  }

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

  renderHeroBlitz();

  if (isRomeCuratedMode && blitzOriginMode === "selected_place" && blitzContextKey) {
    loadHeroBlitz().catch(() => {});
  }
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
        `<strong>${event.title}</strong><br>${event.venue || getMapCityFallbackLabel()}<br>${event.route_fit_note || "Live-event på eller nära rutten."}`,
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

  marker.bindPopup(`<strong>${item.label}</strong><br>${item.area || getMapCityFallbackLabel()}`).openPopup();
  map.setView([item.lat, item.lng], 15, { animate: true });

  mapPlaceName.textContent = item.label;
  mapPlaceMeta.textContent = `${item.type || "plats"} • ${item.area || getMapCityFallbackLabel()}`;
  mapPlaceDescription.textContent = item.long_description || item.summary || item.vibe || "";
  mapPlaceNote.textContent =
    item.route_fit_note || item.opening_summary || `Utvald plats i ${getMapCityFallbackLabel()}.`;
  mapPlaceLink.href =
    item.external_map_url || createMapUrl(withPlannerCitySearchLabel(item.label));
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

  const mapCenter = plannerCity.center || { lat: 41.8933, lng: 12.4964 };

  map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView([mapCenter.lat, mapCenter.lng], 12);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  routeOverlay = L.layerGroup().addTo(map);

  getFrontendPlaces().forEach((place) => {
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
  const featuredPlaces = getFrontendPlaces().filter((place) => place.featured);

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
    emptyState.innerHTML = hasRomeFrontendContent
      ? "<h3>Inga träffar just nu</h3><p>Testa ett annat sökord eller byt vibe, till exempel street art, lugn eller aperitivo.</p>"
      : `<h3>${buildUnavailableCityLabel()} har inga kuraterade platskort ännu</h3><p>Frontend-lagret håller tillbaka Rome-platser tills staden har ett eget innehållspack.</p>`;
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
    mapLink.textContent = t("template.placeCard.mapLink", "Visa på karta");

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
  const guides = getFrontendDistrictGuides();
  return guides.find((guide) => guide.id === guideId) || guides[0] || null;
}

function getActiveDistrictGuide() {
  return getDistrictGuideById(activeDistrictId);
}

function renderDistrictGuide() {
  const guide = getActiveDistrictGuide();

  if (!guide) {
    return;
  }

  const districtHeadingSections = districtsPanel
    ? [...districtsPanel.querySelectorAll(".section-heading.compact-heading")]
    : [];
  const selectorHeadingSection = districtHeadingSections[0] || null;
  const actionEyebrow = document.querySelector(".district-cta-copy .eyebrow");

  districtEyebrow.textContent = guide.eyebrow;
  districtTitle.textContent = guide.title;
  districtDescription.textContent = guide.description;
  if (selectorHeadingSection) {
    const selectorEyebrow = selectorHeadingSection.querySelector(".eyebrow");
    const selectorTitle = selectorHeadingSection.querySelector("h2");
    const selectorNote = selectorHeadingSection.querySelector(".section-note");
    if (selectorEyebrow) {
      selectorEyebrow.textContent = readLocalizedContent(districtUiCopy.selectorEyebrow);
    }
    if (selectorTitle) {
      selectorTitle.textContent = readLocalizedContent(districtUiCopy.selectorTitle);
    }
    if (selectorNote) {
      selectorNote.textContent = readLocalizedContent(districtUiCopy.selectorNote);
    }
  }
  districtStopsEyebrow.textContent = guide.eyebrow;
  districtStopsTitle.textContent = guide.stopsTitle;
  districtStopsNote.textContent = guide.stopsNote;
  districtDayEyebrow.textContent = readLocalizedContent(districtUiCopy.dayEyebrow);
  districtDayTitle.textContent = guide.dayTitle;
  districtDayNote.textContent = guide.dayNote;
  if (actionEyebrow) {
    actionEyebrow.textContent = readLocalizedContent(districtUiCopy.actionEyebrow);
  }
  districtActionTitle.textContent = guide.actionTitle;
  districtActionCopy.textContent = guide.actionCopy;
  if (districtSetStartButton) {
    districtSetStartButton.textContent = readLocalizedContent(districtUiCopy.actionSetStart);
  }
  if (districtSetEndButton) {
    districtSetEndButton.textContent = readLocalizedContent(districtUiCopy.actionSetEnd);
  }
  if (districtPlanButton) {
    districtPlanButton.textContent = readLocalizedContent(districtUiCopy.actionPlan);
  }
  if (districtMapButton) {
    districtMapButton.textContent = readLocalizedContent(districtUiCopy.actionMap);
  }

  districtStatsGrid.innerHTML = "";
  guide.stats.forEach((item) => {
    const card = document.createElement("article");
    card.innerHTML = `<strong>${item.value}</strong><span>${item.label}</span>`;
    districtStatsGrid.appendChild(card);
  });

  districtSelector.innerHTML = "";
  getFrontendDistrictGuides().forEach((item) => {
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
    const card = districtStopTemplate.content.firstElementChild.cloneNode(true);

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
    mapLink.textContent = readLocalizedContent(districtUiCopy.showOnMap);
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
      `${guide.startLabel} vägs in som område där du bor. Justera datum, km och smak innan du planerar.`,
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

  if (isRomeCuratedMode) {
    loadHeroBlitz().catch(() => {});
  }
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

  if (isRomeCuratedMode) {
    loadHeroBlitz().catch(() => {});
  }
}

function appendRoutePillButtons(container, items = []) {
  container.innerHTML = "";

  items.slice(0, 5).forEach((item) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "route-chip-link";
    chip.textContent = item;
    chip.addEventListener("click", () => {
      openPlaceDrawerByQuery(item);
    });
    container.appendChild(chip);
  });
}

function appendRouteSpecialNotes(container, notes = []) {
  container.hidden = !notes.length;
  container.innerHTML = "";

  notes.forEach((noteText) => {
    const note = document.createElement("p");
    note.className = "route-special-note";
    note.textContent = noteText;
    container.appendChild(note);
  });
}

function appendRouteWarnings(container, warnings = []) {
  container.hidden = !warnings.length;
  container.innerHTML = "";

  warnings.forEach((warningText) => {
    const warning = document.createElement("p");
    warning.className = "route-warning";
    warning.textContent = warningText;
    container.appendChild(warning);
  });
}

function getActiveDayPhaseLabel(index, totalStops) {
  if (index === 0) {
    return isEnglishUi ? "Start here" : "Börja här";
  }

  if (index === totalStops - 1) {
    return isEnglishUi ? "Land here" : "Landa här";
  }

  return "";
}

function buildActiveDayFlowNote(routeView) {
  const stopCount = Array.isArray(routeView.stopItems) ? routeView.stopItems.length : 0;
  const stopLabel = isEnglishUi
    ? stopCount === 1
      ? "one stop"
      : `${stopCount} stops`
    : stopCount === 1
      ? "ett stopp"
      : `${stopCount} stopp`;
  const start = routeView.startAnchorLabel || (isEnglishUi ? "the day" : "dagen");
  const end = routeView.endAnchorLabel || (isEnglishUi ? "the finish" : "slutet");

  if (routeView.routeShape === "loop") {
    return isEnglishUi
      ? `Start in ${start}, keep the pace together through ${stopLabel}, and land back where the day feels strongest.`
      : `Börja i ${start}, håll ihop tempot genom ${stopLabel} och landa tillbaka där dagen känns som starkast.`;
  }

  return isEnglishUi
    ? `Start in ${start}, move forward through ${stopLabel}, and land in ${end} without unnecessary detours.`
    : `Börja i ${start}, rör dig framåt genom ${stopLabel} och landa i ${end} utan onödiga omvägar.`;
}

function createItineraryStop(stopItem, onOpen, phaseLabel = "") {
  const stop = document.createElement("article");
  stop.className = "route-stop-item is-itinerary";

  if (stopItem.incomingLeg?.minutes || stopItem.incomingLeg?.distanceKm) {
    const leg = document.createElement("p");
    leg.className = "route-stop-leg";
    leg.textContent = [
      formatLegMinutes(Number(stopItem.incomingLeg.minutes)),
      formatLegDistance(Number(stopItem.incomingLeg.distanceKm)),
      stopItem.incomingLeg.fromLabel
        ? `${isEnglishUi ? "from" : "från"} ${stopItem.incomingLeg.fromLabel}`
        : null,
    ]
      .filter(Boolean)
      .join(" • ");
    stop.appendChild(leg);
  }

  const main = document.createElement("div");
  main.className = "route-stop-main";

  const order = document.createElement("span");
  order.className = "route-stop-order";
  order.textContent = String(stopItem.order || 0);
  main.appendChild(order);

  const body = document.createElement("div");
  body.className = "route-stop-body";

  if (phaseLabel) {
    const phase = document.createElement("p");
    phase.className = "route-stop-phase";
    phase.textContent = phaseLabel;
    body.appendChild(phase);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "route-stop-link";
  button.textContent = stopItem.label || stopItem.text;
  button.addEventListener("click", onOpen);
  body.appendChild(button);

  const meta = document.createElement("p");
  meta.className = "route-stop-meta";
  meta.textContent = [stopItem.area, stopItem.tagSummary || stopItem.summary]
    .filter(Boolean)
    .join(" • ");
  meta.hidden = !meta.textContent;
  body.appendChild(meta);

  const detail = document.createElement("div");
  detail.className = "route-stop-detail";

  appendCredibilityBadges(detail, stopItem);

  detail.hidden = detail.childElementCount === 0;
  body.appendChild(detail);
  main.appendChild(body);
  stop.appendChild(main);

  return stop;
}

const ANCHOR_BADGE_THRESHOLD = 2.5;

function appendCredibilityBadges(parent, stopItem) {
  // A live event is never a neighborhood anchor — keep the anchor badge
  // mutually exclusive with isLiveEvent regardless of upstream anchor_weight
  // (live-event candidates can score quite high in the route engine).
  if (
    !stopItem.isLiveEvent &&
    typeof stopItem.anchorWeight === "number" &&
    stopItem.anchorWeight >= ANCHOR_BADGE_THRESHOLD
  ) {
    const badge = document.createElement("span");
    badge.className = "credibility-badge credibility-badge--anchor";
    badge.textContent = t("credibility.anchor", "Områdets fixpunkt");
    parent.appendChild(badge);
  }

  if (stopItem.isLiveEvent) {
    const badge = document.createElement("span");
    badge.className = "credibility-badge credibility-badge--live";
    badge.textContent = t("credibility.liveEvent", "Liveevent idag");
    parent.appendChild(badge);
  }
}

function appendActiveDayWhy(anchorElement, routeView) {
  const whyText = (routeView.why || "").trim();
  if (!whyText || !anchorElement || !anchorElement.parentNode) {
    return;
  }

  const block = document.createElement("section");
  block.className = "active-day-why";

  const label = document.createElement("p");
  label.className = "active-day-why-label";
  label.textContent = t("credibility.whyThisRoute", "Varför just den här rutten");
  block.appendChild(label);

  const body = document.createElement("p");
  body.className = "active-day-why-text";
  body.textContent = takeLeadSentences(whyText, 2, 260);
  block.appendChild(body);

  anchorElement.insertAdjacentElement("afterend", block);
}

const CURATOR_VOICE_FIELDS = [
  { key: "why_area", labelKey: "curator.whyArea", labelFallback: "Varför detta område" },
  { key: "why_order", labelKey: "curator.whyOrder", labelFallback: "Varför den här ordningen" },
  { key: "why_now", labelKey: "curator.whyNow", labelFallback: "Varför just nu" },
  { key: "who_fits", labelKey: "curator.whoFits", labelFallback: "Passar för" },
];

function appendActiveDayCuratorVoice(anchorElement, routeView) {
  const voice = routeView.curatorVoice;
  if (!voice || typeof voice !== "object" || !anchorElement || !anchorElement.parentNode) {
    return;
  }

  const summaryText = (voice.why_area || "").trim();
  if (!summaryText) {
    return;
  }

  const detailFields = CURATOR_VOICE_FIELDS.filter(f => f.key !== "why_area");
  const detailEntries = detailFields
    .map(field => ({ field, text: (voice[field.key] || "").trim() }))
    .filter(entry => entry.text);

  const block = document.createElement("section");
  block.className = "active-day-curator";

  const summaryRow = document.createElement("div");
  summaryRow.className = "active-day-curator-summary";

  const summaryLabel = document.createElement("p");
  summaryLabel.className = "active-day-curator-label";
  summaryLabel.textContent = t("curator.whyArea", "Varför detta område");

  const summaryBody = document.createElement("p");
  summaryBody.className = "active-day-curator-text";
  summaryBody.textContent = summaryText;

  summaryRow.append(summaryLabel, summaryBody);
  block.appendChild(summaryRow);

  if (detailEntries.length) {
    const details = document.createElement("details");
    details.className = "active-day-curator-details";

    const summary = document.createElement("summary");
    summary.className = "active-day-curator-toggle";
    summary.textContent = t("curator.readMore", "Read more");
    details.appendChild(summary);

    detailEntries.forEach(({ field, text }) => {
      const row = document.createElement("div");
      row.className = "active-day-curator-row";

      const label = document.createElement("p");
      label.className = "active-day-curator-label";
      label.textContent = t(field.labelKey, field.labelFallback);

      const body = document.createElement("p");
      body.className = "active-day-curator-text";
      body.textContent = text;

      row.append(label, body);
      details.appendChild(row);
    });

    block.appendChild(details);
  }

  anchorElement.insertAdjacentElement("afterend", block);
}

function createActiveDayView(routeView, { routeKey }) {
  const view = activeDayRouteTemplate.content.firstElementChild.cloneNode(true);
  const engineStrip = view.querySelector(".active-day-engine");
  const enginePills = view.querySelector(".active-day-engine-pills");
  const engineNote = view.querySelector(".active-day-engine-note");
  const legSummary = view.querySelector(".active-day-leg-summary");
  const weatherNote = view.querySelector(".active-day-weather-note");
  const specials = view.querySelector(".active-day-specials");
  const warnings = view.querySelector(".active-day-warnings");
  const itinerary = view.querySelector(".active-day-itinerary");
  const hiddenMentions = view.querySelector(".active-day-hidden-pills");
  const hiddenBlock = view.querySelector('.active-day-mentions[data-kind="hidden"]');
  const barMentions = view.querySelector(".active-day-bar-pills");
  const barsBlock = view.querySelector('.active-day-mentions[data-kind="bars"]');
  const selectButton = view.querySelector(".active-day-select-button");
  const guideButton = view.querySelector(".active-day-guide-button");
  const routeLink = view.querySelector(".active-day-route-link");
  const shapePill = view.querySelector(".active-day-shape");
  const lengthPill = view.querySelector(".active-day-length");
  const usefulSignals = routeView.usefulSignals || [];

  view.dataset.routeKey = routeKey;
  view.classList.toggle("is-selected", activeRouteKey === routeKey);

  shapePill.hidden = !usefulSignals.length;
  shapePill.textContent = usefulSignals[0]?.label || "";
  lengthPill.textContent = routeView.length;
  const flowNote = view.querySelector(".active-day-flow-note");
  flowNote.textContent = buildActiveDayFlowNote(routeView);
  appendActiveDayWhy(flowNote, routeView);
  const whyAnchor = view.querySelector(".active-day-why") || flowNote;
  appendActiveDayCuratorVoice(whyAnchor, routeView);

  enginePills.innerHTML = "";
  usefulSignals.slice(shapePill.hidden ? 0 : 1).forEach((signal) => {
    const pill = document.createElement("span");
    pill.className = "route-engine-pill";
    pill.textContent = signal.label;
    enginePills.appendChild(pill);
  });
  engineNote.hidden = true;
  engineNote.textContent = "";
  engineStrip.hidden = enginePills.children.length === 0;

  legSummary.hidden = !routeView.legSummary;
  if (routeView.legSummary) {
    legSummary.textContent = routeView.legSummary;
  }

  weatherNote.hidden = !routeView.weatherNote;
  if (routeView.weatherNote) {
    weatherNote.textContent = routeView.weatherNote;
  }

  const specialNotes = [
    routeView.pulseNote,
    routeView.liveEventFitNote,
    ...(routeView.venueSpecials || []),
    routeView.budgetNote,
  ].filter(Boolean);
  appendRouteSpecialNotes(specials, specialNotes);
  appendRouteWarnings(warnings, routeView.openingWarnings || []);

  itinerary.innerHTML = "";
  const stopItems = routeView.stopItems || [];
  stopItems.forEach((stopItem, index) => {
    const openStop = () => {
      if (stopItem.liveEvent) {
        openPlaceDrawer(buildEventDrawerItem(stopItem.liveEvent));
        return;
      }
      openPlaceDrawerByQuery(stopItem.query || stopItem.label || stopItem.text);
    };

    itinerary.appendChild(
      createItineraryStop(
        stopItem,
        openStop,
        getActiveDayPhaseLabel(index, stopItems.length),
      ),
    );
  });

  appendRoutePillButtons(hiddenMentions, routeView.hiddenMentions || []);
  hiddenBlock.hidden = !(routeView.hiddenMentions || []).length;
  appendRoutePillButtons(barMentions, routeView.barMentions || []);
  barsBlock.hidden = !(routeView.barMentions || []).length;

  routeLink.href = routeView.routeLink;
  routeLink.textContent = t("route.openToday", "Öppna dagens rutt");

  selectButton.hidden = !isRomeCuratedMode;
  selectButton.classList.toggle("is-active", activeRouteKey === routeKey);
  selectButton.textContent = activeRouteKey === routeKey
    ? t("route.mapActive", "Kartfokus aktivt")
    : t("route.showInApp", "Visa i appen");
  selectButton.addEventListener("click", () => {
    focusRouteCardOnMap(
      routeView,
      routeKey,
      tf("route.focusMap", { title: routeView.title }, `"${routeView.title}" är nu kartfokuserad. Hoppa till kartvyn om du vill se stråket i detalj.`),
    );
  });

  guideButton.addEventListener("click", () => {
    openRouteGuide(routeView);
  });

  return view;
}

function createRouteCard(
  routeView,
  { routeKey, isSecondary = false, isRecommended = false, renderMode = "default" },
) {
  const card = routeCardTemplate.content.firstElementChild.cloneNode(true);
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
  const usefulSignals = routeView.usefulSignals || [];

  card.dataset.routeKey = routeKey;
  card.dataset.routeVariant = isRecommended ? "recommended" : isSecondary ? "alternative" : "default";
  card.dataset.renderMode = renderMode;
  card.classList.toggle("is-recommended", isRecommended);
  card.classList.toggle("is-secondary", isSecondary);
  card.classList.toggle("is-selected", activeRouteKey === routeKey);
  card.querySelector(".route-vibe").textContent = routeView.vibe;
  card.querySelector(".route-length").textContent = routeView.length;
  card.querySelector("h3").textContent = routeView.title;
  card.querySelector(".route-summary").textContent = routeView.summary;
  why.textContent = routeView.visibleWhy || takeLeadSentences(routeView.why, 2, 240);
  why.hidden = !why.textContent;
  card.querySelector(".route-path").hidden = true;
  card.querySelector(".route-metadata").hidden = true;

  enginePills.innerHTML = "";
  usefulSignals.forEach((signal) => {
    const pill = document.createElement("span");
    pill.className = "route-engine-pill";
    pill.textContent = signal.label;
    enginePills.appendChild(pill);
  });
  engineNote.hidden = true;
  engineNote.textContent = "";
  engineStrip.hidden = enginePills.children.length === 0;

  legSummary.hidden = !routeView.legSummary;
  if (routeView.legSummary) {
    legSummary.textContent = routeView.legSummary;
  }
  card.querySelector(".route-link").href = routeView.routeLink;
  card.querySelector(".route-link").textContent = t("route.openWalking", "Öppna gångrutt");
  selectButton.hidden = !isRomeCuratedMode;
  selectButton.classList.toggle("is-active", activeRouteKey === routeKey);
  selectButton.textContent =
    activeRouteKey === routeKey ? t("route.mapActive", "Kartfokus aktivt") : t("route.showInApp", "Visa i appen");

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
  const visibleStops = renderMode === "primary" ? stopItems : stopItems.slice(0, 4);
  visibleStops.forEach((stopItem) => {
    const openStop = () => {
      if (stopItem.liveEvent) {
        openPlaceDrawer(buildEventDrawerItem(stopItem.liveEvent));
        return;
      }
      openPlaceDrawerByQuery(stopItem.query || stopItem.label || stopItem.text);
    };

    if (renderMode === "primary") {
      stopsContainer.appendChild(createItineraryStop(stopItem, openStop));
      return;
    }

    const stop = document.createElement("article");
    stop.className = "route-stop-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-stop-link";
    button.textContent = stopItem.text;
    button.addEventListener("click", openStop);
    stop.appendChild(button);

    stopsContainer.appendChild(stop);
  });

  if (stopItems.length > visibleStops.length) {
    const overflow = document.createElement("p");
    overflow.className = "route-stop-overflow";
    overflow.textContent = tf("route.moreStops", { count: stopItems.length - visibleStops.length }, `+${stopItems.length - visibleStops.length} stopp till i Ren guide`);
    stopsContainer.appendChild(overflow);
  }

  const hiddenMentionsList = routeView.hiddenMentions || [];
  const barMentionsList = routeView.barMentions || [];
  appendRoutePillButtons(hiddenContainer, hiddenMentionsList);
  appendRoutePillButtons(barsContainer, barMentionsList);

  hiddenContainer.closest(".route-mentions").hidden = hiddenMentionsList.length === 0;
  barsContainer.closest(".route-mentions").hidden = barMentionsList.length === 0;

  selectButton.addEventListener("click", () => {
    focusRouteCardOnMap(
      routeView,
      routeKey,
      tf("route.focusGuide", { title: routeView.title }, `"${routeView.title}" är nu kartfokuserad. Hoppa till guidevyn om du vill se rutten i detalj på kartan.`),
    );
  });

  guideButton?.addEventListener("click", () => {
    openRouteGuide(routeView);
  });

  return card;
}

function renderFallbackRoutes() {
  routeResults.innerHTML = "";

  getFrontendFallbackRoutes().forEach((route, index) => {
    const routeView = createFallbackRouteView(route);
    const routeKey = `fallback:${route.id}`;
    const card = createRouteCard(routeView, {
      routeKey,
      isRecommended: index === 0,
    });

    routeResults.appendChild(card);
  });
}

function renderCityPreviewState() {
  routeResults.innerHTML = "";
  const emptyState = document.createElement("article");
  const copy = buildPreviewRouteEmptyState();

  emptyState.className = "empty-state";
  emptyState.innerHTML = `<h3>${copy.title}</h3><p>${copy.body}</p>`;
  routeResults.appendChild(emptyState);
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

function buildPlannerIntentVisibilityState() {
  const selectedIntentKeys = getExplicitSelectedIntentKeys();

  if (!selectedIntentKeys.length || !plannedDays.length) {
    return null;
  }

  return plannerTrustCollectSelectedIntentVisibility({
    selectedIntentKeys,
    days: plannedDays,
    intentDefinitions: plannerIntentDefinitions,
  });
}

function buildPlannerIntentNotes(visibilityState) {
  if (!visibilityState) {
    return [];
  }

  const notes = [];
  const firstLaterIntentKey = visibilityState.laterIntentKeys[0];

  if (firstLaterIntentKey) {
    const dayIndex = visibilityState.firstDayIndexByKey[firstLaterIntentKey];
    const dayVisibility = Number.isInteger(dayIndex) ? visibilityState.perDay[dayIndex] || null : null;
    const laterIntentLabel = getPlannerIntentLabel(firstLaterIntentKey);
    const laterIntentAlreadyVisible = Boolean(
      dayVisibility?.labels?.some((label) => label === laterIntentLabel),
    );

    if (Number.isInteger(dayIndex) && dayIndex > 0 && !laterIntentAlreadyVisible) {
      notes.push(
        isEnglishUi
          ? `${laterIntentLabel} is clearest on Day ${dayIndex + 1}.`
          : `${laterIntentLabel} syns tydligast på Dag ${dayIndex + 1}.`,
      );
    }
  }

  if (visibilityState.missingIntentKeys.length) {
    const missingLabels = visibilityState.missingIntentKeys
      .filter((intentKey) => plannerIntentByKey.has(intentKey))
      .map(getPlannerIntentLabel)
      .slice(0, 2);

    if (missingLabels.length) {
      notes.push(
        isEnglishUi
          ? `${formatPlannerIntentLabelList(missingLabels)} is not clearly represented in the main routes right now.`
          : `${formatPlannerIntentLabelList(missingLabels)} syns inte tydligt i huvudrutterna just nu.`,
      );
    }
  }

  return notes;
}

function renderPlannedDays() {
  routeResults.innerHTML = "";
  const activeDate = ensureActivePlannedDate();
  const activeDay = plannedDays.find((day) => day.date === activeDate) || plannedDays[0];
  const intentVisibilityState = buildPlannerIntentVisibilityState();

  if (!activeDay) {
    return;
  }

  const shell = document.createElement("section");
  shell.className = "planner-results-shell";

  const dayTabs = document.createElement("div");
  dayTabs.className = "planner-day-tabs";

  plannedDays.forEach((day, index) => {
    const dayIntentVisibility = intentVisibilityState?.perDay[index] || null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `planner-day-tab${day.date === activeDay.date ? " is-active" : ""}`;
    const title = document.createElement("span");
    title.className = "planner-day-tab-title";
    title.textContent = `${isEnglishUi ? "Day" : "Dag"} ${index + 1} • ${formatCompactSwedishDate(day.date)}`;
    button.appendChild(title);

    if (dayIntentVisibility?.labels?.length) {
      const cue = document.createElement("span");
      cue.className = "planner-day-tab-cue";
      cue.textContent = dayIntentVisibility.labels.join(" • ");
      button.appendChild(cue);
    }

    button.addEventListener("click", () => {
      activePlannedDate = day.date;
      activeLiveDate = day.date;
      loadCityPulse(day.date).catch(() => {});
      renderRouteResults();
    });
    dayTabs.appendChild(button);
  });

  const intentNotes = buildPlannerIntentNotes(intentVisibilityState);

  if (intentNotes.length) {
    const noteList = document.createElement("div");
    noteList.className = "planner-results-intent-notes";

    intentNotes.forEach((text) => {
      const note = document.createElement("p");
      note.className = "planner-results-intent-note";
      note.textContent = text;
      noteList.appendChild(note);
    });

    shell.appendChild(noteList);
  }

  const dayCard = plannerDayTemplate.content.firstElementChild.cloneNode(true);
  const primaryRouteView = createApiRouteView(
    activeDay.primary_route,
    t("route.main", "Huvudrutt"),
    (activeDay.live_events || []).filter((event) => event.best_route_id === activeDay.primary_route.id),
    null,
    activeDay.date,
  );
  const primaryKey = `${activeDay.date}:${activeDay.primary_route.id}:primary`;
  const primarySlot = dayCard.querySelector(".planner-primary-slot");
  const outline = dayCard.querySelector(".planner-day-outline");
  const primaryRouteLine = dayCard.querySelector(".planner-primary-route-line");
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
    primaryRouteView.visibleWhy ||
    takeLeadSentences(activeDay.primary_route.why_recommended || "", 2, 220) ||
    t("route.primaryFallback", "Parranda lyfter den här som dagens tydligaste huvudspår.");
  primaryRouteLine.textContent = buildRouteLine(primaryRouteView);

  outline.innerHTML = "";
  [
    { label: t("route.start", "Start"), value: primaryRouteView.startAnchorLabel },
    { label: t("route.end", "Slut"), value: primaryRouteView.endAnchorLabel },
    { label: t("route.zone", "Zon"), value: primaryRouteView.anchorZone },
  ]
    .filter((item) => item.value)
    .forEach((item) => {
      const chip = document.createElement("p");
      chip.className = "planner-day-outline-item";
      chip.innerHTML = `<span>${item.label}</span><strong>${item.value}</strong>`;
      outline.appendChild(chip);
    });

  signalsContainer.hidden = !activeDay.date_signals?.length;
  signalsContainer.innerHTML = "";
  (activeDay.date_signals || []).forEach((signal) => {
    const note = document.createElement("article");
    note.className = "planner-day-signal";
    note.innerHTML = `<strong>${signal.title}</strong><p>${signal.note}</p>`;
    signalsContainer.appendChild(note);
  });

  const dayEvents = activeDay.live_events || [];
  const visibleDayEvents = dayEvents.slice(0, 2);
  eventsGrid.innerHTML = "";
  eventsSection.hidden = !dayEvents.length;
  visibleDayEvents.forEach((event) => {
    eventsGrid.appendChild(
      createLiveEventCard({
        ...event,
        date: activeDay.date,
      }),
    );
  });

  if (dayEvents.length > visibleDayEvents.length) {
    const overflow = document.createElement("p");
    overflow.className = "planner-events-note";
    overflow.textContent = tf("route.moreLive", { count: dayEvents.length - visibleDayEvents.length }, `+${dayEvents.length - visibleDayEvents.length} fler live-spår finns i LIVE om du vill justera dagen ytterligare.`);
    eventsGrid.appendChild(overflow);
  }

  primarySlot.appendChild(
    createActiveDayView(primaryRouteView, {
      routeKey: primaryKey,
    }),
  );

  activeDay.alternatives.forEach((alternative, index) => {
    const altView = createApiRouteView(
      alternative,
      tf("route.alternative", { count: index + 1 }, `Alternativ ${index + 1}`),
      (activeDay.live_events || []).filter((event) => event.best_route_id === alternative.id),
      null,
      activeDay.date,
    );
    const altKey = `${activeDay.date}:${alternative.id}:alt-${index}`;
    altGrid.appendChild(
      createRouteCard(altView, {
        routeKey: altKey,
        isSecondary: true,
        renderMode: "alternative",
      }),
    );
  });

  altSection.hidden = activeDay.alternatives.length === 0;

  if (!altSection.hidden) {
    altToggle.textContent = alternativesExpanded
      ? tf("route.hideAlternatives", { count: activeDay.alternatives.length }, `Dölj andra upplägg (${activeDay.alternatives.length})`)
      : tf("route.showAlternatives", { count: activeDay.alternatives.length }, `Visa andra upplägg (${activeDay.alternatives.length})`);
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
  syncShellModeState();
  updateLatestPlannerRestoreNotice();

  if (isFallbackRequestedCity || isInternalCityMode || isPreviewCityMode) {
    routeFallbackNote.hidden = false;
    routeFallbackNote.textContent = buildNonRomeFallbackNote();
  } else {
    routeFallbackNote.hidden = routeApiAvailable !== false;
  }

  if (routeRenderMode === "api" && plannedDays.length) {
    renderPlannedDays();
    return;
  }

  if (!isRomeCuratedMode) {
    renderCityPreviewState();
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
    if (!isRomeCuratedMode) {
      updateRouteMatchSummary(buildNonRomeRouteSummary());
      setPlannerStatusMessage(buildNonRomePlannerLaunchSummary(), "warning");
    } else {
      updateRouteMatchSummary(
        "Live-ruttmotorn svarar inte just nu, så appen visar de kuraterade Rom-baserade rutterna i stället.",
      );
      setPlannerStatusMessage(
        "Live-läget svarar inte just nu, så Parranda visar sina kuraterade Rome-wide-rutter i stället.",
        "warning",
      );
    }
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

  const response = await fetchJson(`${routeApiBase}/route-recommendations?lang=${encodeURIComponent(activeUiLanguage)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  applyPlannerResponseState(response, {
    fallbackDate: routeDateFrom.value || getTodayIsoDate(),
  });
  renderRouteResults();
  loadCityPulse(activeLiveDate).catch(() => {});

  if (!plannedDays.length) {
    latestPlannerResolution = null;
    if (!isRomeCuratedMode) {
      updateRouteMatchSummary(buildNonRomeRouteSummary());
      setPlannerStatusMessage(buildNonRomePlannerLaunchSummary(), "warning");
    } else {
      updateRouteMatchSummary(
        "Ruttmotorn gav inga tydliga träffar för de valen, så de kuraterade alternativen ligger kvar som backup.",
      );
      setPlannerStatusMessage(
        "Jag hittade ingen riktigt stark live-rutt för de här valen, så backup-spåret ligger kvar.",
        "warning",
      );
    }
    return;
  }

  persistLatestPlannerPlan(response);
  setPlannerStatusMessage("");
  updatePlannerLaunchSummary(buildPlanningResultSummary(response));
  updateRouteMatchSummary("");
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
    normalizePlannerIntentSelectionAfterChange(input);
    activeOptimizerMode = null;
    updateOptimizerButtons();
    updatePlannerAdvancedSummary();
    updatePlannerLaunchSummary();
    updateRouteMatchSummary(buildPlannerStyleSummary());
    if (isRomeCuratedMode) {
      loadHeroBlitz().catch(() => {});
    }
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
    `${selectedPlaceName} vägs in som plats där du bor. Det låser inte exakt start.`,
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
      "Min plats vägs in som område där du bor. Om platsåtkomst inte fungerar väljer Parranda själv.",
    );
  } catch (error) {
    updateRouteMatchSummary(
      "Jag kunde inte läsa din plats just nu. Om du fortsätter väljer Parranda ett område själv.",
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
      "Bygger upplägget utifrån datum, känsla och dina val...",
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
    if (!isRomeCuratedMode) {
      updateRouteMatchSummary(buildNonRomeRouteSummary());
      setPlannerStatusMessage(buildNonRomePlannerLaunchSummary(), "error");
    } else {
      updateRouteMatchSummary(
        "Något gick fel i live-läget, så appen föll tillbaka till de kuraterade Rom-rutterna.",
      );
      setPlannerStatusMessage(
        "Något gick fel medan dagen räknades ut, så Parranda föll tillbaka till curated-läget.",
        "error",
      );
    }
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
    !isRomeCuratedMode
      ? buildNonRomePlannerLaunchSummary()
      : "Planeraren är nollställd. Parranda får nu välja start och slut smart igen, och de kuraterade rutterna visas som backup.",
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

heroBlitzApplyButton?.addEventListener("click", async () => {
  openHeroBlitzMove();
});

heroBlitzShuffleButton?.addEventListener("click", () => {
  loadHeroBlitz().catch(() => {});
});

heroBlitzSelectedOriginButton?.addEventListener("click", () => {
  blitzOriginMode = "selected_place";
  renderHeroBlitz();
  loadHeroBlitz().catch(() => {});
});

heroBlitzCurrentOriginButton?.addEventListener("click", () => {
  blitzOriginMode = "current_location";
  renderHeroBlitz();
  loadHeroBlitz().catch(() => {});
});

heroPlannerButton?.addEventListener("click", () => {
  openPlannerModalForMode(plannerAutoMode);
});

plannerRestoreButton?.addEventListener("click", () => {
  restoreLatestPlannerPlan();
});

plannerRestoreDismissButton?.addEventListener("click", () => {
  plannerRestoreDismissButton.blur();
  const record = readLatestPlannerPlanRecord();

  if (!record) {
    hideLatestPlannerRestoreNotice();
    return;
  }

  setLatestPlannerPlanDismissSignature(
    plannerTrustBuildLatestPlannerPlanDismissSignature(record),
  );
  hideLatestPlannerRestoreNotice();
});

routePlannerOpenButton?.addEventListener("click", () => {
  openPlannerModalForMode(plannerAutoMode);
});

routePlannerManualButton?.addEventListener("click", () => {
  openPlannerModalForMode(plannerManualMode);
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
  if (routeRenderMode === "api" && plannedDays.length && focusActiveDayLiveSection()) {
    return;
  }

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

applyCityModeToShell();
applyPlannerModeRestrictions();
renderHeroBlitz();
if (isRomeCuratedMode) {
  renderSpotlights();
  renderPlaces();
  renderDistrictGuide();
}
setPlannerDefaults();
loadCityPulse(routeDateFrom.value || getTodayIsoDate());
renderSavedRoutes();
renderRouteResults();
updateFavoritesUI();
if (isRomeCuratedMode) {
  initMap();
  refreshMarkerStyles();
}
updateInstallButtonVisibility();
registerServiceWorker();
loadPlannerOptions().then(() => {
  syncPlannerModeUI();
  updateWalkingKmLabel();
  renderRouteResults();
  const params = new URLSearchParams(location.search);
  if (params.get("planner") === "open") {
    const seedLabel = params.get("seed_label");
    if (seedLabel) {
      try { setPlannerFieldFromLabel("home_base", seedLabel); }
      catch (_e) { /* silent fallback */ }
    }
    openPlannerModal();
  }
});
