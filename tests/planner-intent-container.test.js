'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// The shared intent is required both by the frontend build and the runtime's
// real CommonJS -> ESM imports. CI's normal image build remains the execution
// acceptance; these checks prevent dropping the directory in either stage.
const dockerfile = readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
const stages = dockerfile.split(/^FROM /m).slice(1);
const copyShared = /^COPY(?:\s+--\S+)*\s+shared\/?\s+(?:\.\/|\/app\/)?shared\/?\s*$/m;

for (const stageName of ['build', 'runtime']) {
  test(`container ${stageName} stage includes the shared planner intent`, () => {
    const stage = stages.find(value => new RegExp(`^.* AS ${stageName}\\s*$`, 'm').test(value));
    assert.ok(stage, `the ${stageName} stage exists`);
    assert.match(stage, copyShared, 'shared modules must be present inside the image, not only the host worktree');
    if (stageName === 'build') {
      assert.ok(stage.search(copyShared) < stage.indexOf('RUN npm run check:frontend'), 'copy shared modules before frontend typecheck/build');
    }
  });
}
