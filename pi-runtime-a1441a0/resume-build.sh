set -eu
cd /home/hermes/codex-pr631-runtime-20261021
python3 runtime-host.py guard
test "$(sha256sum source-a1441a0.tar.gz | cut -d ' ' -f1)" = 1ea1e8bc9e53d9982f93ae89e2badc412effd3ad81aa2d7acafa96e4296e021d
test "$(df --output=avail -B1 / | tail -n 1)" -gt 3221225472
test -z "$(pgrep -f '^docker (build|buildx)' || true)"
test -d source-a1441a0
if docker image inspect parranda-pr631:a1441a0c73d556959e02fa7bcd0db5c6fc69371a >/dev/null 2>&1; then exit 65; fi
cd source-a1441a0
docker build --pull=false --iidfile ../image-id.txt --build-arg PARRANDA_BUILD_SHA=a1441a0c73d556959e02fa7bcd0db5c6fc69371a --label org.opencontainers.image.revision=a1441a0c73d556959e02fa7bcd0db5c6fc69371a -t parranda-pr631:a1441a0c73d556959e02fa7bcd0db5c6fc69371a .
python3 ../runtime-host.py guard
