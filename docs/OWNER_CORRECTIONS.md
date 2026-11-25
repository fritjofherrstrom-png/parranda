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

## Use it (until the owner UI exists)

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
