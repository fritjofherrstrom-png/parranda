# Local OpenStreetMap read path

Status: draft, off by default. Nothing changes unless `PARRANDA_OSM_EXTRACT_DIR` is set.

## Why
The public Overpass endpoint is the only source of OpenStreetMap places today. On 14 and 15 Nov 2026 it held small queries for about 30 seconds or answered 502 at capacity, so days were built without map evidence and without opening hours. Its own notice says automated use should run its own instance. A regional extract on disk answers the same question in milliseconds.

## How it works
1. `scripts/build-osm-extract.js` reads a regional `.osm.pbf` and the extract's boundary file (`.poly`) from disk. It keeps named elements that match `OSM_TAG_MAP` and writes them as small tile files plus a manifest. It downloads nothing.
2. `server/place-candidates/osm-extract-store.js` reads those tiles. It answers the grouped question the loader would send to Overpass: the same selectors per category, the same group size, nodes before ways before relations.
3. `createOpenDataLoader({ localSource })` asks the store first. An answer goes through the same mapping, balancing and attestation as an Overpass answer. No provider is asked for that query.

The store answers only when all of these hold. Otherwise the loader asks Overpass exactly as before.
- Every asked circle (centre and eight points on its edge) lies inside the extract's boundary.
- The snapshot is at most 30 days old (`PARRANDA_OSM_EXTRACT_MAX_AGE_DAYS`).
- Every tile it needs can be read. A missing tile is an area with no places; an unreadable one is a failure.

## Build a region
```bash
node scripts/build-osm-extract.js --pbf slovenia.osm.pbf --poly slovenia.poly \
  --region slovenia --data-timestamp 2026-11-14T21:20:00Z --out /path/to/osm-extracts
```
`--data-timestamp` is the time the extract's data ends. Geofabrik prints it beside each download. Then start the server with `PARRANDA_OSM_EXTRACT_DIR=/path/to/osm-extracts`. Several regions can sit side by side in that directory.

Measured for Slovenia on a laptop (15 Nov 2026): 314 MB extract, 20 s build, 1.9 GB peak memory, 8,178 places in 865 tiles, 4.7 MB on disk. The loader answered Ljubljana in 3 to 31 ms.

## How a day says so
A day whose map evidence was read from an extract carries `source_status.collection.map_snapshot`: `{ region, data_timestamp }`. It is absent (`null`) for a live provider answer. The label is kept in the request cache and in a shared day; a malformed label refuses the share. The planner UI does not show it yet.

## Differences from an Overpass answer
- **Age.** The data is as old as the extract. Geofabrik rebuilds extracts once a day.
- **Unnamed elements.** Overpass counts them toward a group's size before the mapper drops them. The store holds named places only, so a group can carry more usable places.
- **Centre of an area.** A way or relation sits at the middle of its bounding box, as with `out center`. A relation uses its member ways only.
- **Edges.** A place whose circle crosses the extract's boundary is not answered locally.

## Not done
- **Showing the label.** The label is in the response, not in the interface.
- **Fetching and refreshing extracts.** Which regions to hold, when to fetch them and the disk budget are operator decisions. Nothing in the server downloads an extract.
- **Large countries.** France and Germany are almost 5 GB each. The build is untested above 314 MB; sub-regions are the expected unit.

## Attribution
© OpenStreetMap contributors, ODbL 1.0. The records keep their `openstreetmap.org` source URLs, as with Overpass.
