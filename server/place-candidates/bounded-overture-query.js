"use strict";
const { fork } = require('node:child_process');
const path = require('node:path');
const QUERY_TIMEOUT_MS = 45000;
// One native query per web/worker process; cache coalescing handles identical
// windows. Distinct windows are refused, never queued behind a stuck query.
let active = false;
function createBoundedOvertureQuery({ cacheDir = null, spawn = fork, timeoutMs = QUERY_TIMEOUT_MS } = {}) {
  return sql => new Promise((resolve, reject) => {
    if (active) return reject(new Error('overture_busy'));
    active = true;
    let child;
    try {
      child = spawn(path.join(__dirname, 'overture-query-process.js'), [], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        execArgv: ['--max-old-space-size=64'],
      });
    } catch (error) { active = false; return reject(error); }
    let settled = false;
    const finish = (error, rows) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      // Keep the slot until OS process exit, including after timeout.
      if (error) reject(error); else resolve(rows);
    };
    const timer = setTimeout(() => finish(new Error('overture_timeout')), Math.min(QUERY_TIMEOUT_MS, timeoutMs));
    child.once('error', error => { active = false; finish(error); });
    child.once('exit', () => { active = false; finish(new Error('overture_query_exit')); });
    child.once('message', message => {
      if (!Array.isArray(message?.rows) || message.rows.length > 600) return finish(new Error('overture_query_failed'));
      finish(null, message.rows);
    });
    child.send({ sql, cacheDir }, error => { if (error) finish(error); });
  });
}
module.exports = { createBoundedOvertureQuery, QUERY_TIMEOUT_MS };
