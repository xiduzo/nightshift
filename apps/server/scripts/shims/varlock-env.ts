/**
 * Replaces `varlock/env` in the `nightshift` binary: the CLI's `ENV` reads
 * `process.env`, which `prepareDaemonEnv` fills before the daemon starts.
 * Values stay strings, as the daemon already compares them (`=== "true"`,
 * `=== "off"`).
 */
export const ENV = process.env;
