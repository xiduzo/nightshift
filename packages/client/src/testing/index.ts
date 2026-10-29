/**
 * Test helpers of `@nightshift/client`: the push contract's Gate key
 * (`gateKey`) and the rule that finds a closed Gate's notification
 * (`staleGates`), for a test that checks code which cannot import them,
 * such as the web app's service worker. Only tests import this entry.
 */
export { gateKey, staleGates } from "../notifications";
