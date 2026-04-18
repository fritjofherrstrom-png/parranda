const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseLiveEventBlocks,
  scoreLiveEvent,
  resetLiveEventsCache,
} = require("../server/live-events");

test.afterEach(() => {
  resetLiveEventsCache();
});

test("parseLiveEventBlocks plockar ut officiella events från Turismo Roma-html", () => {
  const html = `
    <div class="views-row views-row-1">
      <div class="news_image">
        <div class="field-content">
          <a href="/en/events/village-earth-2026">
            <img src="https://www.turismoroma.it/sites/default/files/village.jpg" />
          </a>
        </div>
      </div>
      <div class="news_info">
        <div class="news_titolo_container">
          <div class="news_titolo">
            <div class="field-content">
              <a href="/en/events/village-earth-2026">Village for the Earth 2026</a>
            </div>
          </div>
        </div>
        <div class="news_date">
          <div class="field-content">
            <span class="date-display-start">from&nbsp;16-04-2026</span>
            <span class="date-display-end">&nbsp;to&nbsp;19-04-2026</span>
          </div>
        </div>
        <div class="news_tipo">
          <div class="field-content"><a href="/en/tipo-evento/events">Events</a></div>
        </div>
        <div class="news_sedi">
          <div class="field-content"><a href="/en/places/villa-borghese">Villa Borghese</a></div>
        </div>
        <div class="news_indirizzo">Viale delle Magnolie</div>
        <div class="news_text">
          <div class="field-content"><p>Big open-air sustainability festival.</p>&nbsp;[...]</div>
        </div>
        <a class="news_button_acquista" href="https://tickets.example.com/earth" target="_blank">
          Buy
        </a>
      </div>
    </div>
  `;

  const events = parseLiveEventBlocks(html);

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Village for the Earth 2026");
  assert.equal(events[0].start_date, "2026-04-16");
  assert.equal(events[0].end_date, "2026-04-19");
  assert.equal(events[0].venue, "Villa Borghese");
  assert.equal(events[0].buy_url, "https://tickets.example.com/earth");
});

test("scoreLiveEvent gynnar optimizer- och preferensmatchande event", () => {
  const wineEvent = {
    title: "Natural Wine Weekender",
    type: "Events",
    venue: "Trimani",
    address: "Via Goito 20",
    summary: "Wine tasting and cellar evenings in Rome.",
    start_date: "2026-04-16",
    end_date: "2026-04-18",
    buy_url: "https://tickets.example.com/wine",
  };
  const sportEvent = {
    title: "City Marathon Expo",
    type: "Sport",
    venue: "EUR",
    address: "Roma",
    summary: "Expo for runners and race fans.",
    start_date: "2026-04-16",
    end_date: "2026-04-30",
    buy_url: null,
  };

  const wineScore = scoreLiveEvent(wineEvent, {
    preferences: ["vin", "mat"],
    optimizerMode: "wine-crawl",
  });
  const sportScore = scoreLiveEvent(sportEvent, {
    preferences: ["vin", "mat"],
    optimizerMode: "wine-crawl",
  });

  assert.ok(wineScore.score > sportScore.score);
  assert.ok(wineScore.tags.includes("vin"));
});
