/**
 * Test helpers of `@nightshift/client`: the push contract's Gate key
 * (`gateKey`), the rule that finds a closed Gate's notification
 * (`staleGates`), and the clock fixture `atLocal`. Only tests
 * import this entry.
 */

export { atLocal } from "@nightshift/time/testing";
export { gateKey, staleGates } from "../notifications";
