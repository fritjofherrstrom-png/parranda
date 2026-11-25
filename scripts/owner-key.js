#!/usr/bin/env node
"use strict";

/**
 * Make the owner key and the hash the server checks it against.
 *
 *   node scripts/owner-key.js
 *
 * Prints a new random key once (keep it in a password manager) and the line to
 * put in the server's environment. The server only ever holds the hash.
 * Running it again makes a new key and signs every existing owner session out
 * once the new hash is in place.
 */

const { randomBytes } = require("node:crypto");
const { hashOwnerKey } = require("../server/owner/owner-auth");

function main(argv = process.argv.slice(2), out = console) {
  const nIndex = argv.indexOf("--n");
  const N = nIndex >= 0 ? Number(argv[nIndex + 1]) : undefined;
  const key = randomBytes(32).toString("base64url");
  out.log(`Key: ${key}`);
  out.log(`PARRANDA_OWNER_KEY_HASH=${hashOwnerKey(key, N ? { N } : {})}`);
  out.log("Keep the key in your password manager; it is not shown again and the server never stores it.");
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
