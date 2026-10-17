'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const script = path.join(root, 'scripts/check-native-runtime.js');
const lock = require('../package-lock.json');
const lockedVersion = lock.packages['node_modules/@duckdb/node-api'].version;

function runGuard(t, preloadSource) {
  assert.ok(fs.existsSync(script), 'native SQL packaging gate is missing');
  const args = ['--require', path.join(__dirname, 'helpers/no-live-network.js')];
  if (preloadSource) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-native-guard-test-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const preload = path.join(temporary, 'preload.cjs');
    fs.writeFileSync(preload, preloadSource);
    args.push('--require', preload);
  }
  return spawnSync(process.execPath, [...args, script], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
}

// Only the native resource boundary is replaced here, so failure paths can be
// exercised without corrupting the real installed binary or sharing resources.
function resourceFixture(failure) {
  assert.ok(fs.existsSync(script), 'native SQL packaging gate is missing');
  const calls = [];
  const fail = stage => { if (failure === stage) throw new Error(stage); };
  const connection = {
    async runAndReadAll(sql) {
      calls.push(['query', sql]);
      fail('query');
      return { getRowObjectsJson() {
        calls.push(['rows']);
        fail('rows');
        return failure === 'invalid_rows' ? [{ native_ready: 0 }] :
          [{ native_ready: 1, engine_version: 'v1.5.5' }];
      } };
    },
    closeSync() { calls.push(['connection_close']); fail('connection_close'); },
  };
  const database = {
    async connect() { calls.push(['connect']); fail('connect'); return connection; },
    closeSync() { calls.push(['database_close']); fail('database_close'); },
  };
  const fixture = new Module(script, module);
  fixture.filename = script;
  fixture.paths = Module._nodeModulePaths(path.dirname(script));
  fixture.require = name => name === '@duckdb/node-api' ? {
    DuckDBInstance: { async create(...args) {
      calls.push(['create', ...args]); fail('create'); return database;
    } },
  } : Module.createRequire(script)(name);
  fixture._compile(fs.readFileSync(script, 'utf8'), script);
  return { check: fixture.exports.checkNativeRuntime, calls };
}

test('native packaging gate executes SQL with the installed locked DuckDB engine', t => {
  const actual = runGuard(t);
  assert.equal(actual.status, 0, actual.stderr);
  assert.equal(actual.stderr, '');
  const result = JSON.parse(actual.stdout);
  assert.equal(result.status, 'native_runtime_ready');
  assert.equal(result.package_version, lockedVersion);
  assert.equal(result.platform, process.platform);
  assert.equal(result.architecture, process.arch);
  assert.deepEqual(result.rows, [{ native_ready: 1, engine_version: 'v1.5.5' }]);
});

test('native packaging gate fails closed when the deep optional platform binary is absent', t => {
  const actual = runGuard(t, `
    const Module = require('node:module');
    const original = Module._load;
    Module._load = function(name, ...args) {
      if (name.startsWith('@duckdb/node-bindings-') && name.endsWith('/duckdb.node')) {
        const error = new Error('simulated missing optional architecture binding');
        error.code = 'MODULE_NOT_FOUND';
        throw error;
      }
      return original.call(this, name, ...args);
    };
  `);
  assert.equal(actual.status, 1, actual.stderr);
  assert.equal(actual.stdout, '');
  assert.deepEqual(JSON.parse(actual.stderr), {
    status: 'native_runtime_unavailable', code: 'MODULE_NOT_FOUND',
  });
});

for (const dependency of ['@duckdb/node-api', '@duckdb/node-bindings']) {
  test(`native packaging gate rejects ${dependency} version drift before native initialization`, t => {
    const actual = runGuard(t, `
      const Module = require('node:module');
      const original = Module._load;
      Module._load = function(name, ...args) {
        if (name === '${dependency}/package.json') return { version: '0.0.0-drift' };
        if (name === '@duckdb/node-api') throw new Error('unexpected_native_initialization');
        return original.call(this, name, ...args);
      };
    `);
    assert.equal(actual.status, 1, actual.stderr);
    assert.equal(actual.stdout, '');
    assert.deepEqual(JSON.parse(actual.stderr), {
      status: 'native_runtime_unavailable', code: 'ERR_ASSERTION',
    });
  });
}

test('native packaging gate bounds the offline database and closes both resources after SQL', async () => {
  const { check, calls } = resourceFixture();
  const result = await check();
  assert.equal(result.status, 'native_runtime_ready');
  assert.deepEqual(calls, [
    ['create', ':memory:', {
      memory_limit: '128MB', threads: '1',
      autoload_known_extensions: 'false', autoinstall_known_extensions: 'false',
    }],
    ['connect'],
    ['query', 'SELECT 1 AS native_ready, version() AS engine_version'],
    ['rows'], ['connection_close'], ['database_close'],
  ]);
});

for (const [failure, expectedCleanup] of [
  ['create', []],
  ['connect', ['database_close']],
  ['query', ['connection_close', 'database_close']],
  ['rows', ['connection_close', 'database_close']],
  ['invalid_rows', ['connection_close', 'database_close']],
  ['connection_close', ['connection_close', 'database_close']],
  ['database_close', ['connection_close', 'database_close']],
]) {
  test(`native packaging gate rejects ${failure} and releases all acquired resources`, async () => {
    const { check, calls } = resourceFixture(failure);
    await assert.rejects(check());
    assert.deepEqual(calls.filter(([stage]) => stage.endsWith('_close')).map(([stage]) => stage), expectedCleanup);
  });
}
