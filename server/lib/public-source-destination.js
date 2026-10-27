'use strict';
const { isIP } = require('node:net');

function isPublicSourceDestination(value) {
  if (typeof value !== 'string' || value.length > 1000 || value !== value.trim() ||
      /[\u0000-\u0020\u007f]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return false;
  try {
    const url = new URL(value), host = url.hostname;
    // Query/fragment links may carry private booking or login capabilities.
    // Unsupported destinations remain ordinary Live, without share authority.
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash && !url.port && !isIP(host) && !host.includes(':') &&
      host.includes('.') && !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host) &&
      !/(?:^|\/)(?:login|signin|auth|session|checkout|payment|reset-password|private|download-ticket)(?:\/|$)/i.test(url.pathname);
  } catch (_) { return false; }
}

module.exports = { isPublicSourceDestination };
