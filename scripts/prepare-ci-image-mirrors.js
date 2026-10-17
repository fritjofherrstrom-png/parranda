#!/usr/bin/env node
'use strict';

const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join, relative } = require('node:path');
const { spawnSync } = require('node:child_process');

// These index digests matched across the original registries on 2026-10-09.
// Keep tags visible and content pinned; current reachability is verified below.
const imageCandidates = Object.freeze({
  node: [
    'docker.io/library/node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392',
    'mirror.gcr.io/library/node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392',
  ],
  postgres: [
    'docker.io/library/postgres:17.5-alpine@sha256:6567bca8d7bc8c82c5922425a0baee57be8402df92bae5eacad5f01ae9544daa',
    'mirror.gcr.io/library/postgres:17.5-alpine@sha256:6567bca8d7bc8c82c5922425a0baee57be8402df92bae5eacad5f01ae9544daa',
  ],
  frontend: [
    'docker.io/docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e',
    'mirror.gcr.io/docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e',
  ],
});
const images = Object.fromEntries(Object.entries(imageCandidates).map(([name, candidates]) => [name, candidates[0]]));

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `docker exited ${result.status}`);
  return result.stdout;
}

function pullCiImages() {
  const selected = {};
  for (const [name, candidates] of Object.entries(imageCandidates)) {
    const failures = [];
    for (const reference of candidates) {
      try {
        docker(['pull', reference]);
        const digests = JSON.parse(docker(['image', 'inspect', '--format', '{{json .RepoDigests}}', reference]));
        const digest = reference.split('@')[1];
        if (!Array.isArray(digests) || !digests.some(value => typeof value === 'string' && value.endsWith(`@${digest}`))) {
          throw new Error('pulled image does not attest the pinned repository digest');
        }
        selected[name] = reference;
        break;
      } catch (error) {
        if (error.code === 'ENOENT') throw new Error('Docker CLI is required to verify CI image inputs');
        failures.push(`${reference}: ${error.message.slice(0, 1000)}`);
      }
    }
    if (!selected[name]) throw new Error(`No verified CI image for ${name}\n${failures.join('\n')}`);
  }
  return selected;
}

function buildCiInputs(dockerfile, compose, imageSet = images) {
  const syntax = dockerfile.match(/^# syntax=.*$/gm) || [];
  const stages = dockerfile.match(/^[ \t]*FROM\b.*$/gmi) || [];
  const postgres = compose.match(/^ {4}image: postgres:.*$/gm) || [];
  if (syntax.length !== 1 || syntax[0] !== '# syntax=docker/dockerfile:1'
    || stages.length !== 2 || stages[0] !== 'FROM node:22-bookworm-slim AS build'
    || stages[1] !== 'FROM node:22-bookworm-slim AS runtime'
    || postgres.length !== 1 || postgres[0] !== '    image: postgres:17.5-alpine') {
    throw new Error('production image contract changed; review and update the CI mirror mapping');
  }
  return {
    dockerfile: dockerfile.replace('# syntax=docker/dockerfile:1', `# syntax=${imageSet.frontend}`)
      .replaceAll('FROM node:22-bookworm-slim AS ', `FROM ${imageSet.node} AS `),
    override: { services: { postgres: { image: imageSet.postgres } } },
  };
}

if (require.main === module) {
  try {
    const root = resolve(__dirname, '..');
    const directory = process.argv[2] && resolve(process.argv[2]);
    if (!directory || process.argv.length !== 3) throw new Error('Usage: prepare-ci-image-mirrors.js OUTPUT_DIRECTORY');
    const outputRelative = relative(root, directory);
    if (!outputRelative.startsWith('../')) throw new Error('CI output directory must be outside the repository');
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    const compose = readFileSync(join(root, 'compose.production.yml'), 'utf8');
    buildCiInputs(dockerfile, compose); // Validate the production contract before registry access.
    const selectedImages = pullCiImages();
    const inputs = buildCiInputs(dockerfile, compose, selectedImages);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'Dockerfile'), inputs.dockerfile, { flag: 'wx' });
    writeFileSync(join(directory, 'compose.ci-images.json'), `${JSON.stringify(inputs.override, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ images: selectedImages, directory }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildCiInputs };
