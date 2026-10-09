const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '..');
const script = join(root, 'scripts/prepare-ci-image-mirrors.js');

test('CI uses generated inputs for build and every Source Catalog Compose command without skipping checks', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /node scripts\/prepare-ci-image-mirrors\.js/);
  assert.match(workflow, /--file "\$PARRANDA_CI_INPUT_DIR\/Dockerfile"/);
  const commands = workflow.split('\n').filter(line => line.includes('docker compose --profile source-catalog'));
  assert.equal(commands.length, 6);
  for (const command of commands) assert.ok(command.includes('-f "$PARRANDA_CI_INPUT_DIR/compose.ci-images.json"'), command);
  for (const check of ['npm test', 'npm run check:frontend', 'npm run test:frontend', 'npm run build:frontend', 'npm run validate:self-hosted', 'check-frontend-dist-drift.js', 'simpleview-catalog-postgres.test.js']) assert.ok(workflow.includes(check), check);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true/);
});


test('CI gets digest-pinned mirror inputs without modifying production files or build instructions', () => {
  assert.ok(existsSync(script), 'CI mirror input generator is missing');
  const beforeDockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const beforeCompose = readFileSync(join(root, 'compose.production.yml'), 'utf8');
  const directory = mkdtempSync(join(tmpdir(), 'parranda-ci-mirrors-test-'));
  try {
    const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    const dockerfile = readFileSync(join(directory, 'Dockerfile'), 'utf8');
    const override = JSON.parse(readFileSync(join(directory, 'compose.ci-images.json'), 'utf8'));
    assert.match(receipt.images.node, /^public\.ecr\.aws\/docker\/library\/node:22-bookworm-slim@sha256:[a-f0-9]{64}$/);
    assert.match(receipt.images.postgres, /^public\.ecr\.aws\/docker\/library\/postgres:17\.5-alpine@sha256:[a-f0-9]{64}$/);
    assert.match(receipt.images.frontend, /^mirror\.gcr\.io\/docker\/dockerfile:1@sha256:[a-f0-9]{64}$/);
    assert.equal(dockerfile,
      beforeDockerfile.replace('# syntax=docker/dockerfile:1', `# syntax=${receipt.images.frontend}`)
        .replaceAll('FROM node:22-bookworm-slim AS ', `FROM ${receipt.images.node} AS `));
    assert.deepEqual(override, { services: { postgres: { image: receipt.images.postgres } } });
    assert.equal(readFileSync(join(root, 'Dockerfile'), 'utf8'), beforeDockerfile);
    assert.equal(readFileSync(join(root, 'compose.production.yml'), 'utf8'), beforeCompose);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CI fails closed when production image declarations change instead of silently testing different images', () => {
  const { buildCiInputs } = require(script);
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const compose = readFileSync(join(root, 'compose.production.yml'), 'utf8');
  for (const changed of [
    dockerfile.replace('FROM node:22-bookworm-slim AS build', 'FROM node:24-bookworm-slim AS build'),
    dockerfile.replace('# syntax=docker/dockerfile:1', '# syntax=docker/dockerfile:1.9'),
    `${dockerfile}\nFROM alpine:3.22 AS extra\n`,
  ]) assert.throws(() => buildCiInputs(changed, compose), /production image contract changed/);
  assert.throws(() => buildCiInputs(dockerfile, compose.replace('image: postgres:17.5-alpine', 'image: postgres:18-alpine')), /production image contract changed/);
});

test('CLI refuses repository output paths and existing output files', () => {
  const before = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the repository/);
  assert.equal(readFileSync(join(root, 'Dockerfile'), 'utf8'), before);
  const directory = mkdtempSync(join(tmpdir(), 'parranda-ci-existing-test-'));
  try {
    assert.equal(spawnSync(process.execPath, [script, directory]).status, 0);
    const generated = readFileSync(join(directory, 'Dockerfile'), 'utf8');
    const second = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /EEXIST/);
    assert.equal(readFileSync(join(directory, 'Dockerfile'), 'utf8'), generated);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
