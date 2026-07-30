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

The current application has no Source Catalog database or scout worker. This
stack deliberately does not create placeholder services that would suggest
otherwise. The future geo Source Catalog can add Postgres plus a queue/worker to
the private Compose network while leaving the web/Caddy deployment contract
unchanged.

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
restarts. It is rebuildable cache, not the future system of record. Back up
`caddy-data` if preserving certificate state matters.

When the dynamic Live Source Catalog lands, its Postgres data will be the system
of record and must receive scheduled, tested backups. Event scouting belongs in
a persistent worker/queue on this host, never inside the deploy workflow or the
public request path.
