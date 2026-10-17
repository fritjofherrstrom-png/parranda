"use strict";

// Disposable native acquisition process. The parent can terminate HTTP/native
// work at the deadline even if DuckDB is stuck inside initialization or a read.
if (require.main === module) process.once('message', async ({ sql, cacheDir, tempDir, maxTempDirectorySize, prefetch }) => {
  try {
    const { DuckDBInstance } = require('@duckdb/node-api');
    const instance = await DuckDBInstance.create(':memory:', { memory_limit: '128MB', threads: '1' });
    const conn = await instance.connect();
    const sqlPath = value => String(value).replace(/'/g, "''");
    if (!tempDir || maxTempDirectorySize !== '64MiB') throw new Error('missing_resource_boundary');
    await conn.run(`SET temp_directory='${sqlPath(tempDir)}'; SET max_temp_directory_size='${prefetch ? '32MiB' : maxTempDirectorySize}'`);
    if (cacheDir) {
      try {
        const fs = require('node:fs');
        const extensionDir = require('node:path').join(cacheDir, 'duckdb-extensions');
        fs.mkdirSync(extensionDir, { recursive: true });
        await conn.run(`SET extension_directory='${sqlPath(extensionDir)}'`);
      } catch (_) {
        // A read-only or invalid operator cache must not disable DuckDB's safe
        // default extension location. Query/setup failures still fail closed.
      }
    }
    let query = sql, sourceAssets;
    if (prefetch) {
      const { prefetchOvertureParquet, localizeOvertureSql, validateOverturePrefetchPlan } = require('./overture-parquet-prefetch');
      const plan = validateOverturePrefetchPlan(prefetch);
      const materialized = await prefetchOvertureParquet({ conn, ...plan, tempDir });
      query = localizeOvertureSql(sql, materialized.sqlPaths);
      // All remote reads belong to the pinned and bounded range acquisition.
      if (/s3:\/\/|https?:\/\//i.test(query)) throw new Error('unlocalized_overture_query');
      const remainingTempBytes = 64 * 1024 * 1024 - materialized.physicalBytes;
      if (remainingTempBytes <= 0) throw new Error('missing_resource_boundary');
      await conn.run(`SET max_temp_directory_size='${remainingTempBytes}B'`);
      sourceAssets = materialized.sourceAssets;
    } else await conn.run("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET http_timeout=10; SET http_retries=0");
    const reader = await conn.runAndReadAll(query);
    const rows = reader.getRowObjectsJson();
    const message = { rows, ...(sourceAssets ? { sourceAssets } : {}) };
    if (rows.length > 600 || Buffer.byteLength(JSON.stringify(message)) > 2 * 1024 * 1024) throw new Error('query_result_too_large');
    process.send(message);
  } catch (_) { process.send({ error: 'query_failed' }); }
});
