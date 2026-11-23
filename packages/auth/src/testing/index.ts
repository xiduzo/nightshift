/**
 * Test helpers of `@nightshift/auth`: a Better Auth on a fresh database,
 * the second factor of a Person, and the Host policies a test sets up
 * (`OPEN_HOST`) or expects (`TWO_FACTOR_REQUIRED`). Only tests import this
 * entry. Auth's own tests that need more wires import `./wires` directly.
 */
export { OPEN_HOST, TWO_FACTOR_REQUIRED } from "../host-access";
export { type AuthSandbox, createAuthSandbox } from "./sandbox";
export { codeNow, secretOf, turnOnTwoFactor } from "./two-factor";
export { testRequestAccess, testSpaces, UNOWNED } from "./wires";
