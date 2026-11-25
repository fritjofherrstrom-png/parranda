# Owner corrections

Durable, global fixes to places the sources got wrong. The sources are never
edited: corrections live in their own append-only log and are laid over the
loader's records on every request, after any cache.

## Turn it on

Set `PARRANDA_CORRECTIONS_DIR` to a directory on persistent disk, the same for
web and worker. Keep it **outside** `PARRANDA_CACHE_DIR`: caches get flushed,
corrections must not. Without the variable nothing changes.

The server re-reads `corrections.jsonl` when it changes (checked at most once a
second). No restart or cache flush is needed.

## Sign in as the owner

Make a key once and put its hash in the server's environment (web and worker):

```bash
node scripts/owner-key.js
```

It prints the key (keep it in a password manager; it is shown once) and a
`PARRANDA_OWNER_KEY_HASH=scrypt$…` line. The server only holds the hash. Then
open `/owner`, paste the key, and the device stays signed in for 30 days
(renewed while in use). A new key signs every session out.

Without `PARRANDA_OWNER_KEY_HASH` *and* `PARRANDA_CORRECTIONS_DIR`, `/owner`,
`/api/owner/*` and `/api/place-reports` are plain 404s.

Guards, always on (not only in the share profile):

- the cookie is HttpOnly, SameSite=Strict, and Secure on anything but
  plain-http localhost;
- every write needs that cookie and an `Origin` from this same site;
- 5 sign-in tries per 15 minutes per client. Behind a tunnel, set
  `PARRANDA_PUBLIC_CLIENT_IDENTITY=cloudflare` (or `xff` with
  `PARRANDA_TRUST_PROXY_HOPS`), or every visitor shares one budget.

## The owner API

| Route | |
|---|---|
| `GET /api/owner/session` | `{ owner: true \| false }` |
| `POST /api/owner/session` `{ key }` | sign in |
| `POST /api/owner/session/end` | sign out |
| `GET /api/owner/corrections` | active corrections |
| `POST /api/owner/corrections` `{ action, target, value, reason, from_report? }` | add one; with `from_report: { kind }` it also closes those reports |
| `POST /api/owner/corrections/:id/revoke` `{ reason? }` | undo one |
| `GET /api/owner/reports` | open reports, grouped by place and kind, most reported first |
| `POST /api/owner/reports/resolve` `{ target_id, kind, resolution: "dismissed" }` | dismiss a group |

## Reports from anyone

`POST /api/place-reports` with `{ target: { id, label?, source? }, kind,
comment?, hours? }`, where `kind` is `closed`, `wrong_type`, `wrong_hours`,
`wrong_location` or `other`. A report never changes a day; it waits in
`reports.jsonl` (beside the corrections) for the owner.

- No account, name or address is stored; the comment (280 characters) is shown
  only to the owner, as text.
- The answer is always `202 { status: "received" }`: for a stored report, the
  eleventh in an hour from one client, a filled honeypot field (`website`), and
  past 500 reports in a day. Only malformed input gets a 400.

## Use it from the host

```bash
node scripts/owner-correction.js hide overture-537a9f68-f791-4e64-9b01-5b66db7aab08 \
  --reason "Property manager, not a second-hand shop" --label "Flat Service" --source overture
node scripts/owner-correction.js retype osm-node-123 --osm shop=antiques --reason "An antiques shop, not a museum"
node scripts/owner-correction.js list
node scripts/owner-correction.js revoke c_48361dc05246 --reason "Was right after all"
```

The place id is the stop's `id` in `/api/route-recommendations` (the same id
"Remove" uses). `retype` accepts any plain `key=value` row of `OSM_TAG_MAP`. A
place that is not somewhere to visit at all is hidden, not re-typed.

## What it covers

- Every path that reads the app's open-data loader: the day, the candidate
  panel, inspect sidecars, Blitz and the registered-city fill. Late rows from
  background sources pass the same corrections.
- Not yet: the built-in city catalogs (fix those in the repo), event venues,
  opening-hour corrections, and days that were already published.

Nothing is deleted. Undoing a correction appends a `revoke` event.
