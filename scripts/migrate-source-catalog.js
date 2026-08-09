#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

async function migrateSourceCatalog({
  connectionString = process.env.PARRANDA_SOURCE_CATALOG_DATABASE_URL,
  migrationPath = path.resolve(__dirname, "../migrations/001-pulse-source-profile-catalog.sql"),
  PoolClass = Pool,
} = {}) {
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new Error("source_catalog_database_url_missing");
  }
  const sql = fs.readFileSync(migrationPath, "utf8");
  const pool = new PoolClass({ connectionString: connectionString.trim(), max: 1 });
  try {
    await pool.query(sql);
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
