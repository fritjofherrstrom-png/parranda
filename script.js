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
      summary: "Centralt kvarter för vin, kultur och en bättre kvällsrygg.",
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
      "Sätt Monti som bas i route buildern om du vill att dagen ska kännas central men fortfarande kuraterad, kvällsvänlig och tydlig.",
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
      "Trastevere är fortfarande starkt, men nu som en av flera stadsdelssidor. Här är fokus öl, vin, kultur och nattliv utan att kvarteret känns poserande.",
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
      "Testaccio och Ostiense är den södra ryggen när dagen ska drivas av mat, råare kultur och bättre öl- och vinstopp än i vykorts-Rom.",
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
      "Skicka in Testaccio och Ostiense till route buildern om du vill ha ett upplägg som är starkt på mat, kväll och lokal känsla snarare än klassiska fotopunkter.",
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
    title: "Kreativ kvällsrygg, billigare glas och mer rå social energi",
    description:
      "Pigneto och San Lorenzo är rätt när du vill ha yngre energi, barer med mindre filter och ett östligt Rom som känns levt snarare än serverat.",
    selectorNote: "Alternativare, råare och bäst när du vill ha mer folk än finish.",
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
      summary: "Östra Rom för party, kreativ puls och mindre polerad barserie.",
      long_description:
        "San Lorenzo fungerar som råare uppvärmning och Pigneto som mer kreativ final när kvällen ska bli både social och lokalt förankrad.",
      tags: ["party", "öl", "vin", "lokalt nattliv"],
    },
    stats: [
      { value: "5", label: "råa kvällsstopp" },
      { value: "1", label: "östlig kvällsrygg" },
      { value: "$ -> $$", label: "snällare nota" },
    ],
    stopsTitle: "Östra Rom när du vill ha kreativ puls snarare än scenografi",
    stopsNote:
      "Det här området är bäst när du accepterar lite mer brus, lite mindre polish och mycket mer faktisk kvällsenergi.",
    dayTitle: "San Lorenzo till Pigneto utan att tappa tråden",
    dayNote:
      "Börja i råare tempo, bygg in ett eller två riktiga glasstopp och låt Pigneto ta över när kvällen verkligen startar.",
    actionTitle: "Det här läget är starkt för party, budgetsmart öl och socialt flöde",
    actionCopy:
      "Välj San Lorenzo till Pigneto i route buildern om du vill att appen ska ge dig en tydligare östlig kväll än de centrala standardstråken.",
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
const routeResults = document.getElementById("routeResults");
const savedRoutesSection = document.getElementById("savedRoutesSection");
const savedRoutesGrid = document.getElementById("savedRoutesGrid");
const routePlannerForm = document.getElementById("routePlannerForm");
const startModeSelect = document.getElementById("startModeSelect");
const endModeSelect = document.getElementById("endModeSelect");
const startPresetSelect = document.getElementById("startPresetSelect");
const endPresetSelect = document.getElementById("endPresetSelect");
const startCustomInput = document.getElementById("startCustomInput");
const endCustomInput = document.getElementById("endCustomInput");
const routeDateFrom = document.getElementById("routeDateFrom");
const routeDateTo = document.getElementById("routeDateTo");
const distanceModeSelect = document.getElementById("distanceModeSelect");
const walkingKmTarget = document.getElementById("walkingKmTarget");
const walkingKmValue = document.getElementById("walkingKmValue");
const useCurrentPlaceButton = document.getElementById("useCurrentPlaceButton");
const useGeolocationButton = document.getElementById("useGeolocationButton");
const useMapAsEndButton = document.getElementById("useMapAsEndButton");
const routeResetButton = document.getElementById("routeResetButton");
const routeFallbackNote = document.getElementById("routeFallbackNote");
const routePlannerModeChip = document.getElementById("routePlannerModeChip");
const routeMatchSummary = document.getElementById("routeMatchSummary");
const placeTemplate = document.getElementById("placeCardTemplate");
const spotlightTemplate = document.getElementById("spotlightCardTemplate");
const trastevereBarTemplate = document.getElementById("trastevereBarTemplate");
const timelineStopTemplate = document.getElementById("timelineStopTemplate");
const romeRouteTemplate = document.getElementById("romeRouteTemplate");
const plannerDayTemplate = document.getElementById("plannerDayTemplate");
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
const optimizerButtons = document.querySelectorAll("[data-optimizer-mode]");
const budgetTierButtons = document.querySelectorAll("[data-budget-tier]");
const routeModifierButtons = document.querySelectorAll("[data-route-modifier]");

const favoritesStorageKey = "roma-radar-favorites";
const savedRoutesStorageKey = "parranda-saved-routes";
const routeApiBase = "/api";
const plannerDefaultLabel = "Trastevere";

let activeFilter = "all";
let onlyFavorites = false;
let selectedPlaceName = places[0].name;
let favorites = loadFavorites();
let activeTab = "overview";
let activeRouteKey = null;
let deferredInstallPrompt = null;
let map;
let markers = new Map();
let routeOverlay;
let currentLocationCoords = null;
let plannerOptions = [];
let routeApiAvailable = null;
let routeRenderMode = "fallback";
let plannedDays = [];
let latestPlannerSnapshot = null;
let activeDistrictId = "monti";
let activeOptimizerMode = null;
let activeDistanceMode = "soft_target";
let activeBudgetTier = "standard";
let activeRouteModifier = null;
let activeDrawerItem = null;
let savedRoutes = loadSavedRoutes();

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

function updateRouteMatchSummary(text) {
  if (routeMatchSummary) {
    routeMatchSummary.textContent = text;
  }
}

function buildPlannerStyleSummary(prefix = "") {
  const parts = [];

  if (prefix) {
    parts.push(prefix);
  }

  if (activeBudgetTier && budgetTierCopy[activeBudgetTier]) {
    parts.push(budgetTierCopy[activeBudgetTier]);
  }

  if (activeRouteModifier && routeModifierCopy[activeRouteModifier]) {
    parts.push(routeModifierCopy[activeRouteModifier]);
  }

  return parts.join(" ");
}

function buildPlannerSnapshot(payload, dates) {
  return {
    dates,
    dateFrom: routeDateFrom.value || dates[0] || getTodayIsoDate(),
    dateTo: routeDateTo.value || dates[dates.length - 1] || routeDateFrom.value || getTodayIsoDate(),
    start: payload.start,
    end: payload.end,
    walkingKmTarget: Number(payload.walking_km_target || 9),
    preferences: [...(payload.preferences || [])],
    optimizerMode: payload.optimizer_mode || null,
    distanceMode: payload.distance_mode || "soft_target",
    budgetTier: payload.budget_tier || "standard",
    modifier: payload.modifier || null,
  };
}

function createGoogleInfoUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${query} Rome`)}`;
}

function createRouteDirectionsUrl(points) {
  if (!Array.isArray(points) || !points.length) {
    return createMapUrl("Trastevere Rome");
  }

  if (points.length === 1) {
    return createMapUrl(`${points[0].label || "Trastevere"} Rome`);
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
  const districtItems = districtGuides.flatMap((guide) =>
    (guide.plannerPoints || []).map((point) => ({
      id: normalizeText(point.label),
      label: point.label,
      type: "district",
      area: point.area,
      lat: point.lat,
      lng: point.lng,
    })),
  );
  const baseItems = [
    {
      id: "trastevere-default",
      label: plannerDefaultLabel,
      type: "district",
      area: "Trastevere",
      lat: 41.8885,
      lng: 12.4678,
    },
    ...districtItems,
    ...places.map((place) => ({
      id: normalizeText(place.name),
      label: place.name,
      type: place.category,
      area: place.area,
      lat: place.lat,
      lng: place.lng,
    })),
  ];

  return [...new Map(baseItems.map((item) => [item.label, item])).values()];
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
  const selects = [startPresetSelect, endPresetSelect];
  selects.forEach((select) => {
    if (!select) {
      return;
    }

    select.innerHTML = "";
    plannerOptions.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.label;
      option.textContent = `${item.label} • ${item.area}`;
      select.appendChild(option);
    });
  });

  startPresetSelect.value = plannerDefaultLabel;
  endPresetSelect.value = plannerDefaultLabel;
}

function hasPlannerOption(label) {
  return plannerOptions.some((item) => item.label === label);
}

function setPresetSelectValue(select, label) {
  if (!select) {
    return;
  }

  select.value = hasPlannerOption(label) ? label : plannerDefaultLabel;
}

function updatePointModeUI(pointKey, mode) {
  const presetField = document.querySelector(`[data-mode-field="${pointKey}-preset"]`);
  const customField = document.querySelector(`[data-mode-field="${pointKey}-custom"]`);

  if (presetField) {
    presetField.hidden = mode !== "preset";
  }

  if (customField) {
    customField.hidden = mode !== "custom";
  }
}

function syncPlannerModeUI() {
  updatePointModeUI("start", startModeSelect.value);
  updatePointModeUI("end", endModeSelect.value);
}

function updateWalkingKmLabel() {
  if (activeDistanceMode === "no_limit") {
    walkingKmValue.textContent = "Spelar ingen roll";
    return;
  }

  walkingKmValue.textContent = `${walkingKmTarget.value} km`;
}

function updateDistanceModeUI() {
  activeDistanceMode = distanceModeSelect.value;
  walkingKmTarget.disabled = activeDistanceMode === "no_limit";
  updateWalkingKmLabel();
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
  updateRouteMatchSummary(buildPlannerStyleSummary(config.summary));
}

function applyBudgetTier(tier) {
  activeBudgetTier = budgetTierCopy[tier] ? tier : "standard";
  updateBudgetTierButtons();
  updateRouteMatchSummary(buildPlannerStyleSummary());
}

function applyRouteModifier(modifier) {
  activeRouteModifier = modifier && modifier !== "none" ? modifier : null;
  updateRouteModifierButtons();
  updateRouteMatchSummary(buildPlannerStyleSummary());
}

function setPlannerDefaults() {
  const today = getTodayIsoDate();

  startModeSelect.value = "preset";
  endModeSelect.value = "preset";
  if (startPresetSelect.options.length) {
    setPresetSelectValue(startPresetSelect, plannerDefaultLabel);
    setPresetSelectValue(endPresetSelect, plannerDefaultLabel);
  }

  startCustomInput.value = "";
  endCustomInput.value = "";
  routeDateFrom.value = today;
  routeDateTo.value = today;
  distanceModeSelect.value = "soft_target";
  updateDistanceModeUI();
  walkingKmTarget.value = "9";
  updateWalkingKmLabel();
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
}

function applyPlannerPointToForm(pointKey, point) {
  const isStart = pointKey === "start";
  const modeSelect = isStart ? startModeSelect : endModeSelect;
  const presetSelect = isStart ? startPresetSelect : endPresetSelect;
  const customInput = isStart ? startCustomInput : endCustomInput;
  const type = point?.type || "preset";

  modeSelect.value = type;

  if (type === "preset") {
    setPresetSelectValue(presetSelect, point?.label || plannerDefaultLabel);
  } else if (type === "custom") {
    customInput.value = point?.query || point?.label || "";
  } else if (type === "current_location" && typeof point?.lat === "number" && typeof point?.lng === "number") {
    currentLocationCoords = {
      lat: point.lat,
      lng: point.lng,
    };
  }
}

function applyPlannerSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  applyPlannerPointToForm("start", snapshot.start);
  applyPlannerPointToForm("end", snapshot.end);
  routeDateFrom.value = snapshot.dateFrom || snapshot.dates?.[0] || getTodayIsoDate();
  routeDateTo.value =
    snapshot.dateTo || snapshot.dates?.[snapshot.dates.length - 1] || routeDateFrom.value;
  distanceModeSelect.value = snapshot.distanceMode || "soft_target";
  walkingKmTarget.value = String(snapshot.walkingKmTarget || 9);
  activeOptimizerMode = snapshot.optimizerMode || null;
  activeBudgetTier = snapshot.budgetTier || "standard";
  activeRouteModifier = snapshot.modifier || null;
  preferenceInputs.forEach((input) => {
    input.checked = (snapshot.preferences || []).includes(input.value);
  });
  syncPlannerModeUI();
  updateDistanceModeUI();
  updateWalkingKmLabel();
  updateOptimizerButtons();
  updateBudgetTierButtons();
  updateRouteModifierButtons();
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
  return [
    savePayload.date || "nodate",
    savePayload.routeId || "noroute",
    savePayload.snapshot?.budgetTier || "standard",
    savePayload.snapshot?.modifier || "no-modifier",
    normalizeText((savePayload.snapshot?.preferences || []).join("-") || "default"),
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
    path: routeView.path,
    anchor: routeView.anchor,
    walk: routeView.walk,
    stops: [...(routeView.stops || [])],
    stopItems: [...(routeView.stopItems || [])],
    hiddenMentions: [...(routeView.hiddenMentions || [])],
    barMentions: [...(routeView.barMentions || [])],
    routeLink: routeView.routeLink,
    mapRoutePoints: [...(routeView.mapRoutePoints || [])],
    weatherNote: routeView.weatherNote || null,
    venueSpecials: [...(routeView.venueSpecials || [])],
    budgetNote: routeView.budgetNote || null,
    openingWarnings: [...(routeView.openingWarnings || [])],
    liveEvents: [...(routeView.liveEvents || [])],
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

async function runSavedRouteRemix(savedRoute, remixMode = null) {
  const snapshot = remixMode ? remixSnapshot(savedRoute.snapshot, remixMode) : savedRoute.snapshot;
  applyPlannerSnapshot(snapshot);
  switchTab("routes");

  const messageByMode = {
    "more-wine": "Gör en ny version: mer vin, fortfarande samma dag som bas.",
    "shorter-walk": "Gör en ny version: kortare gång, samma dag och känsla som utgångspunkt.",
    "hidden-gems": "Gör en ny version: mer hidden gems, mindre uppenbar väg.",
    "more-evening": "Gör en ny version: mer kväll, mer puls och senare stopp.",
    "more-culture": "Gör en ny version: mer kultur, tydligare rum och mer innehåll mellan glasen.",
    "low-key": "Gör en ny version: mjukare tempo, bättre samtalsstopp och mindre brus.",
    "more-party": "Gör en ny version: mer party, senare energi och starkare nattdrag.",
    budget: "Gör en ny version: billigare öl, mat och smartare budgetankare.",
  };

  updateRouteMatchSummary(
    messageByMode[remixMode] || `"${savedRoute.title}" laddas om som ny utgångspunkt.`,
  );

  try {
    await planRoutes();
  } catch (_error) {
    routeRenderMode = "fallback";
    plannedDays = [];
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
  const remix = document.createElement("div");

  card.className = "saved-route-card";
  meta.className = "saved-route-meta";
  context.className = "saved-route-context";
  preferences.className = "saved-route-preferences";
  actions.className = "saved-route-actions";
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

  title.textContent = savedRoute.title;
  summary.textContent = savedRoute.summary;
  context.textContent =
    preview?.path ||
    [snapshot.start?.label, snapshot.end?.label].filter(Boolean).join(" -> ") ||
    "Sparad dagsbas för nya versioner.";

  [
    savedRoute.date ? formatSwedishDate(savedRoute.date) : null,
    savedRoute.routeLabel || null,
    preview?.length || null,
    snapshot.optimizerMode ? optimizerLabel[snapshot.optimizerMode] || null : null,
    budgetTierLabel[snapshot.budgetTier || "standard"] || null,
    modifierLabel[snapshot.modifier || ""] || null,
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

  const mapButton = document.createElement("button");
  mapButton.type = "button";
  mapButton.className = "primary-button";
  mapButton.textContent = preview ? "Visa på karta" : "Ladda och visa";
  mapButton.addEventListener("click", async () => {
    if (preview) {
      switchTab("overview");
      window.setTimeout(() => {
        drawRouteOnMap(preview);
        document
          .querySelector(".map-explorer")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
      updateRouteMatchSummary(`"${savedRoute.title}" visas nu direkt på kartan från dina sparade dagar.`);
      return;
    }

    await runSavedRouteRemix(savedRoute);
  });
  actions.appendChild(mapButton);

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "secondary-button";
  openButton.textContent = "Ladda igen";
  openButton.addEventListener("click", () => {
    runSavedRouteRemix(savedRoute);
  });
  actions.appendChild(openButton);

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
      runSavedRouteRemix(savedRoute, item.id);
    });
    remix.appendChild(button);
  });

  [meta, title, context, summary, preferences, actions, remix].forEach((element) => {
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

  const isStart = pointKey === "start";
  const modeSelect = isStart ? startModeSelect : endModeSelect;
  const presetSelect = isStart ? startPresetSelect : endPresetSelect;
  const customInput = isStart ? startCustomInput : endCustomInput;
  const plannerLabel = activeDrawerItem.label;

  if (hasPlannerOption(plannerLabel)) {
    modeSelect.value = "preset";
    syncPlannerModeUI();
    setPresetSelectValue(presetSelect, plannerLabel);
  } else {
    modeSelect.value = "custom";
    syncPlannerModeUI();
    customInput.value = plannerLabel;
  }

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
    ? `${item.label} kan nu användas direkt som startpunkt, slutpunkt eller ny grund i route buildern.`
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
      `${routeApiBase}/place-details?q=${encodeURIComponent(query)}`,
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

  return (routeSeeds[routeId] || ["Trastevere"]).map((label, index, all) => {
    const point = pointCatalog.get(label) || pointCatalog.get("Trastevere");
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
    venueSpecials: [],
    openingWarnings: [],
  };
}

function createApiRouteView(route, label = "Huvudrutt", liveEvents = [], savePayload = null) {
  const stopLabels = route.main_stops.map((stop) => stop.label).join(" • ");

  return {
    id: route.id,
    title: route.title,
    vibe: label,
    length: `ca ${route.estimated_km} km`,
    summary: route.summary,
    why: route.why_recommended,
    path: `${route.start_label} -> ${stopLabels} -> ${route.end_label}`,
    anchor: `Start: ${route.start_label}`,
    walk: `Slut: ${route.end_label}`,
    stops: route.main_stops.map(
      (stop, index) =>
        `${index + 1}. ${stop.label} • ${stop.area} • ${stop.tags.join(", ")}`,
    ),
    stopItems: route.main_stops.map((stop, index) => ({
      text: `${index + 1}. ${stop.label} • ${stop.area} • ${stop.tags.join(", ")}`,
      query: stop.label,
    })),
    hiddenMentions: route.hidden_mentions,
    barMentions: route.bar_mentions,
    routeLink: createRouteDirectionsUrl(route.map_route_points),
    mapRoutePoints: route.map_route_points,
    weatherNote: route.weather_note,
    venueSpecials: route.venue_specials || [],
    budgetNote: route.budget_note || null,
    openingWarnings: route.opening_hours_warnings,
    liveEvents,
    savePayload,
  };
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
  const isStart = pointKey === "start";
  const modeSelect = isStart ? startModeSelect : endModeSelect;
  const presetSelect = isStart ? startPresetSelect : endPresetSelect;
  const customInput = isStart ? startCustomInput : endCustomInput;
  const mode = modeSelect.value;

  if (mode === "current_location") {
    try {
      const coords = await ensureCurrentLocation();
      return {
        type: "current_location",
        label: "Min plats",
        lat: coords.lat,
        lng: coords.lng,
      };
    } catch (error) {
      const fallbackLabel = selectedPlaceName || plannerDefaultLabel;
      updateRouteMatchSummary(
        `Platsåtkomst nekades eller saknades, så ${isStart ? "start" : "slut"}punkten får bli ${fallbackLabel} i stället.`,
      );
      return { type: "preset", label: fallbackLabel };
    }
  }

  if (mode === "custom") {
    const query = customInput.value.trim();
    return query
      ? { type: "custom", label: query, query }
      : { type: "preset", label: plannerDefaultLabel };
  }

  return {
    type: "preset",
    label: presetSelect.value || plannerDefaultLabel,
  };
}

async function loadPlannerOptions() {
  plannerOptions = createLocalPlannerOptions();
  populatePresetSelects();

  try {
    const response = await fetchJson(`${routeApiBase}/places/search`);
    if (Array.isArray(response.items) && response.items.length) {
      plannerOptions = response.items;
      populatePresetSelects();
      setRouteApiStatus(true);
      return;
    }

    setRouteApiStatus(false);
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

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.error("Service worker registration failed", error);
  }
}

function switchTab(tabName) {
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
}

function updateMapPanelForRoute(routeView) {
  mapPlaceName.textContent = routeView.title;
  mapPlaceMeta.textContent = `${routeView.anchor} • ${routeView.walk}`;
  mapPlaceDescription.textContent = routeView.summary;
  mapPlaceNote.textContent = routeView.liveEvents?.length
    ? `${routeView.why || "Kartfokus på dagens valda rutt."} ${routeView.liveEvents.length} live-event passar extra bra med just den här rutten.`
    : routeView.why || "Kartfokus på dagens valda rutt.";
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

  const latLngs = routeView.mapRoutePoints.map((point) => [point.lat, point.lng]);
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
    item.route_fit_note || item.opening_summary || "Kuraterad plats i Rom.";
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

  modeSelect.value = "preset";
  syncPlannerModeUI();
  setPresetSelectValue(presetSelect, label);
}

function planFromCurrentDistrictGuide() {
  const guide = getActiveDistrictGuide();

  applyDistrictGuidePreset("start");
  applyDistrictGuidePreset("end");
  switchTab("routes");
  document
    .querySelector('[data-tab-panel="routes"]')
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
  updateRouteMatchSummary(
    buildPlannerStyleSummary(
      `${guide.startLabel} -> ${guide.endLabel} ligger nu som ruttbas. Justera datum, km och smak innan du planerar.`,
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
  const weatherNote = card.querySelector(".route-weather-note");
  const specials = card.querySelector(".route-specials");
  const warnings = card.querySelector(".route-warnings");
  const why = card.querySelector(".route-why");
  const selectButton = card.querySelector(".route-select-button");
  const saveButton = card.querySelector(".route-save-button");

  card.dataset.routeKey = routeKey;
  card.classList.toggle("is-recommended", isRecommended);
  card.classList.toggle("is-secondary", isSecondary);
  card.classList.toggle("is-selected", activeRouteKey === routeKey);
  card.querySelector(".route-vibe").textContent = routeView.vibe;
  card.querySelector(".route-length").textContent = routeView.length;
  card.querySelector("h3").textContent = routeView.title;
  card.querySelector(".route-summary").textContent = routeView.summary;
  why.textContent = routeView.why || "";
  why.hidden = !routeView.why;
  card.querySelector(".route-path").textContent = routeView.path;
  card.querySelector(".route-anchor").textContent = routeView.anchor;
  card.querySelector(".route-walk").textContent = routeView.walk;
  card.querySelector(".route-link").href = routeView.routeLink;
  selectButton.classList.toggle("is-active", activeRouteKey === routeKey);
  selectButton.textContent =
    activeRouteKey === routeKey ? "Kartfokus aktivt" : "Visa på karta";

  weatherNote.hidden = !routeView.weatherNote;
  if (routeView.weatherNote) {
    weatherNote.textContent = routeView.weatherNote;
  }

  specials.hidden = !routeView.venueSpecials.length;
  specials.innerHTML = "";
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
  stopItems.forEach((stopItem) => {
    const stop = document.createElement("p");
    stop.className = "route-stop-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-stop-link";
    button.textContent = stopItem.text;
    button.addEventListener("click", () => {
      openPlaceDrawerByQuery(stopItem.query || stopItem.text);
    });
    stop.appendChild(button);

    stopsContainer.appendChild(stop);
  });

  routeView.hiddenMentions.forEach((item) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "route-chip-link";
    chip.textContent = item;
    chip.addEventListener("click", () => {
      openPlaceDrawerByQuery(item);
    });
    hiddenContainer.appendChild(chip);
  });

  routeView.barMentions.forEach((item) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "route-chip-link";
    chip.textContent = item;
    chip.addEventListener("click", () => {
      openPlaceDrawerByQuery(item);
    });
    barsContainer.appendChild(chip);
  });

  selectButton.addEventListener("click", () => {
    focusRouteCardOnMap(
      routeView,
      routeKey,
      `"${routeView.title}" är nu kartfokuserad. Hoppa till Roma Guide om du vill se rutten i detalj på kartan.`,
    );
  });

  saveButton.hidden = !routeView.savePayload;
  saveButton.addEventListener("click", () => {
    if (!routeView.savePayload) {
      return;
    }

    savePlannedRoute(enrichSavePayload(routeView.savePayload, routeView));
    updateRouteMatchSummary(`"${routeView.title}" är nu sparad i Parranda och kan remixas när du vill.`);
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

function renderPlannedDays() {
  routeResults.innerHTML = "";

  plannedDays.forEach((day) => {
    const dayCard = plannerDayTemplate.content.firstElementChild.cloneNode(true);
    const primarySavePayload = latestPlannerSnapshot
      ? {
          date: day.date,
          routeId: day.primary_route.id,
          routeLabel: "Huvudrutt",
          title: day.primary_route.title,
          summary: day.primary_route.why_recommended || day.primary_route.summary,
          snapshot: latestPlannerSnapshot,
        }
      : null;
    const primaryRouteView = createApiRouteView(
      day.primary_route,
      "Huvudrutt",
      (day.live_events || []).filter((event) => event.best_route_id === day.primary_route.id),
      primarySavePayload,
    );
    const primaryKey = `${day.date}:${day.primary_route.id}:primary`;
    const primarySlot = dayCard.querySelector(".planner-primary-slot");
    const altGrid = dayCard.querySelector(".planner-alt-grid");
    const altSection = dayCard.querySelector(".planner-alt-section");
    const signalsContainer = dayCard.querySelector(".planner-day-signals");
    const eventsSection = dayCard.querySelector(".planner-day-events");
    const eventsGrid = dayCard.querySelector(".planner-events-grid");

    dayCard.querySelector(".planner-day-date").textContent = formatSwedishDate(day.date);
    dayCard.querySelector(".planner-day-title").textContent = day.primary_route.title;
    dayCard.querySelector(".planner-day-summary").textContent =
      day.primary_route.why_recommended ||
      "Motorn lyfter den här som tydligaste huvuddag utifrån datum, gångmål och preferenser.";

    signalsContainer.hidden = !day.date_signals?.length;
    signalsContainer.innerHTML = "";
    (day.date_signals || []).forEach((signal) => {
      const note = document.createElement("article");
      note.className = "planner-day-signal";
      note.innerHTML = `<strong>${signal.title}</strong><p>${signal.note}</p>`;
      signalsContainer.appendChild(note);
    });

    eventsGrid.innerHTML = "";
    eventsSection.hidden = !day.live_events?.length;
    (day.live_events || []).forEach((event) => {
      eventsGrid.appendChild(
        createLiveEventCard({
          ...event,
          date: day.date,
        }),
      );
    });

    primarySlot.appendChild(
      createRouteCard(primaryRouteView, {
        routeKey: primaryKey,
        isRecommended: true,
      }),
    );

    day.alternatives.forEach((alternative, index) => {
      const altSavePayload = latestPlannerSnapshot
        ? {
            date: day.date,
            routeId: alternative.id,
            routeLabel: `Alternativ ${index + 1}`,
            title: alternative.title,
            summary: alternative.why_recommended || alternative.summary,
            snapshot: latestPlannerSnapshot,
          }
        : null;
      const altView = createApiRouteView(
        alternative,
        `Alternativ ${index + 1}`,
        (day.live_events || []).filter((event) => event.best_route_id === alternative.id),
        altSavePayload,
      );
      const altKey = `${day.date}:${alternative.id}:alt-${index}`;
      altGrid.appendChild(
        createRouteCard(altView, {
          routeKey: altKey,
          isSecondary: true,
        }),
      );
    });

    altSection.hidden = day.alternatives.length === 0;

    routeResults.appendChild(dayCard);
  });
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

  if (!routeApiAvailable) {
    routeRenderMode = "fallback";
    plannedDays = [];
    renderRouteResults();
    updateRouteMatchSummary(
      "Live-ruttmotorn svarar inte just nu, så appen visar de kuraterade Rom-baserade rutterna i stället.",
    );
    return;
  }

  const payload = {
    dates,
    start: await buildPlannerPoint("start"),
    end: await buildPlannerPoint("end"),
    walking_km_target: Number(walkingKmTarget.value),
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
  routeRenderMode = plannedDays.length ? "api" : "fallback";
  activeRouteKey = null;
  renderRouteResults();

  if (!plannedDays.length) {
    updateRouteMatchSummary(
      "Ruttmotorn gav inga tydliga träffar för de valen, så de kuraterade alternativen ligger kvar som backup.",
    );
    return;
  }

  const plannedStart = response.resolved_start?.label || plannerDefaultLabel;
  const plannedEnd = response.resolved_end?.label || plannerDefaultLabel;
  updateRouteMatchSummary(
    buildPlannerStyleSummary(
      `${plannedDays.length} dag(ar) planerade mellan ${plannedStart} och ${plannedEnd}. Först visas huvudrutten per dag, sedan två alternativa upplägg.`,
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
    document
      .querySelector(`[data-tab-panel="${button.dataset.switchTab}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

scrollButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.scroll);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

searchInput.addEventListener("input", renderPlaces);

startModeSelect?.addEventListener("change", syncPlannerModeUI);
endModeSelect?.addEventListener("change", syncPlannerModeUI);
walkingKmTarget?.addEventListener("input", updateWalkingKmLabel);
distanceModeSelect?.addEventListener("change", () => {
  activeOptimizerMode = null;
  updateOptimizerButtons();
  updateDistanceModeUI();
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
  });
});

routeDateFrom?.addEventListener("change", () => {
  if (routeDateTo.value && routeDateTo.value < routeDateFrom.value) {
    routeDateTo.value = routeDateFrom.value;
  }
});

useCurrentPlaceButton?.addEventListener("click", () => {
  startModeSelect.value = "preset";
  syncPlannerModeUI();
  setPresetSelectValue(startPresetSelect, selectedPlaceName);
  switchTab("routes");
  updateRouteMatchSummary(
    `${selectedPlaceName} ligger nu som startpunkt. Planera dagen när du vill.`,
  );
});

useMapAsEndButton?.addEventListener("click", () => {
  endModeSelect.value = "preset";
  syncPlannerModeUI();
  setPresetSelectValue(endPresetSelect, selectedPlaceName);
  updateRouteMatchSummary(
    `${selectedPlaceName} ligger nu som slutpunkt. Planera dagen när du vill.`,
  );
});

useGeolocationButton?.addEventListener("click", async () => {
  startModeSelect.value = "current_location";
  syncPlannerModeUI();

  try {
    await ensureCurrentLocation();
    updateRouteMatchSummary(
      "Min plats är nu vald som startpunkt. Om du nekar åtkomst faller appen tillbaka till vald kartplats eller Trastevere-default.",
    );
  } catch (error) {
    updateRouteMatchSummary(
      "Jag kunde inte läsa din plats just nu. Om du fortsätter används vald kartplats eller Trastevere-default som fallback.",
    );
  }
});

routePlannerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  updateRouteMatchSummary(
    buildPlannerStyleSummary(
      "Planerar dagar utifrån datum, gångmål, väder, live-events och dina preferenser...",
    ),
  );

  try {
    await planRoutes();
  } catch (error) {
    routeRenderMode = "fallback";
    plannedDays = [];
    renderRouteResults();
    setRouteApiStatus(false);
    updateRouteMatchSummary(
      "Något gick fel i live-läget, så appen föll tillbaka till de kuraterade Rom-rutterna.",
    );
  }
});

routeResetButton?.addEventListener("click", () => {
  setPlannerDefaults();
  routeRenderMode = "fallback";
  plannedDays = [];
  activeRouteKey = null;
  clearRouteOverlay();
  renderRouteResults();
  updateRouteMatchSummary(
    "Planeraren är återställd till Trastevere -> Trastevere med standardnivå och utan extra bias. De kuraterade rutterna visas igen.",
  );
});

districtSetStartButton?.addEventListener("click", () => {
  const guide = getActiveDistrictGuide();
  applyDistrictGuidePreset("start");
  switchTab("routes");
  updateRouteMatchSummary(
    `${guide.startLabel} ligger nu som startpunkt. Kombinera gärna med egen slutpunkt eller låt samma kvarter bli final också.`,
  );
});

districtSetEndButton?.addEventListener("click", () => {
  const guide = getActiveDistrictGuide();
  applyDistrictGuidePreset("end");
  switchTab("routes");
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
placeDrawerStartButton?.addEventListener("click", () => {
  const plannerLabel = activeDrawerItem?.label;

  if (!applyDrawerItemToPlanner("start")) {
    return;
  }

  switchTab("routes");
  closePlaceDrawer();
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
  if (event.key === "Escape" && placeDrawer && !placeDrawer.hidden) {
    closePlaceDrawer();
  }
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
