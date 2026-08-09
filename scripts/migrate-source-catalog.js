#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

async function migrateSourceCatalog({
  connectionString = process.env.PARRANDA_SOURCE_CATALOG_DATABASE_URL,
  migrationsDir = path.resolve(__dirname, "../migrations"),
  PoolClass = Pool,
} = {}) {
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new Error("source_catalog_database_url_missing");
  }
  const migrationPaths = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d{3}-[a-z0-9-]+\.sql$/.test(name))
    .sort()
    .map((name) => path.join(migrationsDir, name));
  if (!migrationPaths.length) throw new Error("source_catalog_migrations_missing");
  const pool = new PoolClass({ connectionString: connectionString.trim(), max: 1 });
  try {
    for (const migrationPath of migrationPaths) {
      await pool.query(fs.readFileSync(migrationPath, "utf8"));
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrateSourceCatalog()
    .then(() => process.stdout.write("source catalog migration: ok\n"))
    .catch(() => {
      process.stderr.write("source catalog migration failed\n");
      process.exitCode = 1;
    });
}

module.exports = { migrateSourceCatalog };
