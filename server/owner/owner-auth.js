"use strict";

/**
 * The owner's sign-in: one secret key, checked against a scrypt hash, then a
 * signed cookie for 30 days. Only the owner can write corrections or read the
 * report queue; the public site never shows or answers anything different.
 *
 * - The key never lives on the server. PARRANDA_OWNER_KEY_HASH holds
 *   `scrypt$<N>$<salt>$<hash>` (scripts/owner-key.js makes one).
 * - The cookie is `<expires>.<nonce>.<hmac>`, HttpOnly, SameSite=Strict, Secure
 *   (except on plain-http localhost), signed with a random secret kept beside
 *   the corrections and bound to the key hash: changing the key signs every
 *   session out.
 * - Without a key hash, or without a corrections directory, there is no owner
 *   at all and every owner route is a plain 404.
 */

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { createHmac, randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");

const COOKIE_NAME = "parranda_owner";
const SECRET_FILE = "owner-session.key";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
// A session is renewed when it is used with less than this left.
const RENEW_BELOW_MS = 15 * 24 * 60 * 60 * 1000;
const DEFAULT_N = 16384;
const MAX_N = 131072;
const MAX_KEY_LENGTH = 512;
const HASH_FORMAT = /^scrypt\$(\d{1,7})\$([A-Za-z0-9_-]{16,64})\$([A-Za-z0-9_-]{32,128})$/;

function scryptOptions(N) {
  // 128 * N * r bytes of memory; the default ceiling (32 MiB) is too low past N=2^15.
  return { N, r: 8, p: 1, maxmem: 256 * N * 8 };
}

/** `scrypt$N$salt$hash` for a key. Used by scripts/owner-key.js and tests. */
function hashOwnerKey(key, { salt = randomBytes(16), N = DEFAULT_N } = {}) {
  const hash = scryptSync(String(key), salt, 32, scryptOptions(N));
  return `scrypt$${N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function parseKeyHash(value) {
  const match = typeof value === "string" ? HASH_FORMAT.exec(value.trim()) : null;
  if (!match) return null;
  const N = Number(match[1]);
  // N must be a power of two; a huge N would make every sign-in a memory bomb.
  if (N < 1024 || N > MAX_N || (N & (N - 1)) !== 0) return null;
  return { N, salt: Buffer.from(match[2], "base64url"), hash: Buffer.from(match[3], "base64url") };
}

function verifyKey(key, parsed) {
  if (typeof key !== "string" || !key || key.length > MAX_KEY_LENGTH || !parsed) return false;
  const candidate = scryptSync(key, parsed.salt, parsed.hash.length, scryptOptions(parsed.N));
  return timingSafeEqual(candidate, parsed.hash);
}

// The signing secret is random, written once beside the corrections with
// owner-only permissions, so sessions survive restarts and are shared by web
// and worker. If it cannot be written, sessions last until the next restart.
function sessionSecret(directory, fs, logger) {
  const file = nodePath.join(directory, SECRET_FILE);
  try {
    fs.mkdirSync(directory, { recursive: true });
    try { fs.writeFileSync(file, randomBytes(32), { flag: "wx", mode: 0o600 }); } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const secret = fs.readFileSync(file);
    if (secret.length >= 32) return secret;
    throw new Error("secret file is too short");
  } catch (error) {
    logger?.warn?.(`[owner-auth] cannot keep ${file} (${error.message}); owner sessions end at restart`);
    return randomBytes(32);
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (name && !(name in cookies)) cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

function isLocalHttp(request) {
  const host = String(request?.headers?.host || "").replace(/:\d+$/, "").toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  return local && !request?.secure;
}

/**
 * A write must come from a page on this same site. Browsers always send Origin
 * on a POST from fetch; a missing or foreign Origin is refused.
 */
function isSameOrigin(request) {
  const origin = request?.headers?.origin;
  if (typeof origin !== "string" || !origin || origin === "null") return false;
  let host = "";
  try { host = new URL(origin).host.toLowerCase(); } catch (_) { return false; }
  const own = [request.headers.host, request.headers["x-forwarded-host"]]
    .flatMap(value => String(value || "").split(","))
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return own.includes(host);
}

function createOwnerAuth({
  keyHash,
  directory,
  fs = nodeFs,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (!keyHash || typeof directory !== "string" || !directory.trim()) return null;
  const parsed = parseKeyHash(keyHash);
  if (!parsed) {
    logger?.warn?.("[owner-auth] PARRANDA_OWNER_KEY_HASH is not a valid scrypt$N$salt$hash value; owner sign-in is off");
    return null;
  }
  const secret = sessionSecret(directory.trim(), fs, logger);
  // Bound to the key hash: a new key signs every existing session out.
  const signingKey = createHmac("sha256", secret).update(`owner-session:${keyHash.trim()}`).digest();
  const sign = value => createHmac("sha256", signingKey).update(value).digest("base64url");

  function issue() {
    const expires = now() + SESSION_MS;
    const value = `${expires}.${randomBytes(12).toString("base64url")}`;
    return { value: `${value}.${sign(value)}`, expires };
  }

  /** The session's expiry time, or null when the cookie is missing, forged or old. */
  function sessionExpiry(request) {
    const raw = parseCookies(request?.headers?.cookie)[COOKIE_NAME];
    const parts = typeof raw === "string" ? raw.split(".") : [];
    if (parts.length !== 3) return null;
    const value = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(sign(value));
    const supplied = Buffer.from(parts[2]);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const expires = Number(parts[0]);
    return Number.isFinite(expires) && expires > now() ? expires : null;
  }

  function cookieHeader(request, value, maxAgeSeconds) {
    return [
      `${COOKIE_NAME}=${value}`,
      "Path=/",
      `Max-Age=${maxAgeSeconds}`,
      "HttpOnly",
      "SameSite=Strict",
      ...(isLocalHttp(request) ? [] : ["Secure"]),
    ].join("; ");
  }

  /** Set a fresh session cookie on the response. */
  function signIn(request, response) {
    const session = issue();
    response.append("Set-Cookie", cookieHeader(request, session.value, Math.floor(SESSION_MS / 1000)));
    return session.expires;
  }

  return {
    verifyKey: key => verifyKey(key, parsed),
    isOwner: request => sessionExpiry(request) !== null,
    signIn,
    signOut(request, response) {
      response.append("Set-Cookie", cookieHeader(request, "", 0));
    },
    /** Renew a session that is in use and past half its life. */
    renew(request, response) {
      const expires = sessionExpiry(request);
      if (expires !== null && expires - now() < RENEW_BELOW_MS) signIn(request, response);
    },
  };
}

module.exports = {
  COOKIE_NAME,
  SECRET_FILE,
  createOwnerAuth,
  hashOwnerKey,
  isSameOrigin,
  parseCookies,
  parseKeyHash,
};
