#!/usr/bin/env bash

set -Eeuo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 <full-git-sha>" >&2
  exit 64
fi

release_sha="$1"
contract_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_root="${PARRANDA_DEPLOY_ROOT:-$contract_root}"
production_env="${PARRANDA_PRODUCTION_ENV:-$deploy_root/.env.production}"
release_env="$deploy_root/.release.env"
release_tmp="$deploy_root/.release.env.tmp"
lock_dir="$deploy_root/.deploy.lock"

if [[ ! -f "$production_env" ]]; then
  echo "missing production environment: $production_env" >&2
  exit 66
fi

if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "another deployment is already running" >&2
  exit 75
fi
trap 'rm -rf "$lock_dir" "$release_tmp"' EXIT

env_value() {
  local key="$1"
  local file="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1 | tr -d '\r'
}

image_repository="${PARRANDA_IMAGE_REPOSITORY:-$(env_value PARRANDA_IMAGE_REPOSITORY "$production_env")}"
if [[ ! "$image_repository" =~ ^[a-z0-9][a-z0-9._/-]*$ ]]; then
  echo "invalid or missing PARRANDA_IMAGE_REPOSITORY" >&2
  exit 65
fi

if [[ "$(env_value PARRANDA_SOURCE_CATALOG "$production_env")" == "enabled" ]]; then
  catalog_password="$(env_value PARRANDA_SOURCE_CATALOG_PASSWORD "$production_env")"
  catalog_url="$(env_value PARRANDA_SOURCE_CATALOG_DATABASE_URL "$production_env")"
  if [[ -z "$catalog_password" || -z "$catalog_url" || "$catalog_url" == *"catalog-disabled"* ]]; then
    echo "source catalog enabled without database credentials" >&2
    exit 65
  fi
fi

previous_image=""
previous_sha=""
previous_contract=""
if [[ -f "$release_env" ]]; then
  previous_image="$(env_value PARRANDA_IMAGE "$release_env")"
  previous_sha="$(env_value PARRANDA_BUILD_SHA "$release_env")"
  previous_contract="$(env_value PARRANDA_CONTRACT_ROOT "$release_env")"
fi

compose() {
  local selected_contract="$1"
  shift
  if [[ "$(env_value PARRANDA_SOURCE_CATALOG "$production_env")" == "enabled" ]]; then
    docker compose \
      --env-file "$production_env" \
      --env-file "$release_env" \
      -f "$selected_contract/compose.production.yml" \
      --profile source-catalog \
      "$@"
    return
  fi
  docker compose \
    --env-file "$production_env" \
    --env-file "$release_env" \
    -f "$selected_contract/compose.production.yml" \
    "$@"
}

write_release() {
  local image="$1"
  local sha="$2"
  local selected_contract="$3"
  {
    printf 'PARRANDA_IMAGE=%s\n' "$image"
    printf 'PARRANDA_BUILD_SHA=%s\n' "$sha"
    printf 'PARRANDA_CONTRACT_ROOT=%s\n' "$selected_contract"
  } > "$release_tmp"
  mv "$release_tmp" "$release_env"
}

verify_release() {
  local expected_sha="$1"
  local selected_contract="$2"
  local attempts="${PARRANDA_DEPLOY_HEALTH_ATTEMPTS:-40}"
  local delay="${PARRANDA_DEPLOY_HEALTH_DELAY_SEC:-3}"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if compose "$selected_contract" exec -T -e EXPECTED_SHA="$expected_sha" web node -e \
      "fetch('http://127.0.0.1:8000/api/health').then((r)=>r.json()).then((body)=>{if(body.ok!==true||body.build_sha!==process.env.EXPECTED_SHA)process.exit(1)}).catch(()=>process.exit(1))"; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

activate_release() {
  local image="$1"
  local sha="$2"
  local selected_contract="$3"
  [[ -f "$selected_contract/compose.production.yml" ]] || return 1
  [[ -f "$selected_contract/deploy/Caddyfile" ]] || return 1
  write_release "$image" "$sha" "$selected_contract"
  compose "$selected_contract" config --quiet
  compose "$selected_contract" pull web caddy
  if [[ "$(env_value PARRANDA_SOURCE_CATALOG "$production_env")" == "enabled" ]]; then
    compose "$selected_contract" pull postgres source-catalog-migrate
    compose "$selected_contract" up -d postgres
    compose "$selected_contract" run --rm source-catalog-migrate
  fi
  compose "$selected_contract" up -d --remove-orphans
  verify_release "$sha" "$selected_contract"
}

new_image="${image_repository}:${release_sha}"
echo "deploying Parranda ${release_sha}"

if activate_release "$new_image" "$release_sha" "$contract_root"; then
  ln -sfn "$contract_root" "$deploy_root/current"
  echo "deployment healthy: ${release_sha}"
  exit 0
fi

echo "deployment failed health verification" >&2
if [[ -n "$previous_image" && "$previous_sha" =~ ^[0-9a-f]{40}$ && -d "$previous_contract" ]]; then
  echo "rolling back to ${previous_sha}" >&2
  if activate_release "$previous_image" "$previous_sha" "$previous_contract"; then
    ln -sfn "$previous_contract" "$deploy_root/current"
    echo "rollback healthy: ${previous_sha}" >&2
  else
    echo "rollback failed; operator action required" >&2
  fi
else
  echo "no previous release available for rollback" >&2
fi
exit 1
