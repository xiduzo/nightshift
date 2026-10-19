/**
 * Replaces `varlock/auto-load` in the desktop bundle. The packaged app has no
 * `.env` files and no varlock CLI to resolve them: `daemon-env.ts` sets
 * `process.env` before the server loads, and `varlock-env.ts` reads it.
 */
export {};
