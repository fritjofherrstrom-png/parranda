'use strict';
const { isIP } = require('node:net');

function isPublicSourceDestination(value) {
  if (typeof value !== 'string' || value.length > 1000 || value !== value.trim() ||
      /[\u0000-\u0020\u007f]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return false;
  try {
    const url = new URL(value), host = url.hostname;
    const pathname = decodeURIComponent(url.pathname);
    // Normalize before deciding: a DNS trailing dot and encoded separators or
    // letters must not disguise a private host/action. Ambiguous double
    // encodings remain ordinary links, without publication authority.
    if (host.endsWith('.') || /[\u0000-\u001f\u007f\\;]/.test(pathname) || /%[0-9a-f]{2}/i.test(pathname)) return false;
    // Query/fragment links may carry private booking or login capabilities.
    // Unsupported destinations remain ordinary Live, without share authority.
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash && !url.port && !isIP(host) && !host.includes(':') &&
      host.includes('.') && !/(?:^|\.)(?:localhost|local|localdomain|internal|invalid|test|home\.arpa)$/.test(host) &&
      !/(?:^|\/)(?:login|signin|auth|session|checkout|payment|reset-password|private|download-ticket)(?:\/|$)/i.test(pathname);
  } catch (_) { return false; }
}

module.exports = { isPublicSourceDestination };
