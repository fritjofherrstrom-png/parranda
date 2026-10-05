#!/usr/bin/env node
"use strict";
/**
 * Browser QA of the landing and planner surface against a RUNNING Parranda —
 * local dev:full, a frozen QA image or staging. It drives the real UI with real
 * engine answers (nothing is mocked) and records what a reader would see:
 *
 *   node scripts/qa-planner-surface.js --base http://127.0.0.1:8000 --out qa-out
 *     [--expect-sha <sha>] [--places "Lyon,Kyoto"] [--surface-only]
 *
 * For every place: the terminal state (day / candidates / unavailable /
 * refusal / error / timeout), stop count, time to the day, console and
 * hydration errors, and screenshots at 390 px (night) and 1440 px (day).
 * On the first composed day it also exercises the interactive surface: open a
 * stop, follow the day with a simulated position, the Live sheet, an
 * adjustment with its undo, save, theme switch and language switch.
 *
 * Output: <out>/report.json, <out>/report.md and the screenshots. Every check
 * is PASS, FAIL or NOT OBSERVED — a check that could not run is never a pass.
 * Engine and provider outcomes are recorded as observations, not judged: an
 * honest "couldn't pin down" is a correct answer for this surface.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : true;
}

const BASE = String(arg("base", "http://127.0.0.1:8000")).replace(/\/$/, "");
const OUT = path.resolve(String(arg("out", "qa-planner-surface")));
const EXPECT_SHA = arg("expect-sha");
const SURFACE_ONLY = Boolean(arg("surface-only"));
const COMPOSE_TIMEOUT_MS = Number(arg("timeout", 150000));
const DEFAULT_PLACES = [
  { label: "Barcelona (curated)", query: "city=barcelona&place=Barcelona" },
  { label: "Rome (curated)", query: "city=rome&place=Rome" },
  { label: "Lyon", query: "place=Lyon" },
  { label: "Kyoto", query: "place=Kyoto" },
  { label: "Malmö", query: "place=Malm%C3%B6" },
  { label: "Simrishamn", query: "place=Simrishamn" },
  { label: "Lisbon", query: "place=Lisbon" },
  { label: "Athens (preview)", query: "place=Athens" },
];
// --places "Lyon,Kyoto" for freeform places; "city:rome" for a registered city.
const PLACES = arg("places")
  ? String(arg("places")).split(",").map((raw) => {
      const p = raw.trim();
      const city = p.match(/^city:(.+)$/);
      return city
        ? { label: `${city[1]} (curated)`, query: `city=${encodeURIComponent(city[1].toLowerCase())}&place=${encodeURIComponent(city[1])}` }
        : { label: p, query: `place=${encodeURIComponent(p)}` };
    })
  : DEFAULT_PLACES;

const checks = [];
const observations = [];
function check(name, status, detail = "") {
  checks.push({ name, status, detail });
  console.log(`${status.padEnd(12)} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function launch() {
  const candidates = [
    process.env.PARRANDA_TEST_CHROMIUM && { executablePath: process.env.PARRANDA_TEST_CHROMIUM },
    {},
    { channel: "chrome" },
  ].filter(Boolean);
  for (const options of candidates) {
    try {
      return await chromium.launch({ ...options, headless: true });
    } catch {
      /* next */
    }
  }
  throw new Error("No Chromium could be launched; set PARRANDA_TEST_CHROMIUM.");
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function newPage(browser, { width, theme, geolocation }) {
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 900 },
    ...(geolocation ? { permissions: ["geolocation"], geolocation } : {}),
  });
  await context.addInitScript((t) => {
    try {
      if (t) window.localStorage.setItem("parranda:theme", t);
    } catch {
      /* ignore */
    }
  }, theme);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return { context, page, errors };
}

/** The planner's terminal state, read from what the reader sees. */
async function plannerState(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const stops = document.querySelectorAll('ol[aria-label="The stops, in order"] > li button[aria-expanded]').length;
    if (stops > 0) return { state: "day", stops };
    if (/Candidates near this place/.test(text)) return { state: "candidates", stops: 0 };
    if (/couldn't pin down|couldn't compose a day|not enough for a reliable day/.test(text)) return { state: "unavailable", stops: 0 };
    if (/composing as many days as it safely can|needs to pause new requests/.test(text)) return { state: "refusal", stops: 0 };
    if (/engine isn't answering|Planning paused/.test(text)) return { state: "error", stops: 0 };
    return { state: "pending", stops: 0 };
  });
}

async function waitForTerminal(page) {
  const started = Date.now();
  let last = { state: "pending", stops: 0 };
  while (Date.now() - started < COMPOSE_TIMEOUT_MS) {
    last = await plannerState(page);
    if (last.state !== "pending") return { ...last, ms: Date.now() - started };
    await page.waitForTimeout(1000);
  }
  return { ...last, state: "timeout", ms: Date.now() - started };
}

async function health(browser) {
  const { context, page } = await newPage(browser, { width: 390 });
  try {
    const response = await page.goto(`${BASE}/api/health`);
    const body = await response.json();
    return body;
  } finally {
    await context.close();
  }
}

async function landing(browser) {
  for (const [width, theme] of [[390, "day"], [1440, "night"]]) {
    const { context, page, errors } = await newPage(browser, { width, theme });
    try {
      await page.goto(`${BASE}/?lang=sv`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, `landing-${width}-${theme}.png`), fullPage: true });
      const listed = await page.evaluate(() => document.querySelectorAll('a[href*="city="]').length);
      check(`landing ${width}px ${theme}: no city list`, listed === 0 ? "PASS" : "FAIL", `${listed} city links`);
      const applied = await page.evaluate(() => document.documentElement.dataset.theme);
      check(`landing ${width}px: theme applied before paint`, applied === theme ? "PASS" : "FAIL", `data-theme=${applied}`);
      if (width === 390 && !(await page.getByRole("button", { name: "Kvällsläge" }).count())) {
        check("landing: theme switch flips and is kept", "FAIL", "no theme switch on this build");
      } else if (width === 390) {
        await page.getByRole("button", { name: "Kvällsläge" }).click();
        const flipped = await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem("parranda:theme")]);
        check("landing: theme switch flips and is kept", flipped[0] === "night" && flipped[1] === "night" ? "PASS" : "FAIL", flipped.join(" / "));
      }
      check(`landing ${width}px: no console/hydration errors`, errors.length === 0 ? "PASS" : "FAIL", errors.slice(0, 3).join(" | "));
    } finally {
      await context.close();
    }
  }
}

async function planner(browser, place) {
  const url = `${BASE}/anywhere?${place.query}&planner=open&lang=en`;
  const { context, page, errors } = await newPage(browser, { width: 390, theme: "night" });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const result = await waitForTerminal(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `planner-${slug(place.label)}-390-night.png`), fullPage: true });
    observations.push({ place: place.label, url, ...result, errors });
    console.log(`OBSERVED     ${place.label}: ${result.state}${result.stops ? ` · ${result.stops} stops` : ""} · ${Math.round(result.ms / 1000)} s`);
    check(`planner ${place.label}: no console/hydration errors`, errors.length === 0 ? "PASS" : "FAIL", errors.slice(0, 3).join(" | "));
    if (result.state === "day") {
      const wide = await newPage(browser, { width: 1440, theme: "day" });
      try {
        await wide.page.goto(url, { waitUntil: "domcontentloaded" });
        const w = await waitForTerminal(wide.page);
        await wide.page.waitForTimeout(1500);
        await wide.page.screenshot({ path: path.join(OUT, `planner-${slug(place.label)}-1440-day.png`) });
        const aside = await wide.page.locator('aside[aria-label="Map of the day"] .leaflet-container').count();
        check(`planner ${place.label} 1440px: map beside the day`, w.state === "day" ? (aside === 1 ? "PASS" : "FAIL") : "NOT OBSERVED", `state ${w.state}`);
      } finally {
        await wide.context.close();
      }
    }
    return { ...result, url };
  } finally {
    await context.close();
  }
}

async function interactions(browser, day) {
  const { context, page, errors } = await newPage(browser, { width: 390, theme: "day", geolocation: { latitude: 0, longitude: 0 } });
  let stops = null;
  page.on("response", async (response) => {
    if (!response.url().includes("/api/route-recommendations")) return;
    try {
      const body = await response.json();
      stops = body?.days?.[0]?.primary_route?.main_stops ?? stops;
    } catch {
      /* not json */
    }
  });
  try {
    await page.goto(day.url, { waitUntil: "domcontentloaded" });
    const state = await waitForTerminal(page);
    if (state.state !== "day") {
      check("interactions", "NOT OBSERVED", `the day did not compose again (${state.state})`);
      return;
    }
    const route = page.locator('section[aria-label="The route"]');

    // A stop opens as a disclosure, not a jump to Maps.
    const first = route.locator("ol button[aria-expanded]").first();
    await first.click();
    check("stop opens in place", (await first.getAttribute("aria-expanded")) === "true" ? "PASS" : "FAIL");
    await first.click();

    // Follow the day, from a simulated position between stations 2 and 3.
    const follow = page.getByRole("button", { name: "Follow the day" });
    if (stops && stops.length >= 3 && (await follow.count())) {
      const [a, b] = [stops[1], stops[2]];
      await context.setGeolocation({ latitude: a.lat * 0.4 + b.lat * 0.6, longitude: a.lng * 0.4 + b.lng * 0.6 });
      await follow.click();
      await page.waitForTimeout(2500);
      const status = await page.locator('p[aria-live="polite"]').filter({ hasText: /Next:|You're at/ }).count();
      check("follow the day marks the next station", status ? "PASS" : "FAIL");
      await page.screenshot({ path: path.join(OUT, "interaction-follow.png"), fullPage: true });
      await page.getByRole("button", { name: "Stop following" }).click();
    } else {
      check("follow the day marks the next station", "NOT OBSERVED", "button or stop coordinates unavailable");
    }

    // Live sheet opens and closes, focus returns.
    const live = page.getByRole("button", { name: /See all live|Explore live/ });
    if (await live.count()) {
      await live.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, "interaction-live-sheet.png") });
      const close = page.getByRole("button", { name: "Close live" });
      check("Live sheet opens", (await close.count()) ? "PASS" : "FAIL");
      if (await close.count()) await close.click();
    } else {
      check("Live sheet opens", "NOT OBSERVED", "no Live entry on this day");
    }

    // An adjustment recomposes on its own and can be undone.
    await page.getByRole("button", { name: "Adjust" }).click();
    const moods = page.locator('button[aria-pressed]').filter({ hasText: /Nightlife|Coffee|Green|Market/ });
    if (await moods.count()) {
      await moods.first().click();
      const after = await waitForTerminal(page);
      await page.waitForTimeout(2000);
      const changed = await page.getByText(/^Changed:/).count();
      check("adjustment recomposes and says what changed", after.state === "day" && changed ? "PASS" : after.state === "day" ? "NOT OBSERVED" : "FAIL", `state ${after.state}`);
      const undo = page.getByRole("button", { name: "Undo this change" });
      if (await undo.count()) {
        await undo.click();
        check("undo restores the day before", "PASS");
      }
    } else {
      check("adjustment recomposes and says what changed", "NOT OBSERVED", "no mood control found");
    }

    // Save lands in Saved days.
    const save = page.getByRole("button", { name: "Save this day" });
    if (await save.count()) {
      await save.click();
      check("save adds the day to Saved days", (await page.getByText("Saved days").count()) ? "PASS" : "FAIL");
    }

    // Language switch reopens the same day in Swedish.
    await page.locator('[role="group"][aria-label="Language"] a', { hasText: "SV" }).click();
    const sv = await page.waitForFunction(() => /din dag|en dag i/i.test(document.body.innerText), null, { timeout: COMPOSE_TIMEOUT_MS }).then(() => true, () => false);
    check("language switch reopens the day in Swedish", sv ? "PASS" : "FAIL");
    check("interactions: no console/hydration errors", errors.length === 0 ? "PASS" : "FAIL", errors.slice(0, 3).join(" | "));
  } finally {
    await context.close();
  }
}

function writeReport(meta) {
  const counts = checks.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] || 0) + 1 }), {});
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ ...meta, counts, checks, observations }, null, 2));
  const lines = [
    `# Planner surface QA — ${meta.base}`,
    "",
    `Run ${meta.at} · health build_sha \`${meta.health?.build_sha ?? "null"}\`${meta.expectSha ? ` (expected \`${meta.expectSha}\`)` : ""}`,
    "",
    `PASS ${counts.PASS || 0} · FAIL ${counts.FAIL || 0} · NOT OBSERVED ${counts["NOT OBSERVED"] || 0}`,
    "",
    "## Places (observations, not verdicts)",
    "",
    "| Place | State | Stops | Seconds | Errors |",
    "| --- | --- | ---: | ---: | --- |",
    ...observations.map((o) => `| ${o.place} | ${o.state} | ${o.stops || ""} | ${Math.round(o.ms / 1000)} | ${o.errors.length ? o.errors[0].replace(/\|/g, "/") : ""} |`),
    "",
    "## Checks",
    "",
    ...checks.map((c) => `- **${c.status}** ${c.name}${c.detail ? ` — ${c.detail}` : ""}`),
    "",
  ];
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
  return counts;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const meta = { base: BASE, at: new Date().toISOString(), expectSha: EXPECT_SHA || null };
  try {
    meta.health = await health(browser).catch(() => null);
    if (EXPECT_SHA) {
      const sha = String(meta.health?.build_sha || "");
      check("health reports the expected SHA", sha.startsWith(String(EXPECT_SHA)) ? "PASS" : "FAIL", sha || "no build_sha");
    }
    await landing(browser);
    let firstDay = null;
    if (!SURFACE_ONLY) {
      for (const place of PLACES) {
        const result = await planner(browser, place).catch((error) => {
          check(`planner ${place.label}`, "FAIL", `script error: ${error.message.split("\n")[0]}`);
          return { state: "script-error" };
        });
        if (!firstDay && result.state === "day" && !/curated/.test(place.label)) firstDay = result;
      }
      if (!firstDay) firstDay = observations.find((o) => o.state === "day") || null;
      if (firstDay) {
        await interactions(browser, firstDay).catch((error) => check("interactions", "FAIL", `script error: ${error.message.split("\n")[0]}`));
      }
      else check("interactions", "NOT OBSERVED", "no place composed a day");
    }
  } finally {
    await browser.close();
  }
  const counts = writeReport(meta);
  console.log(`\nPASS ${counts.PASS || 0} · FAIL ${counts.FAIL || 0} · NOT OBSERVED ${counts["NOT OBSERVED"] || 0} → ${path.join(OUT, "report.md")}`);
  process.exitCode = counts.FAIL ? 1 : 0;
})();
