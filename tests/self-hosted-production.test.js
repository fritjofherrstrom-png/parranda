"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const { validateSelfHostedStack } = require("../scripts/validate-self-hosted-stack");

test("self-hosted production files keep one immutable deployment contract", () => {
  assert.equal(validateSelfHostedStack(), true);
});

test("the production runtime includes CA certificates for trusted HTTPS source reads", () => {
  const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  const runtimeStage = dockerfile.split(/FROM node:22-bookworm-slim AS runtime\s*/u)[1] || "";

  assert.match(runtimeStage, /apt-get install[^\n]*ca-certificates/u);
});

test("self-hosted deployment script is valid bash", () => {
  execFileSync("bash", ["-n", path.join(ROOT, "scripts/deploy-self-hosted.sh")]);
});

test("self-hosted deployment activates an exact healthy release", () => {
  const fixture = deploymentFixture();
  const result = runDeployment(fixture, fixture.newSha);

  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(fixture.releaseEnv, "utf8"), new RegExp(fixture.newSha));
  assert.equal(fs.realpathSync(path.join(fixture.root, "current")), fs.realpathSync(fixture.newContract));
});

test("self-hosted deployment restores the prior image and contract after failed health", () => {
  const fixture = deploymentFixture({ withPrevious: true });
  const result = runDeployment(fixture, fixture.newSha, { failSha: fixture.newSha });

  assert.equal(result.status, 1);
  const active = fs.readFileSync(fixture.releaseEnv, "utf8");
  assert.match(active, new RegExp(fixture.previousSha));
  assert.doesNotMatch(active, new RegExp(fixture.newSha));
  assert.equal(fs.realpathSync(path.join(fixture.root, "current")), fs.realpathSync(fixture.previousContract));
  assert.match(result.stderr, /rolling back to/);
  assert.match(result.stderr, /rollback healthy/);
});

test("self-hosted deployment migrates an explicitly enabled source catalog", () => {
  const fixture = deploymentFixture({ withCatalog: true });
  const result = runDeployment(fixture, fixture.newSha);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.realpathSync(path.join(fixture.root, "current")), fs.realpathSync(fixture.newContract));
});

test("self-hosted deployment rejects an enabled catalog without database credentials", () => {
  const fixture = deploymentFixture();
  fs.appendFileSync(path.join(fixture.root, ".env.production"), "PARRANDA_SOURCE_CATALOG=enabled\n");
  const result = runDeployment(fixture, fixture.newSha);

  assert.equal(result.status, 65);
  assert.match(result.stderr, /source catalog enabled without database credentials/);
});

function deploymentFixture({ withPrevious = false, withCatalog = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-deploy-test-"));
  const bin = path.join(root, "bin");
  const releases = path.join(root, "releases");
  const newSha = "b".repeat(40);
  const previousSha = "a".repeat(40);
  const newContract = path.join(releases, newSha);
  const previousContract = path.join(releases, previousSha);
  const releaseEnv = path.join(root, ".release.env");
  fs.mkdirSync(bin, { recursive: true });
  createContract(newContract);
  createContract(previousContract);
  fs.copyFileSync(
    path.join(ROOT, "scripts/deploy-self-hosted.sh"),
    path.join(newContract, "scripts/deploy-self-hosted.sh"),
  );
  fs.chmodSync(path.join(newContract, "scripts/deploy-self-hosted.sh"), 0o755);
  const environment = [
    "PARRANDA_IMAGE_REPOSITORY=ghcr.io/example/parranda",
    "PARRANDA_SITE_ADDRESS=example.test",
  ];
  if (withCatalog) {
    environment.push(
      "PARRANDA_SOURCE_CATALOG=enabled",
      "PARRANDA_SOURCE_CATALOG_PASSWORD=test-password",
      "PARRANDA_SOURCE_CATALOG_DATABASE_URL=postgresql://parranda:test-password@postgres:5432/parranda",
    );
  }
  fs.writeFileSync(path.join(root, ".env.production"), `${environment.join("\n")}\n`);
  fs.writeFileSync(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -eu
if [[ " $* " == *" exec "* ]]; then
  expected=""
  for arg in "$@"; do
    case "$arg" in EXPECTED_SHA=*) expected="\${arg#EXPECTED_SHA=}" ;; esac
  done
  if [[ -n "\${FAKE_DOCKER_FAIL_SHA:-}" && "$expected" == "$FAKE_DOCKER_FAIL_SHA" ]]; then
    exit 1
  fi
fi
exit 0
`,
  );
  fs.chmodSync(path.join(bin, "docker"), 0o755);

  if (withPrevious) {
    fs.writeFileSync(
      releaseEnv,
      [
        `PARRANDA_IMAGE=ghcr.io/example/parranda:${previousSha}`,
        `PARRANDA_BUILD_SHA=${previousSha}`,
        `PARRANDA_CONTRACT_ROOT=${previousContract}`,
        "",
      ].join("\n"),
    );
    fs.symlinkSync(previousContract, path.join(root, "current"));
  }

  return {
    root,
    bin,
    newSha,
    previousSha,
    newContract,
    previousContract,
    releaseEnv,
  };
}

function createContract(contractRoot) {
  fs.mkdirSync(path.join(contractRoot, "deploy"), { recursive: true });
  fs.mkdirSync(path.join(contractRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(contractRoot, "compose.production.yml"), "services: {}\n");
  fs.writeFileSync(path.join(contractRoot, "deploy/Caddyfile"), ":80 {}\n");
}

function runDeployment(fixture, sha, { failSha = "" } = {}) {
  return spawnSync(
    "bash",
    [path.join(fixture.newContract, "scripts/deploy-self-hosted.sh"), sha],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fixture.bin}:${process.env.PATH}`,
        PARRANDA_DEPLOY_ROOT: fixture.root,
        PARRANDA_DEPLOY_HEALTH_ATTEMPTS: "1",
        PARRANDA_DEPLOY_HEALTH_DELAY_SEC: "0",
        FAKE_DOCKER_FAIL_SHA: failSha,
      },
    },
  );
}
