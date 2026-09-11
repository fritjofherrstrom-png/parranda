"use strict";
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const QUERY_TIMEOUT_MS = 45000;
const MAX_TEMP_DIRECTORY_SIZE = '64MiB';
// One native query per web/worker process; cache coalescing handles identical
// windows. Distinct windows are refused, never queued behind a stuck query.
let activeChild = null;
function createBoundedOvertureQuery({
  cacheDir = null,
  spawn = fork,
  timeoutMs = QUERY_TIMEOUT_MS,
  tempRoot = os.tmpdir(),
} = {}) {
  return (sql, { signal } = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('overture_cancelled'));
    if (activeChild) return reject(new Error('overture_busy'));
    let tempDir;
    let child;
    try {
      tempDir = fs.mkdtempSync(path.join(tempRoot, 'parranda-overture-query-'));
      child = spawn(path.join(__dirname, 'overture-query-process.js'), [], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        execArgv: ['--max-old-space-size=64'],
      });
    } catch (error) {
      if (tempDir) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      }
      return reject(error);
    }
    activeChild = child;
    let settled = false;
    let timer;
    const removeTempDir = () => {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    };
    const release = () => {
      if (activeChild === child) activeChild = null;
      removeTempDir();
    };
    const finish = (error, rows) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try { child.kill('SIGKILL'); } catch (_) {}
      // Keep the slot until OS process exit, including after timeout.
      if (error) reject(error); else resolve(rows);
    };
    const abort = () => finish(new Error('overture_cancelled'));
    timer = setTimeout(() => finish(new Error('overture_timeout')), Math.min(QUERY_TIMEOUT_MS, timeoutMs));
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', error => finish(error));
    child.once('close', () => {
      release();
      finish(new Error('overture_query_exit'));
    });
    child.once('message', message => {
      if (!Array.isArray(message?.rows) || message.rows.length > 600) return finish(new Error('overture_query_failed'));
      finish(null, message.rows);
    });
    try {
      child.send({ sql, cacheDir, tempDir, maxTempDirectorySize: MAX_TEMP_DIRECTORY_SIZE }, error => {
        if (error) finish(error);
      });
    } catch (error) { finish(error); }
  });
}
module.exports = { createBoundedOvertureQuery, QUERY_TIMEOUT_MS, MAX_TEMP_DIRECTORY_SIZE };
