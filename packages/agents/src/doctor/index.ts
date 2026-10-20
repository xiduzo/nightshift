/**
 * Install checks: is a program on this computer, which version, and whose
 * login. Read-only. A harness's own check is in its folder, on `baseCheck`.
 */
export { baseCheck, type CliCheck, checkCustomAgent } from "./checks";
export { firstLine, probe, resolveBin } from "./probe";
