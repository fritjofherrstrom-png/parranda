import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = resolve(HERE, 'helpers');

// Test the actual mount path in another Node process. Every node:test file
// imports in its own process, so a shared outfile lets one esbuild overwrite
// another process's module just as the latter imports it.
test('each planner harness process builds its own disposable ES module', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { existsSync } from 'node:fs';
    import { resolve } from 'node:path';
    import { mountPlanner } from './helpers/planner-harness.mjs';
    const harness = await mountPlanner();
    const ownBundle = resolve('helpers', '.planner-harness-bundle.' + process.pid + '.mjs');
    assert.ok(existsSync(ownBundle), 'the component bundle belongs to this process');
    harness.unmount();
    console.log(process.pid);
  `], { cwd: HERE, encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.status, 0, child.stderr);
  const pid = Number(child.stdout.trim());
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.equal(existsSync(resolve(HELPERS, `.planner-harness-bundle.${pid}.mjs`)), false,
    'the process removes its own bundle on exit');
});
