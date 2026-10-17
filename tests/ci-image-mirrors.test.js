const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '..');
const script = join(root, 'scripts/prepare-ci-image-mirrors.js');

const digests = {
  node: 'sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392',
  postgres: 'sha256:6567bca8d7bc8c82c5922425a0baee57be8402df92bae5eacad5f01ae9544daa',
  frontend: 'sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e',
};
function dockerStub(t, mode = 'success') {
  const directory = mkdtempSync(join(tmpdir(), 'parranda-docker-stub-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, 'calls.jsonl');
  writeFileSync(join(directory, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), reference = args.at(-1);
fs.appendFileSync(process.env.PARRANDA_DOCKER_CALLS, JSON.stringify(args) + '\\n');
if (args.length === 2 && args[0] === 'pull') {
  if (process.env.PARRANDA_DOCKER_MODE === 'all-pulls-fail' ||
      (process.env.PARRANDA_DOCKER_MODE === 'first-429' && reference.startsWith('docker.io/library/node:'))) {
    process.stderr.write('429 Too Many Requests: Data limit exceeded\\n'); process.exit(1);
  }
  process.exit(0);
}
if (args.length === 5 && args[0] === 'image' && args[1] === 'inspect' &&
    args[2] === '--format' && args[3] === '{{json .RepoDigests}}') {
  const repository = reference.split('@')[0].replace(/:[^/:]+$/, '');
  const digest = process.env.PARRANDA_DOCKER_MODE === 'wrong-digest'
    ? 'sha256:' + '0'.repeat(64) : reference.split('@')[1];
  process.stdout.write(JSON.stringify([repository + '@' + digest]) + '\\n'); process.exit(0);
}
process.stderr.write('unexpected Docker command'); process.exit(2);
`, { mode: 0o755 });
  return {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`,
      PARRANDA_DOCKER_MODE: mode, PARRANDA_DOCKER_CALLS: log },
    commands: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [],
  };
}
const runCli = (directory, env) => spawnSync(process.execPath, [script, directory], { encoding: 'utf8', env });
function outputDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'parranda-ci-pull-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('runner temporary directory is resolved inside a step and persisted for subsequent steps', () => {
  const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.doesNotMatch(workflow, /^ {6}PARRANDA_CI_INPUT_DIR:.*\$\{\{ runner\.temp \}\}/m);
  assert.ok(workflow.includes('"$RUNNER_TEMP/parranda-ci-images"'));
  assert.ok(workflow.includes('>> "$GITHUB_ENV"'));
});

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


test('CI gets verified digest-pinned inputs without modifying production files or build instructions', t => {
  const docker = dockerStub(t);
  assert.ok(existsSync(script), 'CI mirror input generator is missing');
  const beforeDockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const beforeCompose = readFileSync(join(root, 'compose.production.yml'), 'utf8');
  const directory = mkdtempSync(join(tmpdir(), 'parranda-ci-mirrors-test-'));
  try {
    const result = runCli(directory, docker.env);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    const dockerfile = readFileSync(join(directory, 'Dockerfile'), 'utf8');
    const override = JSON.parse(readFileSync(join(directory, 'compose.ci-images.json'), 'utf8'));
    assert.equal(receipt.images.node, `docker.io/library/node:22-bookworm-slim@${digests.node}`);
    assert.equal(receipt.images.postgres, `docker.io/library/postgres:17.5-alpine@${digests.postgres}`);
    assert.equal(receipt.images.frontend, `docker.io/docker/dockerfile:1@${digests.frontend}`);
    assert.equal(docker.commands().filter(args => args[0] === 'pull').length, 3);
    assert.equal(docker.commands().filter(args => args[1] === 'inspect').length, 3);
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

test('CLI refuses repository output paths and existing output files', t => {
  const docker = dockerStub(t);
  const before = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const result = runCli(root, docker.env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the repository/);
  assert.equal(readFileSync(join(root, 'Dockerfile'), 'utf8'), before);
  const directory = mkdtempSync(join(tmpdir(), 'parranda-ci-existing-test-'));
  try {
    assert.equal(runCli(directory, docker.env).status, 0);
    const generated = readFileSync(join(directory, 'Dockerfile'), 'utf8');
    const second = runCli(directory, docker.env);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /EEXIST/);
    assert.equal(readFileSync(join(directory, 'Dockerfile'), 'utf8'), generated);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('a rate-limited first registry falls back once to the same verified digest', t => {
  const docker = dockerStub(t, 'first-429'), directory = outputDirectory(t);
  const result = runCli(directory, docker.env);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.images.node, `mirror.gcr.io/library/node:22-bookworm-slim@${digests.node}`);
  assert.deepEqual(docker.commands().filter(args => args[0] === 'pull' && args[1].includes('/node:')), [
    ['pull', `docker.io/library/node:22-bookworm-slim@${digests.node}`],
    ['pull', `mirror.gcr.io/library/node:22-bookworm-slim@${digests.node}`],
  ]);
  assert.ok(docker.commands().some(args => args[1] === 'inspect' && args.at(-1) === receipt.images.node));
  assert.ok(readFileSync(join(directory, 'Dockerfile'), 'utf8').includes(`FROM ${receipt.images.node} AS runtime`));
});

for (const mode of ['all-pulls-fail', 'wrong-digest']) {
  test(`${mode} refuses CI inputs after the bounded candidate set is exhausted`, t => {
    const docker = dockerStub(t, mode), directory = outputDirectory(t);
    const result = runCli(directory, docker.env);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '', 'no successful mirror receipt may be emitted');
    assert.equal(existsSync(join(directory, 'Dockerfile')), false);
    assert.equal(existsSync(join(directory, 'compose.ci-images.json')), false);
    const pulls = docker.commands().filter(args => args[0] === 'pull');
    assert.equal(pulls.length, 2, 'each fixed candidate is tried once, without blanket retries');
    assert.ok(pulls.every(args => args[1].endsWith(`@${digests.node}`)), 'the content identity never changes');
    if (mode === 'wrong-digest') assert.equal(docker.commands().filter(args => args[1] === 'inspect').length, 2);
  });
}

test('a missing Docker CLI fails closed without generated inputs', t => {
  const directory = outputDirectory(t);
  const result = runCli(directory, { ...process.env, PATH: directory });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(existsSync(join(directory, 'Dockerfile')), false);
  assert.equal(existsSync(join(directory, 'compose.ci-images.json')), false);
});
