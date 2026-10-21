/**
 * Replaces `varlock/auto-load` in the `nightshift` binary
 * (`scripts/build-binary.ts`), which runs without the varlock CLI and has
 * no `.env` files: `prepareDaemonEnv` fills `process.env` before the daemon
 * starts, and `varlock-env.ts` reads it.
 */
export {};
