# Local OpenStreetMap read path

Status: draft, off by default. Nothing changes unless `PARRANDA_OSM_EXTRACT_DIR` is set.

## Why
The public Overpass endpoint is the only source of OpenStreetMap places today. On 14 and 15 Nov 2026 it held small queries for about 30 seconds or answered 502 at capacity, so days were built without map evidence and without opening hours. Its own notice says automated use should run its own instance. A regional extract on disk answers the same question in milliseconds.

## How it works
1. `scripts/build-osm-extract.js` reads a regional `.osm.pbf` and the extract's boundary file (`.poly`) from disk. It keeps named elements that match `OSM_TAG_MAP` and writes them as tile files plus a manifest. It downloads nothing.
2. `server/place-candidates/osm-extract-store.js` reads those tiles. It answers the grouped question the loader would send to Overpass: the same selectors per category, the same group size, nodes before ways before relations.
3. `createOpenDataLoader({ localSource })` asks the store first. An answer goes through the same mapping, balancing and attestation as an Overpass answer. No provider is asked for that query.

The store answers only when all of these hold. Otherwise the loader asks Overpass exactly as before.
- **Coverage:** every asked circle lies wholly inside one area of the extract's boundary. The centre is inside the outer ring and outside every hole, and no edge of the ring or of any hole comes within the radius (plus 1% and 25 m). A circle across two adjacent areas is refused.
- **Age:** the snapshot is at most 30 days old (`PARRANDA_OSM_EXTRACT_MAX_AGE_DAYS`). Where several regions cover a place, the newest wins.
- **Integrity:** every tile it needs is either absent from the manifest's inventory (an area without places) or present with the listed element count and SHA-256. A listed tile that is missing, unreadable or different refuses the answer.

## The snapshot's data time
The builder reads the data time from the file itself: the replication timestamp in the PBF header block (`osmosis_replication_timestamp`, see the [osmium fileinfo documentation](https://docs.osmcode.org/osmium/latest/osmium-fileinfo.html)). Geofabrik extracts carry it. The build time is recorded apart as `built_at`, and the file's modification time is not used.
- A file without that header is refused, unless the operator states the time with `--data-timestamp`. The manifest then records `data_timestamp_source: "operator"`.
- A stated time that disagrees with the header is refused.

## How a day says so
A day whose kept map records came from an extract carries `source_status.collection.map_snapshot`:
```json
{ "extracts": [{ "region": "slovenia", "data_timestamp": "2026-11-14T21:20:41.000Z" }], "includes_live_answer": false }
```
- `extracts` lists every extract whose records the day keeps, oldest first. It is built from the records kept after the first and wider passes are merged, not from the first pass.
- `includes_live_answer` is true when kept records also came from a live Overpass answer.
- The field is `null` when no kept record came from an extract.
- A label that is present but cannot be read in full is published as `{ "unreadable": true }`, which a shared day refuses. It is never shortened to "no snapshot".

## Replays obey the age limit
A cached answer that was read from an extract is replayed only while the configured store would still answer from that snapshot. This holds for the request cache (memory and disk, so also after a restart), its outage fallback, the cache-only read, the neighbouring-budget read and the previous-contract fallback. A server without the extract configured does not replay such an answer.

## Build and replace a region
```bash
node scripts/build-osm-extract.js --pbf slovenia.osm.pbf --poly slovenia.poly \
  --region slovenia --out /path/to/osm-extracts
```
Start the server with `PARRANDA_OSM_EXTRACT_DIR=/path/to/osm-extracts`. Several regions can sit side by side.

Operating contract:
- A region directory is immutable while a server reads it.
- A rebuild writes the new region beside the old one and swaps it in with one rename.
- Restart the server after a rebuild. A server still holding the old manifest refuses any tile from the new build, because its hash does not match, and asks Overpass instead. It never mixes the two builds.

Measured for Slovenia on a laptop (17 Nov 2026): 314 MB extract, 13 s build, 2.3 GB peak memory, 8,178 places in 865 tiles, 4.8 MB on disk. The loader answered Ljubljana in 30 ms and Piran in 3 ms.

Measured for Sweden on the same laptop (22 Nov 2026): 1.0 GB extract (data time 2026-11-21T21:20:51Z), 46 s build with `--memory-limit 6GB`, 41,199 places in 7,956 tiles, 38 MB on disk. DuckDB spilled about 1.5 GB of temporary files beside the output during that build.

The spill came from DuckDB putting the whole file on the hash side of the way and node joins, because it cannot estimate `st_readosm`. Since 24 Nov the builder reads only the ways and nodes the picked places need through semi-joins whose hash side is that short list, with DuckDB's build/probe swap turned off. On Denmark (0.5 GB, `--memory-limit 512MB`) peak temporary space went from 1.3 GB to 0 and the build from 22 s to 13 s, with element-for-element the same store. Tiles are now written sorted, so the same extract gives the same hashes. The extract can be deleted after the build; the server reads only the store.

## Refresh every region before it ages out
A store older than 30 days is not used, and the day falls back to Overpass. Rebuild all regions well inside that window:
```bash
node scripts/refresh-osm-extracts.js --out /path/to/osm-extracts --work /path/to/downloads
```
- `REGIONS` in the script lists the held regions: Sweden, Denmark, Norway, the Netherlands, the United Kingdom, Portugal, Spain, Italy, Slovenia, and the Geofabrik sub-regions Île-de-France, Rhône-Alpes and Berlin. `--regions a,b` rebuilds only those.
- It works one region at a time: download the Geofabrik extract and boundary file into an attempt-owned directory, check the extract against Geofabrik's MD5, build into separate staging, delete the extract, then check the staged store (totals agree with the tile inventory, every listed tile is on disk with its hash). Only a valid store replaces the held generation. It prints one JSON line per region and exits non-zero if any region was not rebuilt.
- Disk: a region is skipped unless free space covers the extract, half its size again as headroom for DuckDB's temporary files, and the floor (`--min-free-gb`, default 2.5). A running build is stopped when free space falls below the floor. A failed or stopped build leaves the old store in place.
- Run it on a machine with room, against an **offline output generation**, never the directory a running server is reading. Copy finished region directories into a new immutable server-side generation, then switch the configured root and restart using the guarded release procedure; do not overwrite an active region in place. The server itself only reads.
- Interrupted builders and invalid new stores leave the held region untouched; a failed final rename restores the previous region. If the refresh process itself is killed between final renames, a complete previous generation can remain at `.<region>.refresh-*.previous`. Keep that recovery directory: inspect/recover it while offline rather than deleting it as temporary build data. A failed backup cleanup is reported as `cleanup_warning` after an otherwise verified replacement.

## Differences from an Overpass answer
- **Age.** The data is as old as the extract. Geofabrik rebuilds extracts once a day.
- **Unnamed elements.** Overpass counts them toward a group's size before the mapper drops them. The store holds named places only, so a group can carry more usable places.
- **Centre of an area.** A way or relation sits at the middle of its bounding box, as with `out center`. A relation uses its member ways only.
- **Edges.** A place whose circle comes near the extract's boundary is not answered locally.

## Not done
- **Showing the label.** The label is in the response and the shared day, not in the interface.
- **Scheduled refresh.** `scripts/refresh-osm-extracts.js` rebuilds the stores, but nothing runs it on a timer. Nothing in the server downloads an extract.
- **Hot refresh.** A rebuild needs a restart; see the operating contract.
- **Large countries.** France and Germany are almost 5 GB each. They are held as Geofabrik sub-regions (Île-de-France, Rhône-Alpes, Berlin).

## Attribution
© OpenStreetMap contributors, ODbL 1.0. The records keep their `openstreetmap.org` source URLs, as with Overpass.
