/**
 * The package entry `@nightshift/devices/testing`: what tests of other
 * workspaces use of this package's test helpers. Today the daemon's test
 * pairs the whole daemon with a Host in memory (`hostInMemory`). The
 * barrel (`index.ts`) serves this package's own tests, with helpers no
 * other workspace imports. Only tests import this entry.
 */

export { hostInMemory } from "./host-in-memory";
