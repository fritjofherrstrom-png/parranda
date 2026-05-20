const assert = require("node:assert/strict");
const test = require("node:test");

const { getCityPulse } = require("../server/editorial-calendar");

// Regression: the headline used to fall back to `moments[0].note` from
// recurringPulseMoments, which surfaced an evergreen "bind two
// neighborhoods together" line in the JUST NU slot. Replaced by
// season-specific fallbacks (spring / summer / autumn) that don't
// pretend to be real-time signals.

test("Wednesday in May → spring headline (not moments[0].note)", () => {
  const pulse = getCityPulse("2026-05-20", { lang: "sv" });
  assert.match(pulse.headline, /Maj|kvällsläge/i);
  assert.doesNotMatch(
    pulse.headline,
    /binda ihop två kvarter|samma plats hela kvällen/i,
  );
});

test("Wednesday in July → summer headline", () => {
  const pulse = getCityPulse("2026-07-15", { lang: "sv" });
  assert.match(pulse.headline, /Sommaren|skuggan/i);
});

test("Tuesday in October → autumn headline", () => {
  const pulse = getCityPulse("2026-10-13", { lang: "sv" });
  assert.match(pulse.headline, /Höstljuset|promenaden/i);
});

test("Tuesday in February → generic fallback (out of season)", () => {
  const pulse = getCityPulse("2026-02-10", { lang: "sv" });
  assert.match(pulse.headline, /datumgrejer|stadspuls/i);
});

test("Friday still gets the weekend headline (special weekday wins)", () => {
  const pulse = getCityPulse("2026-05-22", { lang: "sv" }); // Friday in May
  assert.match(pulse.headline, /kvartersdrivet|tänka sent/i);
});

test("April 21 still gets Natale headline (special date wins)", () => {
  const pulse = getCityPulse("2026-04-21", { lang: "sv" });
  assert.match(pulse.headline, /historisk puls|stadskärnan/i);
});

test("English May headline mentions Rome", () => {
  const pulse = getCityPulse("2026-05-20", { lang: "en" });
  assert.match(pulse.headline, /May|Rome|evening/i);
});
