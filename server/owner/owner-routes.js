"use strict";

/**
 * HTTP surface for the owner's corrections and the public "report a problem".
 *
 *   GET  /owner                               sign-in page
 *   GET  /api/owner/session                   { owner: true|false }
 *   POST /api/owner/session                   { key } → session cookie
 *   POST /api/owner/session/end               sign out
 *   GET  /api/owner/corrections               active corrections        (owner)
 *   POST /api/owner/corrections               add one                   (owner)
 *   POST /api/owner/corrections/:id/revoke    undo one                  (owner)
 *   GET  /api/owner/reports                   open reports, grouped     (owner)
 *   POST /api/owner/reports/resolve           dismiss a group           (owner)
 *   POST /api/place-reports                   anyone: report a problem
 *
 * Nothing here exists unless the owner key and the corrections directory are
 * both set: every route then falls through to the app's own 404. The limits
 * here are always on, unlike the share-profile guard: sign-in tries are a
 * secret's defence, not a politeness budget.
 */

const express = require("express");
const { createFixedWindowLimiter, clientKey, guardSettings } = require("../lib/public-access-guard");
const { isSameOrigin } = require("./owner-auth");
const { KINDS } = require("./place-reports");

const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
const SIGN_IN_MAX = 5;
const REPORT_WINDOW_MS = 60 * 60 * 1000;
const REPORT_MAX = 10;
// The same answer for a stored report, a rate-limited one, a honeypot hit and
// a full day: a spammer learns nothing from it.
const RECEIVED = Object.freeze({ status: "received" });

const OWNER_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Parranda · owner</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1.25rem; color: #1d1b18; background: #faf8f4; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  label { display: block; font-weight: 600; margin-bottom: .25rem; }
  input { width: 100%; box-sizing: border-box; font: inherit; padding: .6rem .7rem; border: 1px solid #c9c3b8; border-radius: .5rem; }
  button { margin-top: .75rem; font: inherit; padding: .55rem 1rem; border: 0; border-radius: .5rem; background: #1d1b18; color: #faf8f4; cursor: pointer; }
  p { margin: .5rem 0; } .muted { color: #6b645a; } [hidden] { display: none; }
</style>
</head>
<body>
<h1>Parranda · owner</h1>
<form id="sign-in" hidden>
  <label for="key">Owner key</label>
  <input id="key" name="key" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
  <p id="sign-in-error" class="muted" role="alert"></p>
</form>
<section id="signed-in" hidden>
  <p>Signed in as the owner on this device for 30 days.</p>
  <p class="muted" id="counts"></p>
  <p><a href="/anywhere">Open Parranda</a></p>
  <button id="sign-out" type="button">Sign out</button>
</section>
<script src="/owner/owner.js"></script>
</body>
</html>
`;

const OWNER_SCRIPT = `"use strict";
const $ = id => document.getElementById(id);
const post = (path, body) => fetch(path, { method: "POST", credentials: "same-origin",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
async function show() {
  const session = await fetch("/api/owner/session", { credentials: "same-origin" }).then(r => r.json());
  $("sign-in").hidden = session.owner;
  $("signed-in").hidden = !session.owner;
  if (!session.owner) { $("key").focus(); return; }
  const [corrections, reports] = await Promise.all([
    fetch("/api/owner/corrections", { credentials: "same-origin" }).then(r => r.json()),
    fetch("/api/owner/reports", { credentials: "same-origin" }).then(r => r.json()),
  ]);
  const open = (reports.queue || []).reduce((sum, group) => sum + group.count, 0);
  $("counts").textContent = (corrections.corrections || []).length + " active correction(s) · " + open + " open report(s)";
}
$("sign-in").addEventListener("submit", async event => {
  event.preventDefault();
  $("sign-in-error").textContent = "";
  const reply = await post("/api/owner/session", { key: $("key").value });
  $("key").value = "";
  if (reply.ok) return show();
  $("sign-in-error").textContent = reply.status === 429 ? "Too many tries. Wait a while and try again." : "That key is not right.";
});
$("sign-out").addEventListener("click", async () => { await post("/api/owner/session/end"); show(); });
show();
`;

function createOwnerRoutes({ auth, corrections, reports, env = process.env, now = () => Date.now(), logger = console } = {}) {
  const router = express.Router();
  if (!auth || !corrections) return router; // no owner: every path falls through to 404

  const settings = guardSettings(env);
  const identity = { mode: settings.identityMode, trustedHops: settings.trustedHops };
  const signInLimiter = createFixedWindowLimiter({ windowMs: SIGN_IN_WINDOW_MS, max: SIGN_IN_MAX, now });
  const reportLimiter = createFixedWindowLimiter({ windowMs: REPORT_WINDOW_MS, max: REPORT_MAX, now });

  const noStore = (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  };
  const sameOrigin = (request, response, next) => {
    if (!isSameOrigin(request)) return response.status(403).json({ error: "cross_origin" });
    next();
  };
  const ownerOnly = (request, response, next) => {
    if (!auth.isOwner(request)) return response.status(401).json({ error: "not_signed_in" });
    next();
  };
  const refused = (response, error) => {
    if (error?.reason) return response.status(400).json({ error: error.reason });
    logger?.error?.(`[owner] ${error?.message || error}`);
    return response.status(500).json({ error: "write_failed" });
  };

  router.get("/owner", noStore, (_request, response) => {
    response
      .set("Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; " +
        "form-action 'none'; frame-ancestors 'none'; base-uri 'none'")
      .set("X-Frame-Options", "DENY")
      .set("Referrer-Policy", "no-referrer")
      .type("html")
      .send(OWNER_PAGE);
  });
  router.get("/owner/owner.js", noStore, (_request, response) => {
    response.type("application/javascript").send(OWNER_SCRIPT);
  });

  router.get("/api/owner/session", noStore, (request, response) => {
    const owner = auth.isOwner(request);
    if (owner) auth.renew(request, response);
    response.json({ owner });
  });

  router.post("/api/owner/session", noStore, sameOrigin, (request, response) => {
    const verdict = signInLimiter.check(clientKey(request, identity));
    if (!verdict.allowed) {
      return response.status(429).set("Retry-After", String(verdict.retryAfterSec))
        .json({ error: "rate_limited", retry_after_seconds: verdict.retryAfterSec });
    }
    if (!auth.verifyKey(request.body?.key)) return response.status(401).json({ error: "wrong_key" });
    auth.signIn(request, response);
    response.json({ owner: true });
  });

  router.post("/api/owner/session/end", noStore, sameOrigin, (request, response) => {
    auth.signOut(request, response);
    response.json({ owner: false });
  });

  router.get("/api/owner/corrections", noStore, ownerOnly, (_request, response) => {
    response.json({ corrections: corrections.list(), skipped_lines: corrections.skippedLines() });
  });

  router.post("/api/owner/corrections", noStore, sameOrigin, ownerOnly, (request, response) => {
    const body = request.body || {};
    let correction;
    try {
      correction = corrections.append({
        event: "add", action: body.action, target: body.target, value: body.value ?? null, reason: body.reason,
      });
    } catch (error) {
      return refused(response, error);
    }
    // "Make it a correction" from the queue closes the reports it answers.
    let resolvedReports = 0;
    const from = body.from_report;
    if (reports && from && typeof from === "object" && KINDS.includes(from.kind)) {
      try {
        resolvedReports = reports.resolveGroup({ targetId: correction.target.id, kind: from.kind,
          resolution: "corrected", correctionId: correction.id });
      } catch (error) {
        if (error?.reason !== "unknown_group") logger?.error?.(`[owner] ${error?.message || error}`);
      }
    }
    response.status(201).json({ correction, resolved_reports: resolvedReports });
  });

  router.post("/api/owner/corrections/:id/revoke", noStore, sameOrigin, ownerOnly, (request, response) => {
    try {
      const reason = request.body?.reason;
      const event = corrections.append({ event: "revoke", id: request.params.id, ...(reason ? { reason } : {}) });
      response.json({ revoked: event });
    } catch (error) {
      if (error?.reason === "unknown_correction") return response.status(404).json({ error: error.reason });
      refused(response, error);
    }
  });

  if (reports) {
    router.get("/api/owner/reports", noStore, ownerOnly, (_request, response) => {
      response.json({ queue: reports.queue(), skipped_lines: reports.skippedLines() });
    });

    router.post("/api/owner/reports/resolve", noStore, sameOrigin, ownerOnly, (request, response) => {
      const body = request.body || {};
      if (body.resolution !== "dismissed") return response.status(400).json({ error: "unknown_resolution" });
      try {
        const resolved = reports.resolveGroup({ targetId: body.target_id, kind: body.kind, resolution: "dismissed" });
        response.json({ resolved });
      } catch (error) {
        if (error?.reason === "unknown_group") return response.status(404).json({ error: error.reason });
        refused(response, error);
      }
    });

    router.post("/api/place-reports", noStore, (request, response) => {
      const body = request.body || {};
      // A hidden field people never see; simple bots fill every field.
      if (typeof body.website === "string" && body.website.trim()) return response.status(202).json(RECEIVED);
      if (!reportLimiter.check(clientKey(request, identity)).allowed) return response.status(202).json(RECEIVED);
      try {
        reports.submit({ target: body.target, kind: body.kind, comment: body.comment, hours: body.hours });
      } catch (error) {
        return refused(response, error);
      }
      response.status(202).json(RECEIVED);
    });
  }

  return router;
}

module.exports = { createOwnerRoutes, SIGN_IN_MAX, REPORT_MAX };
