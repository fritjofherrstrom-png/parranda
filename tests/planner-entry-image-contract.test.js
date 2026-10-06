const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('shared planner URL dependency is packaged for both frontend build and backend runtime', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  const [build, runtime] = dockerfile.split('FROM node:22-bookworm-slim AS runtime');
  assert.match(build, /COPY[^\n]*\bplanner-entry\.js\b[^\n]*\bplanner-entry\.d\.ts\b[^\n]*\.\//);
  assert.match(runtime, /COPY --chown=node:node[\s\S]*\bplanner-entry\.js\s*\\/);
});
