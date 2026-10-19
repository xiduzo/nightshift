/**
 * Replaces `varlock/auto-load` in the bundles that run without the varlock
 * CLI: the desktop app and the `nightshift` binary. They have no `.env`
 * files: `daemon-env.ts` fills `process.env` before the server loads, and
 * `varlock-env.ts` reads it.
 */
export {};
