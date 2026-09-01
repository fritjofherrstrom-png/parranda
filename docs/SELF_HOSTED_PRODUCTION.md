# Self-hosted Parranda production

This profile runs Parranda on an operator-owned Linux host with an immutable OCI
image, Caddy HTTPS, a persistent source cache, health-verified activation and
automatic rollback. It does not depend on Render.

For a quick field-test link from a Mac, use `npm run share:latest` instead; see
[`SELF_HOSTING.md`](SELF_HOSTING.md). The production profile is for an always-on
host where the running commit and rollback behavior must be deterministic.

## What ships today

```text
internet -> Caddy -> Parranda web -> trusted upstream sources
                         |
                         +-> persistent source cache volume
```

The web profile enables OSM/Overpass, Wikidata and Overture Places. Overture is
read as a bounded GeoParquet window with DuckDB and warmed outside the route
request; DuckDB's `httpfs` extension and accepted rows live under the same
persistent cache volume. The source is a fallback/reservoir family, not a review
or popularity service, and a directory-only place remains provisional.

The stack includes an optional Postgres-backed geo Source Catalog and bounded
source-scout worker. It persists discovered source profiles as review-needed
records and lets the web runtime read only fresh, operator-approved profiles.
It is disabled by default. Public requests may record a deduplicated demand for
a resolver-attested bounded place, but never perform or wait for discovery.

## Host prerequisites

- A Linux host with Docker Engine and Docker Compose v2.
- A DNS name whose A/AAAA record points at the host.
- Inbound TCP 80/443 and UDP 443; SSH restricted to operator access.
- Enough persistent disk for Docker images, Caddy certificates and Parranda's
  source cache.
- GHCR access configured on the host if the image package is private.

Create the deployment directory:

```bash
sudo install -d -o "$USER" -g "$USER" /opt/parranda
cp deploy/self-hosted.env.example /opt/parranda/.env.production
chmod 600 /opt/parranda/.env.production
```

Edit `.env.production` and set a real hostname, image repository and an honest
Nominatim User-Agent with operator contact information. Secrets remain on the
host. The deployment workflow never uploads or replaces this file.

For a private GHCR package, log in once on the host with a token that has only
`read:packages`:

```bash
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
```

## GitHub deployment configuration

The workflow is inert until the repository variable below is explicitly set:

```text
PARRANDA_SELF_HOSTED_DEPLOY=enabled
```

Configure the GitHub `production` environment with:

| Kind | Name | Purpose |
| --- | --- | --- |
| secret | `PRODUCTION_HOST` | SSH hostname/IP |
| secret | `PRODUCTION_USER` | unprivileged deploy user |
| secret | `PRODUCTION_SSH_KEY` | private deploy key |
| secret | `PRODUCTION_KNOWN_HOSTS` | pinned host-key line, not a runtime `ssh-keyscan` |
| variable | `PARRANDA_DEPLOY_PATH` | optional, defaults to `/opt/parranda` |
| variable | `PARRANDA_PRODUCTION_URL` | optional public smoke-test URL |

After CI succeeds on `main`, `.github/workflows/deploy-self-hosted.yml`:

1. checks out the exact green SHA;
2. builds both amd64 and arm64 images with a freshly built frontend;
3. publishes the immutable SHA tag to GHCR;
4. uploads the Compose/Caddy/deploy contract into a release directory named by SHA;
5. activates that exact image on the host;
6. verifies `/api/health.build_sha` inside the container and at the public edge;
7. rolls back to the previous image if activation is not healthy.

Manual runs use the same workflow and never deploy an uncommitted worktree.

## Runtime truth and trust boundary

- Only Caddy publishes host ports. The Node container is private to Compose.
- Caddy is the one trusted proxy hop. Public request headers are not trusted
  beyond that declared hop.
- The existing public-access guard remains enabled for upstream-touching APIs.
- App and Caddy root filesystems are read-only; only named volumes and bounded
  tmpfs mounts are writable.
- `PARRANDA_BUILD_SHA` is embedded in the image and required by Compose. Health
  verification compares it with the requested release SHA.
- `config/reviewed-event-feeds.json` remains trusted image-owned configuration.
  Public payloads cannot inject source endpoints or provider rows.
- The optional Source Catalog is enabled only through host-owned environment
  configuration. Scout writes are forced to `review_needed`; only profiles with
  a fresh approved runtime review can supplement event or place acquisition.

## Optional geo Source Catalog

Set these host-owned values in `.env.production`:

```text
PARRANDA_SOURCE_CATALOG=enabled
PARRANDA_QUALIFIED_SOURCE_RUNTIME=disabled
PARRANDA_REVIEWED_PLACE_SOURCES=enabled
PARRANDA_SOURCE_CATALOG_PASSWORD=a-long-url-safe-secret
PARRANDA_SOURCE_CATALOG_DATABASE_URL=postgresql://parranda:a-long-url-safe-secret@postgres:5432/parranda
```

The deploy script then starts the private Postgres service and runs the
versioned migration before activating the web release. The database is not
published on a host port. A migration or database-start failure aborts the new
release before health verification. The same optional Compose profile runs one
background worker with a default five-minute polling interval and a maximum
batch of one target. Override the interval with
`PARRANDA_EVENT_SOURCE_SCOUT_INTERVAL_MS` (minimum 30 seconds).

The operator scout can persist a bounded discovery result for review:

```bash
PARRANDA_SOURCE_CATALOG=enabled \
PARRANDA_SOURCE_CATALOG_DATABASE_URL="$DATABASE_URL" \
npm run scout:events -- --place "Place name" --live --catalog
```

This command never activates a source. It records the normalized place profile,
geographic scope, source-family evidence and candidates as `review_needed`.
Approval remains a separate trusted operator action and the shared reviewed-
profile validator is applied again on every catalog read.

Scheduled worker runs additionally probe at most two exact manifest candidates
through the existing bounded event adapters and keep compact, rolling
qualification evidence in the same review-needed profile. Two healthy days
within 30 days plus real accepted event yield may mark a candidate
`qualified_for_review`. This never changes catalog status or creates an
approved feed.

The same schedule discovers and probes schema.org place-list candidates in a
separate lane. It follows only bounded public/same-origin pages, requires exact
coordinates inside the resolver-attested profile bounds, persists compact
counts rather than place rows, and requires healthy evidence on two UTC days.
`qualified_for_review` is not approval: place candidates have no probationary
runtime lane and cannot reach the reservoir until a fresh operator review adds
an exact `runtime_review.place_sources` binding.

An operator may set `PARRANDA_QUALIFIED_SOURCE_RUNTIME=enabled` to let a fresh
qualified candidate enter a bounded probation lane. The binding is revalidated
against the current discovered endpoint, adapter, source identity, terms and
scope on every read. Its latest healthy probe must be at most eight days old;
the resulting source stays low-trust and Pulse-only, expires automatically and
cannot anchor or mutate a route. Approved/static sources retain precedence over
the same endpoint. Leave the flag disabled when only manually approved sources
should reach runtime.

After editing the scout output's `source_profile.runtime_review` to bind exact
candidates, reviewed endpoints, health, terms, timezone and an expiry, apply it
through the trusted operator CLI:

```bash
PARRANDA_SOURCE_CATALOG=enabled \
PARRANDA_SOURCE_CATALOG_DATABASE_URL="$DATABASE_URL" \
npm run review:source-profile -- --approve reviewed-profile.json
```

The command rejects unreviewed, expired, endpoint-swapped, adapter-swapped,
unhealthy, social-only or otherwise invalid profiles. It is not an HTTP API.

An approved profile may also carry a `runtime_review.place_sources` list. The
first place adapter is deliberately narrow: `schema_org_place_html` or
`schema_org_place_json`, exact HTTPS endpoint/adapter/source-identity binding,
an `official` or `editorial` evidence family, compatible terms, healthy status,
bounded item count and the profile's reviewed geographic bounds. It reads only
JSON-LD factual atoms for a closed set of useful place types and requires exact
coordinates; it does not geocode rows or ingest descriptions, ratings, images
or generic `LocalBusiness` records. Cold reads warm the shared source cache and
the request serves them on a later hit. A reviewed official source may supply a
route candidate without being mislabeled as place-level human verification;
editorial-only rows still need independent corroboration. Expiry, unknown
fields, an off-origin redirect or a catalog outage all fail closed.

## Manual deployment and rollback

The GitHub workflow is preferred because it builds once and deploys exactly what
CI approved. An operator can activate an image already present in GHCR with:

```bash
cd /opt/parranda/current
PARRANDA_DEPLOY_ROOT=/opt/parranda \
  ./scripts/deploy-self-hosted.sh FULL_40_CHARACTER_GIT_SHA
```

`.release.env` records the active image, build SHA and versioned deployment
contract. If the new web container never reports the requested SHA, the script
restores both the preceding image and its Compose/Caddy contract, verifies that
release, and only then exits with failure.

## Data durability

The `source-cache` volume avoids cold upstream lookups after application
restarts. It is rebuildable cache, not a system of record. Back up `caddy-data`
if preserving certificate state matters.

When enabled, `source-catalog-data` is the Source Catalog system of record and
must receive scheduled, tested backups. Event scouting runs in the dedicated
worker, never inside the deploy workflow or public request path. Discovery
results remain `review_needed`; only the separate trusted review action can
activate a source.

Proactive unknown-place source discovery is not enabled by the base deployment.
It additionally requires the `source-catalog` Compose profile, an operator-owned
SearXNG JSON endpoint, and:

```bash
PARRANDA_SOURCE_SEARCH=enabled
PARRANDA_SOURCE_SEARCH_ENDPOINT=https://search.example/search
```

If either the worker/profile or endpoint is absent, the application may record
source demand but cannot enumerate unknown source pages in the background. That
is an environment-not-wired state, not a healthy-empty verdict for the place.
The endpoint and its cache/rate policy remain an operator responsibility; the
public request path never accepts a search endpoint or source URL.
