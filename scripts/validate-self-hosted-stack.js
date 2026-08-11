"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function requireText(value, pattern, message) {
  if (!pattern.test(value)) throw new Error(message);
}

function rejectText(value, pattern, message) {
  if (pattern.test(value)) throw new Error(message);
}

function validateSelfHostedStack() {
  const dockerfile = read("Dockerfile");
  const compose = read("compose.production.yml");
  const caddy = read("deploy/Caddyfile");
  const deploy = read("scripts/deploy-self-hosted.sh");
  const ci = read(".github/workflows/ci.yml");
  const workflow = read(".github/workflows/deploy-self-hosted.yml");

  requireText(dockerfile, /FROM node:22-[^\s]+ AS build/, "docker_build_stage_missing");
  requireText(dockerfile, /COPY anywhere-render-decision\.js \.\//, "shared_honesty_build_input_missing");
  requireText(dockerfile, /npm run check:frontend && npm run build:frontend/, "frontend_build_missing");
  requireText(dockerfile, /USER node/, "non_root_runtime_missing");
  requireText(dockerfile, /HEALTHCHECK[\s\S]*\/api\/health/, "image_healthcheck_missing");

  requireText(compose, /PARRANDA_IMAGE:\?Set PARRANDA_IMAGE/, "immutable_image_required_missing");
  requireText(compose, /PARRANDA_BUILD_SHA:\?Set PARRANDA_BUILD_SHA/, "build_sha_required_missing");
  requireText(compose, /source-cache:\/var\/lib\/parranda\/source-cache/, "persistent_cache_missing");
  requireText(compose, /image: postgres:\d+\.\d+-alpine/, "pinned_source_catalog_database_missing");
  requireText(compose, /source-catalog-data:\/var\/lib\/postgresql\/data/, "persistent_source_catalog_missing");
  requireText(compose, /source-catalog-migrate:/, "source_catalog_migration_service_missing");
  requireText(compose, /source-scout-worker:[\s\S]*run-source-scout-worker\.js[\s\S]*--watch/, "source_scout_worker_missing");
  requireText(compose, /source-scout-worker:[\s\S]*condition: service_completed_successfully/, "source_scout_migration_dependency_missing");
  requireText(
    compose,
    /source-scout-worker:[\s\S]*PARRANDA_SOURCE_SEARCH: \$\{PARRANDA_SOURCE_SEARCH:-disabled\}/,
    "source_search_default_off_missing",
  );
  requireText(deploy, /run --rm source-catalog-migrate/, "source_catalog_migration_step_missing");
  requireText(ci, /--profile source-catalog[\s\S]*run --rm source-catalog-migrate/, "source_catalog_ci_smoke_missing");
  requireText(ci, /run --rm source-scout-worker[\s\S]*--limit 1/, "source_scout_worker_ci_smoke_missing");
  requireText(compose, /PARRANDA_PUBLIC_CLIENT_IDENTITY: xff/, "proxy_identity_missing");
  requireText(compose, /PARRANDA_TRUST_PROXY_HOPS: "1"/, "proxy_hop_contract_missing");
  requireText(compose, /condition: service_healthy/, "proxy_health_dependency_missing");
  requireText(compose, /image: caddy:\d+\.\d+\.\d+-alpine/, "pinned_proxy_image_missing");
  rejectText(compose, /render|onrender/i, "render_dependency_in_self_hosted_stack");

  requireText(caddy, /reverse_proxy web:8000/, "reverse_proxy_missing");
  requireText(deploy, /^if \[\[ \$# -ne 1 \|\| ! "\$1" =~ \^\[0-9a-f\]\{40\}\$ \]\]/m, "full_sha_guard_missing");
  requireText(deploy, /rolling back to/, "rollback_missing");
  requireText(deploy, /PARRANDA_CONTRACT_ROOT/, "versioned_contract_rollback_missing");
  requireText(deploy, /body\.build_sha!==process\.env\.EXPECTED_SHA/, "release_health_identity_missing");

  requireText(workflow, /workflow_run:[\s\S]*workflows:[\s\S]*- CI/, "ci_gate_missing");
  requireText(workflow, /vars\.PARRANDA_SELF_HOSTED_DEPLOY == 'enabled'/, "deploy_opt_in_missing");
  requireText(workflow, /github\.ref == 'refs\/heads\/main'/, "manual_main_only_guard_missing");
  requireText(workflow, /DEPLOY_PATH.*\^\/\[A-Za-z0-9\._\/-\]\+\$/, "deploy_path_shell_guard_missing");
  requireText(workflow, /packages: write/, "registry_permission_missing");
  requireText(workflow, /PARRANDA_BUILD_SHA=\$\{\{ steps\.release\.outputs\.sha \}\}/, "image_sha_build_arg_missing");
  rejectText(workflow, /RENDER_DEPLOY|onrender\.com/i, "render_dependency_in_workflow");

  return true;
}

if (require.main === module) {
  validateSelfHostedStack();
  process.stdout.write("self-hosted production contract: ok\n");
}

module.exports = { validateSelfHostedStack };
