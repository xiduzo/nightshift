/**
 * Test helpers of `@nightshift/client`: the push contract's Gate key
 * (`gateKey`), the rule that finds a closed Gate's notification
 * (`staleGates`), and the clock fixtures `atLocal` and `utc`. Only tests
 * import this entry.
 */

export { atLocal, utc } from "@nightshift/time/testing";
export { gateKey, staleGates } from "../notifications";
