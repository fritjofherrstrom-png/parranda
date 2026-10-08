# Parranda — MVP Product Requirements Document

**Status:** Utkast för produktavstämning. Kraven nedan är avsedda acceptanskriterier, inte ett påstående om att produkten redan uppfyller dem.

## 1. Produktutfall och problem

Parranda ska hjälpa användaren att välja en meningsfull dag eller nästa aktivitet utifrån **vald plats, lokal tid, önskemål och verkligt tillgängliga alternativ**. Det ska vara en komponerad upplevelse, inte en lista över de närmaste eller mest populära platserna.

Målgruppen är människor som vill upptäcka en plats utan att själva behöva sammanställa kartor, öppettider och evenemangskalendrar. Flödet ska fungera även utan lokalkännedom eller teknisk kunskap. Detta är en arbetsbeskrivning av målgruppen; en särskild lanseringsmarknad är inte beslutad.

Problemen som MVP:n ska lösa:
- Närmaste alternativ är inte alltid rätt eller öppet vid den aktuella tiden.
- Statiska förslag kan kännas likadana trots ändrade preferenser och rytm.
- Platsnamn kan vara tvetydiga, och GPS-position kan skilja sig från sökt plats.
- Bristfälliga källor kan ge tomma resultat, osäkra öppettider eller vilseledande eventförslag.

## 2. Överenskommen riktning och arbetsantaganden

### Överenskommet genom användarens instruktioner
- Motorn ska vara platsagnostisk. Stadspaket förbättrar kvaliteten men får inte vara en förutsättning för användbara resultat.
- Preferenser ska påverka de faktiska stoppen och respekteras även vid ersättning och omkomposition.
- Tid och källbelagda öppettider ska kunna väga tyngre än närhet: exempelvis nattliv kl. 01.00 eller kaffe kl. 07.00.
- Högre rytm ska ge motorn större geografiskt urval. Rytm är inte ett användarbeställt kilometer- eller restidsmål.
- ”Låt Parranda välja” ska ge motorn utrymme att anpassa dagen, inte alltid betyda Full.
- Vald plats, dag och uttryckliga geografiska filter får inte ändras tyst. GPS är inte samma sak som ett aktivt sökankare.
- Öppettider, eventdatum, koordinater och källsäkerhet får inte hittas på.
- Användbar lokal Live-supply får inte kräva OpenAI-åtkomst. Modelläsning kan vara ett valfritt komplement.
- Cykel, bil och nya restidsnivåer är uppskjutna.

### Reversibla arbetsantaganden för denna PRD
- MVP:n avser den befintliga mobilanpassade webbprodukten med svenska och engelska, inte en ny native-app.
- Befintlig sparning och Maps-överlämning används; nya konton, betalningar och analysplattformar krävs inte för denna produktleverans.
- ”Varierade förslag” betyder relevanta alternativ när underlag och val motiverar det, inte slumpmässiga byten vid varje uppdatering.
- Ingen ny maximal sökradie fastställs här. Nuvarande tekniska gränser är implementation, inte automatiskt godkända produktgränser.

## 3. Kärnresa

1. Användaren söker en plats eller väljer att använda sin position.
2. Vid tvetydighet visar Parranda begripliga geografiska alternativ. Valet blir ankare för fortsatt planering.
3. Användaren väljer dag, önskemål och Easy, Balanced, Full eller ”Låt Parranda välja”.
4. Parranda samlar källbelagda kandidater och visar en sammanhängande dag med ordnade stopp, uppskattad sträcka och tydliga begränsningar.
5. Användaren ändrar önskemål eller rytm, behåller ett stopp eller väljer bort ett stopp. Den uppdaterade dagen respekterar dessa beslut.
6. Live visar verifierade händelser för vald plats och dag. Större område och senare datum skiljs från det ursprungliga urvalet.
7. Användaren sparar dagen eller lämnar över dess stopp till Maps. Blitz kan föreslå ett nästa drag just nu utan att skriva om den sparade dagen.

## 4. MVP-scope

### Plats och sammanhang
- Gemensamt Planner/Live-flöde för städer, stadsdelar och mindre orter.
- Entydigt eller uttryckligen valt platsankare följer med vid justeringar, sparning och Live.
- Lokal tid används bara när tidszonen har tillräckligt underlag. Vald framtida dag skiljs från ”just nu”.

### Kandidater och komposition
- Relevans för användarens specifika önskemål, öppettider, kvalitet och geografisk sammanhållning styr valet; närhet är en faktor, inte hela beslutet.
- Explicit valda intressen får inte fyllas ut med orelaterade huvudstopp för att nå en viss längd eller stopptotal. Delvisa och saknade matchningar framgår.
- Rytm påverkar både upptäckt och slutlig komposition. Full måste kunna använda fler geografiska alternativ, men behöver inte alltid ge fler stopp eller längre promenad.
- Fri rytm anpassas efter användbara kandidater och tillgänglig tid. Ett motiverat resultat får vara samma som Full.
- Bortval respekteras. Finns ett lämpligt alternativ ska motorn kunna ersätta med ett relevant stopp; annars visas en kortare dag eller en ärlig begränsning.

### Tillgänglighet och Live
- Källbelagt stängt får inte bli ett ”öppet nu”-förslag. Okända öppettider behandlas som okända, inte som bekräftat öppet eller stängt.
- Nattöppettider över midnatt bedöms med rätt föregående veckodag.
- Om närliggande alternativ inte matchar tillgängligheten söker motorn bredare inom godkänt geografiskt scope och sina resursgränser.
- Källbelagda samma-dagshändelser prioriteras. Senare datum och större område märks uttryckligt; inga uppfunna sessioner inom ett datumspann.
- Live-läsning eller automatisk komplettering ändrar inte användarens dag, rutt eller filter.

### Kontroll, presentation och överlämning
- Senaste användarvalet vinner vid snabba justeringar. Gamla svar får inte skriva över nya val.
- Behållna och bortvalda identiteter bevaras inom rätt dags-/platskontext.
- Mobilgränssnittet visar hela relevanta titlar, datum och källänkar utan horisontellt sidöverflöde.
- Uppskattad sträcka och stoppavstånd visas efter komposition. Maps-överlämningen tappar inte stopp eller ordning och presenterar inte råa tekniska del-länkar som den enda användarresan.

## 5. Utanför denna leverans

- Nya bil-/cykellägen, restidsnivåer eller kilometerreglage.
- Obligatoriska konton, betalningar, sociala funktioner eller nya AI-chattytor.
- Garanti om komplett global källtäckning eller en färdig rutt på varje tänkbar plats.
- Stadsspecifika motorundantag för att få testfall att passera.
- Automatisk merge till main eller produktionsdeploy som del av kravdokumentet.
- Ombyggnad av befintlig arkitektur eller ett separat tekniskt designarbete utan nytt uppdrag.

## 6. Meningsfulla fel- och osäkerhetstillstånd

- **Tvetydig plats:** be användaren välja geografisk identitet; välj inte GPS-orten som dold ersättning.
- **Insamling pågår:** visa att underlag hämtas, behåll användarens val och avsluta inom ett avgränsat tidsfönster.
- **Källa otillgänglig:** skilj detta från ”inga händelser finns”. Redan giltiga oberoende fakta kan användas, men källfelet och eventuell ofullständighet kvarstår.
- **Ingen matchande dag kan bekräftas:** visa vad som saknas och en möjlighet att ändra dag eller önskemål; publicera inte orelaterad utfyllnad som full träff.
- **Inga styrkt öppna alternativ:** säg det. Okända timmar kan erbjudas med tydlig osäkerhet, aldrig med ”öppet nu”-löfte.
- **Bortval utan lämplig ersättare:** respektera bortvalet och visa den kortare dagen; återinför inte den bortvalda identiteten.
- **Tidszon, koordinater eller eventdatum saknas:** begränsa vad resultatet kan påstå och vilken rutt-/Live-användning som är möjlig.

## 7. Observerbara acceptanskriterier

**Samtliga punkter är planerade kontroller. Godkännande kräver egen evidens på den aktuella kandidaten.**

### Platsintegritet
- Aktiv sökning på Stockholm när användaren befinner sig i Simrishamn ger Stockholm som planeringsankare, utan tyst GPS-byte.
- Ett valt geografiskt alternativ behåller samma identitet i Planner, rytmjustering och Live. Verklig tvetydighet visas som ett val, inte en felaktig färdig rutt.

### Tid och öppettider
- Med styrkt lokal klocka kl. 01.00 och källan ”föregående dag 20.00–03.00” kan ett relevant nattöppet ställe väljas framför ett närmare stängt.
- Kl. 07.00 väljs ett styrkt öppet kafé framför ett närmare stängt eller annars likvärdigt kafé med okända timmar. Ett relevant kafé längre bort får inte försvinna enbart på grund av närhetsrankning.
- Okänd tidszon leder inte till en uppfunnen lokal klocka eller ett obelagt ”öppet nu”.
- Kontrollen skiljer komposition för en framtida dag från ett Blitz-förslag just nu.

### Preferenser, rytm och variation
- Med samma plats, datum och rytm ger byte mellan nattliv, kultur och kaffe faktiska relevanta ändringar när kandidatpoolen innehåller sådana alternativ.
- Med samma plats, datum och preferenser kan Full utnyttja kandidater utanför det mer kompakta Easy-urvalet. Samma resultat är tillåtet om relevant utbud inte motiverar en annan dag; orsaken får inte döljas bakom falskt fullgod täckning.
- Fri rytm kan välja både en lugnare och en fylligare profil i olika styrkta situationer. Knapptryck, API-värde och publicerad dag kontrolleras tillsammans.
- Efter bortval saknas exakt den identiteten i den nya rutten. Ersättning provas separat med en pool som innehåller en styrkt lämplig ersättare; borttagning ensam bevisar inte ersättning.
- Behållna stopp överlever relevanta justeringar när de fortfarande är giltiga. En blockerande konflikt redovisas i stället för ett tyst brott mot användarvalet.

### Live, tillit och driftsäkerhet
- Live behåller vald dag även medan en kalender väntar. Större område och följande dagar visas med riktiga datum och tydlig geografisk märkning.
- Öppning och filterändring i Live ändrar inte publicerad rutt eller Maps-stopp.
- Källfel, verifierat tomt och ofullständig insamling är olika observerbara tillstånd.
- En kall första körning provas separat från varm cache. Varm framgång får inte användas som bevis för fungerande kallstart.
- Snabba preferensbyten publicerar bara resultat för de senaste valen och skapar inte okontrollerad förfrågningsspridning.
- En modelloberoende körning visar faktiskt användbar lokal supply när stödda källor finns; enbart appstart räcker inte.

### Mobil och navigation
- Vid 320, 390 och 430 px ryms Planner och Live med långa datum/titlar utan horisontellt sidöverflöde.
- Safari testas i sin egen runtime. Chromium med mobil bredd räknas inte som fysisk Safari-acceptans.
- Maps får publicerad ordning och samtliga stopp; uppskattningar framgår som uppskattningar.

Testgeografin roteras och innehåller stadsdel/punktankare, storstad och mindre ort, inte bara återkommande centrumfall. Fixtures, verkliga källsvar, stagingbrowser, CI och fysisk enhet redovisas som separata evidensnivåer. HTTP 200 med tom `days` räknas inte som en färdig lyckad dag.

## 8. Prioritet, beroenden och leveransgräns

Närmaste produktprioritet är stabil kall insamling och användbara färdiga dagar utan att sänka faktakraven. Därefter förbättras relevanta ersättningar, variation och öppettidstäckning där observerad supply begränsar resultatet.

Beroenden: platsupplösning, källhälsa och källvillkor, tillräcklig verifierbar kandidattäckning, lokal tidszon, korrekt datum-/scope-propagation samt fungerande mobil- och Maps-flöde. Ingen leverantör ensam får förväxlas med komplett täckning.

MVP-godkännande är en produktbedömning med observerade kärnresor och redovisade gränser, inte enbart grön CI. Kvantitativa prestanda-/täckningsmål och lanseringsdatum är ännu inte fastställda; de får inte fyllas med påhittade tal. Börja med resultat per testfall: relevant färdig dag, korrekt bevarade val och ärligt fel-/osäkerhetstillstånd.

## Handoff Context

- **App:** Parranda.
- **Known user level:** Inte formellt klassificerad. Fritjof driver produktbeslut och följer PR-, staging- och QA-arbete; fråga inte om appnamn eller redan känd kärnresa igen.
- **Platform:** Befintlig mobilanpassad webbapp, svenska/engelska. Accepterad webbläsarbas: Safari 16.4+, Chrome 111+, Firefox 128+. Lokal QA/staging körs på Raspberry Pi; resurser måste beaktas.
- **Budget:** Inte angiven. Begränsade provideranrop och resurssnål QA är önskade; ingen ekonomisk budget antas.
- **Timeline:** Lanseringsdatum och tidsbudget är inte angivna.
- **Mode:** PRD för befintlig produkt, utkast för avstämning. Inte installation av skill, CLI-workflow, teknisk design eller ny implementation.
- **Constraints:** Ingen stads-hackning, inga uppfunna fakta, ingen obligatorisk OpenAI-åtkomst, inga tysta datum/GPS/filter/ruttbyten. Main-merge kräver separat beslut. Gamla arkitekturtexter är bakgrund, inte hinder för aktuell produktavsikt.
- **Decisions:** Rytm styr urval utan kilometerkrav; fri rytm är adaptiv; relevant styrkt tillgänglighet kan väga tyngre än närhet; okända fakta märks; preferenser och användarens stoppbeslut följer med till slutresultatet.
- **Source files:** Användarens `/home/hermes/.hermes/cache/documents/doc_fea8f44568e1_SKILL.md` och `/home/hermes/.hermes/cache/documents/doc_931930127b6b_question-bank_2.md`; `docs/PARRANDA_ENGINE_GOALS.md`; `docs/AGNOSTIC_ENGINE_NORTH_STAR.md`; `manifest.webmanifest`; produktinstruktioner och redovisad QA i denna konversation. Manifestet saknar PRD-path, därför används `docs/PRD-Parranda-MVP.md`. Manifestets Rom-beskrivning är historisk metadata, inte avgränsning av produktens geografi.
- **Evidence boundary:** Tidigare tester och stagingobservationer är bakgrund, inte ett godkännande av denna PRD eller av alla kriterier på senaste integrationen. Kända kalla källfel, ofullständiga rutter och utebliven ersättning försvinner inte genom att kraven skrivs ned.
- **Open questions:** Hur långt får automatisk kandidatupptäckt utvidgas inom respektive geografiskt scope, och hur ska en stor utvidgning kommuniceras? Vilka täcknings-/svarstidsmål och observationer krävs inför publik lansering? Vilken lanseringsmarknad och vilket datum prioriteras? Dessa beslut behövs före motsvarande leveranslöften, men blockerar inte detta utkast.