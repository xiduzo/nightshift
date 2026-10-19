/**
 * Replaces `varlock/env` in the desktop bundle and the `nightshift` binary:
 * the server's `ENV` reads `process.env`, which `daemon-env.ts` fills
 * before the server loads. Values stay strings, as the server already
 * compares them (`=== "true"`, `=== "off"`).
 */
export const ENV = process.env;
