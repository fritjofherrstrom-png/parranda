#!/usr/bin/env node
'use strict';
// Build-time proof of the native capability used by the place-source worker.
// npm optional-platform installation and HTTP health alone cannot attest this.
const assert = require('node:assert/strict');

async function checkNativeRuntime() {
  const lock = require('../package-lock.json');
  const api = require('@duckdb/node-api/package.json');
  const binding = require('@duckdb/node-bindings/package.json');
  assert.equal(api.version, lock.packages['node_modules/@duckdb/node-api'].version);
  assert.equal(binding.version, lock.packages['node_modules/@duckdb/node-bindings'].version);
  const { DuckDBInstance } = require('@duckdb/node-api');
  let database, connection;
  try {
    database = await DuckDBInstance.create(':memory:', {
      memory_limit: '128MB', threads: '1',
      autoload_known_extensions: 'false', autoinstall_known_extensions: 'false',
    });
    connection = await database.connect();
    const rows = (await connection.runAndReadAll('SELECT 1 AS native_ready, version() AS engine_version')).getRowObjectsJson();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].native_ready, 1);
    return { status: 'native_runtime_ready', package_version: api.version, platform: process.platform,
      architecture: process.arch, rows };
  } finally {
    try { connection?.closeSync(); } finally { database?.closeSync(); }
  }
}

if (require.main === module) {
  checkNativeRuntime().then(result => {
    process.stdout.write(JSON.stringify(result) + '\n');
  }).catch(error => {
    process.stderr.write(JSON.stringify({ status: 'native_runtime_unavailable', code: error.code || error.name }) + '\n');
    process.exitCode = 1;
  });
}
module.exports = { checkNativeRuntime };
