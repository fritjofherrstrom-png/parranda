"use strict";

/**
 * Pulse contrast and wrapping on the legacy city shell (index.html +
 * styles.css + script.js, served by the /:city catch-all).
 *
 * The Pulse teaser and edition are themed by several layers of rules, and
 * an earlier fix edited a base rule that later rules override: zero pixels
 * changed. So this check reads what Chromium actually paints, the way the
 * problem was measured: each text's computed colour, alpha-blended over the
 * median background pixel of a screenshot taken with all text hidden
 * (gradients count), must meet WCAG AA, 4.5:1 or 3:1 for large text
 * (>= 24px, or >= 18.66px bold). No text may run past the teaser's or the
 * edition's edge, and the page must not scroll horizontally.
 *
 * /api/* is answered inside the browser from a fixture, so no provider or
 * live network runs: one card per SignalType in server/pulse-engine/types.js
 * plus an unknown type (the chip's base fallback), every timing status
 * against a fixed 12:00 clock, title buttons, actions, venue area headers,
 * expanded cards and the empty state. Weather is missing, as with the
 * default profile, which gives the ambient row its longest lines.
 *
 * Needs Chromium: PARRANDA_TEST_CHROMIUM=<executable>, a Playwright-managed
 * browser (`npx playwright-core install chromium`), or Google Chrome, which
 * GitHub-hosted runners ship. Without one it skips locally and fails in CI.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { once } = require("node:events");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const { buildApp } = require("../server/app");

const typesSource = fs.readFileSync(path.join(__dirname, "..", "server", "pulse-engine", "types.js"), "utf8");
const SIGNAL_TYPES = [
  ...typesSource.match(/@typedef \{\(([\s\S]*?)\)\} SignalType/)[1].matchAll(/"(\w+)"/g),
].map((match) => match[1]);
const UNKNOWN_SIGNAL_TYPE = "unlisted_future_type";
const TIMING_STATUSES = ["live", "upcoming", "timeless", "later", "past"];

const FIXTURE_DATE = "2026-09-26";
// 12:00 in Barcelona and Rome, 13:00 in Athens; every status is reached in both.
const FIXED_NOW = new Date(`${FIXTURE_DATE}T10:00:00Z`);
const STATUS_WINDOWS = {
  live: ["11:00", "14:00"],
  upcoming: ["13:30", "15:00"],
  timeless: null,
  later: ["19:00", "21:00"],
  past: ["09:00", "10:30"],
};

const SHELLS = [
  { city: "barcelona", width: 320 },
  { city: "barcelona", width: 390 },
  { city: "barcelona", width: 1280 },
  // Other cities override --accent / --accent-deep.
  { city: "rome", width: 390 },
  { city: "athens", width: 390 },
];

const CHROMIUM_LAUNCHES = [
  process.env.PARRANDA_TEST_CHROMIUM && { executablePath: process.env.PARRANDA_TEST_CHROMIUM },
  {},
  { channel: "chrome" },
].filter(Boolean);

const HIDE_TEXT_CSS =
  "*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }";
const NO_MOTION_CSS =
  "*, *::before, *::after { transition: none !important; animation: none !important; }";

function fixtureSignals() {
  return [...SIGNAL_TYPES, UNKNOWN_SIGNAL_TYPE].map((type, index) => {
    const status = TIMING_STATUSES[index % TIMING_STATUSES.length];
    const hours = STATUS_WINDOWS[status];
    const label = type.replace(/_/g, " ");
    const signal = {
      id: `fixture-${type}`,
      type,
      // Venue cards also show under "Ikväll", so past cards get drawn too.
      level: status === "past" ? "venue" : ["city", "neighborhood", "venue"][index % 3],
      title: `Signal: ${label}`,
      signal_label: label,
      kind: "Stadspuls",
      // No clock or time-of-day words outside `when`: timeless stays timeless.
      when: hours ? `${hours[0]}–${hours[1]}` : "I dag",
      where: "Stortorget",
      area: "old-town",
      area_label: "Gamla stan",
      reason: "En mindre radie gör de närmaste timmarna mer avsiktliga.",
      blurb: "Håll planen flexibel och läs av gatan innan du bestämmer nästa stopp.",
      why_it_matters: "Det ger dagen en tydligare riktning.",
      source: { kind: "computed", label: "stadens lokala tid" },
      trust_level: "verified",
      matches_vibes: ["buzzy", "romantic", "slow", "curious"],
    };
    if (hours) {
      signal.starts_at_local = `${FIXTURE_DATE}T${hours[0]}:00`;
      signal.ends_at_local = `${FIXTURE_DATE}T${hours[1]}:00`;
    }
    if (index % 2 === 0) {
      // Title button, ghost "Öppna plats" and primary "Bygg dag av detta".
      signal.place_query = "Stortorget";
      signal.linked_wildcard_id = "fixture-wildcard";
    }
    if (type === "live_event_nearby") {
      signal.official_event_id = "fixture-event";
      signal.source = { kind: "live_feed", label: "Official Agenda", url: "https://example.test/event" };
      signal.trust_level = "official";
    }
    return signal;
  });
}

function cityPulseFixture(city, { empty = false } = {}) {
  return {
    city,
    date: FIXTURE_DATE,
    weekday_label: "Lördag",
    date_label: "26 september 2026",
    headline: "Staden går in i kvällsläge",
    subhead: "Stadens lokala kvällsfönster är rättare läge för att tajta rutten runt mat, barer eller en stämningsfull promenad.",
    masthead: {
      headline: "Staden går in i kvällsläge",
      subhead: "Stadens lokala kvällsfönster är rättare läge för att tajta rutten runt mat, barer eller en stämningsfull promenad.",
      source: "signal",
    },
    footer_note: "Den här sektionen blandar säkra lokala rytmer med det som är värt att väga in just nu.",
    items: [],
    moments: [],
    signals: empty ? [] : fixtureSignals(),
    official_events: [
      { id: "fixture-event", title: "Signal: live event nearby", venue: "Stortorget", date: FIXTURE_DATE, start_time: "19:00" },
    ],
    wildcards: [
      { id: "fixture-wildcard", title: "En kväll i gamla stan", label: "Wildcard", summary: "Fixture", preferences: ["mat"] },
    ],
    weather: null,
    source_status_summary: { text: "Livekällor: Official Agenda failed" },
  };
}

// --- screenshot pixels --------------------------------------------------

function decodePng(buffer) {
  let width = 0;
  let height = 0;
  let channels = 0;
  const data = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      assert.equal(chunk[8], 8, "screenshot PNG must be 8-bit");
      assert.equal(chunk[12], 0, "screenshot PNG must not be interlaced");
      channels = { 2: 3, 6: 4 }[chunk[9]];
      assert.ok(channels, `unsupported PNG colour type ${chunk[9]}`);
    } else if (type === "IDAT") {
      data.push(chunk);
    }
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toUpLeft = Math.abs(estimate - upLeft);
        predictor = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
      }
      line[x] = (line[x] + predictor) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      pixels.set(line.subarray(x * channels, x * channels + 3), (y * width + x) * 4);
    }
    previous = line;
  }
  return { width, height, pixels };
}

function parseColor(value) {
  const legacy = value.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (legacy) return { rgb: legacy.slice(1, 4).map(Number), alpha: legacy[4] === undefined ? 1 : Number(legacy[4]) };
  const srgb = value.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/);
  if (srgb) return { rgb: srgb.slice(1, 4).map((part) => Number(part) * 255), alpha: srgb[4] === undefined ? 1 : Number(srgb[4]) };
  return null;
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(first, second) {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// Per-channel median of the pixels under a text's line boxes.
function medianBackground(image, rects) {
  const histograms = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let count = 0;
  for (const [left, top, right, bottom] of rects) {
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(image.height, Math.ceil(bottom)); y += 1) {
      for (let x = Math.max(0, Math.floor(left)); x < Math.min(image.width, Math.ceil(right)); x += 1) {
        const offset = (y * image.width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) histograms[channel][image.pixels[offset + channel]] += 1;
        count += 1;
      }
    }
  }
  return histograms.map((histogram) => {
    let seen = 0;
    for (let value = 0; value < 256; value += 1) {
      seen += histogram[value];
      if (seen * 2 > count) return value;
    }
    return 255;
  });
}

// Runs in the page: every visible text node under the roots, grouped by its
// element, with line boxes relative to the root; plus clipping and scroll.
function collectTexts(rootSelectors) {
  const describe = (element) =>
    element.tagName.toLowerCase() +
    (element.id ? `#${element.id}` : "") +
    [...element.classList].map((name) => `.${name}`).join("");
  const texts = [];
  const clipped = [];
  for (const selector of rootSelectors) {
    const root = document.querySelector(selector);
    const box = root.getBoundingClientRect();
    const byElement = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const content = node.data.replace(/\s+/g, " ").trim();
      if (!content) continue;
      const element = node.parentElement;
      const style = getComputedStyle(element);
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      if (!rects.length || style.visibility !== "visible") continue;
      let opacity = 1;
      for (let cursor = element; cursor; cursor = cursor.parentElement) {
        opacity *= Number(getComputedStyle(cursor).opacity);
      }
      if (!opacity) continue;
      for (const rect of rects) {
        if (rect.left < box.left - 0.5 || rect.right > box.right + 0.5) {
          clipped.push(
            `${describe(element)} "${content.slice(0, 60)}" spans x ${Math.round(rect.left)}-${Math.round(rect.right)}, ` +
              `${selector} spans ${Math.round(box.left)}-${Math.round(box.right)}`,
          );
        }
      }
      const entry = byElement.get(element) || {
        root: selector,
        element: describe(element),
        text: "",
        color: style.color,
        fontSize: parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight),
        opacity,
        rects: [],
      };
      entry.text = `${entry.text} ${content}`.trim();
      entry.rects.push(
        ...rects.map((rect) => [rect.left - box.left, rect.top - box.top, rect.right - box.left, rect.bottom - box.top]),
      );
      byElement.set(element, entry);
    }
    texts.push(...byElement.values());
  }
  const scroller = document.scrollingElement;
  return { texts, clipped, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth };
}

async function audit(page, state, rootSelectors, report) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur());
  const { texts, clipped, scrollWidth, clientWidth } = await page.evaluate(collectTexts, rootSelectors);
  report.clipped.push(...clipped.map((line) => `${state}: ${line}`));
  if (scrollWidth > clientWidth) {
    report.clipped.push(`${state}: the page scrolls horizontally (${scrollWidth}px content in ${clientWidth}px)`);
  }
  const hideText = await page.addStyleTag({ content: HIDE_TEXT_CSS });
  const images = {};
  for (const selector of rootSelectors) {
    images[selector] = decodePng(await page.locator(selector).screenshot({ animations: "disabled" }));
  }
  await hideText.evaluate((node) => node.remove());

  for (const entry of texts) {
    const background = medianBackground(images[entry.root], entry.rects);
    const parsed = parseColor(entry.color);
    const large = entry.fontSize >= 24 || (entry.fontSize >= 18.66 && entry.fontWeight >= 700);
    const required = large ? 3 : 4.5;
    const where = `${state}: ${entry.element} "${entry.text.slice(0, 60)}"`;
    if (!parsed) {
      report.failures.push(`${where} has a colour this check cannot read: ${entry.color}`);
      continue;
    }
    const alpha = parsed.alpha * entry.opacity;
    const painted = parsed.rgb.map((value, channel) => value * alpha + background[channel] * (1 - alpha));
    const ratio = contrastRatio(painted, background);
    report.measured += 1;
    if (ratio < required) {
      report.failures.push(
        `${where} is ${ratio.toFixed(2)}:1, needs ${required}:1 (${entry.color} over rgb(${background.join(", ")}))`,
      );
    }
  }

  const rendered = await page.evaluate(() => ({
    chips: [...document.querySelectorAll("#cityPulseStart .pulse-entry-signal")].map((chip) =>
      chip.className.replace(/.*\bpulse-entry-signal-(\S+).*/, "$1"),
    ),
    statuses: [...document.querySelectorAll("#cityPulseStart .pulse-entry-when")].map((when) =>
      when.className.replace(/.*\bpulse-entry-when-(\S+).*/, "$1"),
    ),
  }));
  rendered.chips.forEach((chip) => report.chips.add(chip));
  rendered.statuses.forEach((status) => report.statuses.add(status));
}

function newReport() {
  return { measured: 0, failures: [], clipped: [], chips: new Set(), statuses: new Set() };
}

function assertReadable(report, minimumTexts) {
  const problems = [
    ...(report.failures.length ? ["Pulse text below WCAG AA contrast:", ...report.failures] : []),
    ...(report.clipped.length ? ["Pulse text running past its container:", ...report.clipped] : []),
  ];
  assert.equal(problems.length, 0, problems.join("\n"));
  assert.ok(report.measured >= minimumTexts, `expected at least ${minimumTexts} measured texts, got ${report.measured}`);
}

// --- browser + server ---------------------------------------------------

let runtime;

function startRuntime() {
  runtime ??= (async () => {
    let chromium;
    try {
      ({ chromium } = require("playwright-core"));
    } catch (error) {
      return { unavailable: `playwright-core is not installed (${error.code || error.message})` };
    }
    const errors = [];
    let browser = null;
    for (const options of CHROMIUM_LAUNCHES) {
      try {
        browser = await chromium.launch(options);
        break;
      } catch (error) {
        errors.push(`${JSON.stringify(options)}: ${error.message.split("\n")[0]}`);
      }
    }
    if (!browser) return { unavailable: `no Chromium could be launched (${errors.join("; ")})` };
    const server = buildApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    return { browser, server, origin: `http://127.0.0.1:${server.address().port}` };
  })();
  return runtime;
}

test.after(async () => {
  const current = await runtime;
  await current?.browser?.close();
  if (current?.server) {
    current.server.closeAllConnections();
    await new Promise((resolve) => current.server.close(resolve));
  }
});

async function openRuntime(t) {
  const current = await startRuntime();
  if (!current.unavailable) return current;
  // CI must never lose this check silently.
  assert.ok(!process.env.CI, `the Pulse contrast check needs Chromium in CI: ${current.unavailable}`);
  t.skip(
    `${current.unavailable}; install Google Chrome, run \`npx playwright-core install chromium\`, or set PARRANDA_TEST_CHROMIUM`,
  );
  return null;
}

async function openPulse({ browser, origin }, { city, width, empty = false }) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/city-pulse") return route.fulfill({ json: cityPulseFixture(city, { empty }) });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "not part of this check" } });
    return route.continue();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto(`${origin}/${city}?lang=sv`);
  await page.addStyleTag({ content: NO_MOTION_CSS });
  await page.locator("#cityPulseTeaserButton").click();
  await page.locator("#cityPulseStart .pulse-entry").first().waitFor();
  return { context, page, pageErrors };
}

for (const shell of SHELLS) {
  test(`Pulse teaser and edition on /${shell.city} at ${shell.width}px meet WCAG AA and keep text inside`, { timeout: 120_000 }, async (t) => {
    const current = await openRuntime(t);
    if (!current) return;
    const { context, page, pageErrors } = await openPulse(current, shell);
    try {
      const report = newReport();
      await audit(page, "pre-plan teaser + Just nu", ["#cityPulseTeaser", "#cityPulseStart"], report);

      await page.locator("#cityPulseTimeFilters button", { hasText: "Ikväll" }).click();
      for (const toggle of await page.locator("#cityPulseStart .pulse-entry-expand-toggle").all()) {
        await toggle.click();
      }
      await audit(page, "Ikväll, cards expanded", ["#cityPulseStart"], report);

      // The classes renderCityPulseTeaser() sets once a day is planned.
      await page.evaluate(() => {
        const teaser = document.querySelector("#cityPulseTeaser");
        teaser.classList.remove("is-route-context", "is-pre-plan");
        teaser.classList.add("is-day-handoff");
      });
      await audit(page, "planned-day teaser", ["#cityPulseTeaser"], report);

      assert.deepEqual(pageErrors, [], "the city shell threw while rendering the fixture");
      assertReadable(report, 100);
      assert.deepEqual(
        [...SIGNAL_TYPES, UNKNOWN_SIGNAL_TYPE].filter((type) => !report.chips.has(type)),
        [],
        "every signal type must render (and so be measured) as a chip",
      );
      assert.deepEqual(
        TIMING_STATUSES.filter((status) => !report.statuses.has(status)),
        [],
        "every timing status must render (and so be measured)",
      );
    } finally {
      await context.close();
    }
  });
}

test("the Pulse empty state keeps its dark surface (/barcelona at 390px)", { timeout: 120_000 }, async (t) => {
  const current = await openRuntime(t);
  if (!current) return;
  // No signals: the client falls back to one timeless card, which "Ikväll" hides.
  const { context, page, pageErrors } = await openPulse(current, { city: "barcelona", width: 390, empty: true });
  try {
    await page.locator("#cityPulseTimeFilters button", { hasText: "Ikväll" }).click();
    await page.locator("#cityPulseStart .pulse-empty-state").waitFor();
    const report = newReport();
    await audit(page, "empty state", ["#cityPulseStart"], report);
    assert.deepEqual(pageErrors, [], "the city shell threw while rendering the fixture");
    assertReadable(report, 20);
  } finally {
    await context.close();
  }
});
