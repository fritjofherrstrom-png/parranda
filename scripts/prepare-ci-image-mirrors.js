#!/usr/bin/env node
'use strict';

const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join, relative } = require('node:path');

// Docker Hub and the mirrors returned identical index digests on 2026-10-09.
// Keep the original tags visible; updating a digest is an explicit CI change.
const images = Object.freeze({
  node: 'public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392',
  postgres: 'public.ecr.aws/docker/library/postgres:17.5-alpine@sha256:6567bca8d7bc8c82c5922425a0baee57be8402df92bae5eacad5f01ae9544daa',
  frontend: 'mirror.gcr.io/docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e',
});

function buildCiInputs(dockerfile, compose) {
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
    dockerfile: dockerfile.replace('# syntax=docker/dockerfile:1', `# syntax=${images.frontend}`)
      .replaceAll('FROM node:22-bookworm-slim AS ', `FROM ${images.node} AS `),
    override: { services: { postgres: { image: images.postgres } } },
  };
}

if (require.main === module) {
  try {
    const root = resolve(__dirname, '..');
    const directory = process.argv[2] && resolve(process.argv[2]);
    if (!directory || process.argv.length !== 3) throw new Error('Usage: prepare-ci-image-mirrors.js OUTPUT_DIRECTORY');
    const outputRelative = relative(root, directory);
    if (!outputRelative.startsWith('../')) throw new Error('CI output directory must be outside the repository');
    const inputs = buildCiInputs(readFileSync(join(root, 'Dockerfile'), 'utf8'), readFileSync(join(root, 'compose.production.yml'), 'utf8'));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'Dockerfile'), inputs.dockerfile, { flag: 'wx' });
    writeFileSync(join(directory, 'compose.ci-images.json'), `${JSON.stringify(inputs.override, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ images, directory }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildCiInputs };
