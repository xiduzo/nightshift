/**
 * Test helpers of `@nightshift/auth`: a Better Auth on a fresh database,
 * and the second factor of a Person. Only tests import this entry.
 */
export { type AuthSandbox, createAuthSandbox } from "./sandbox";
export { codeNow, secretOf, turnOnTwoFactor } from "./two-factor";
