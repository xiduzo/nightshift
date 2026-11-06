/**
 * The package entry `@nightshift/devices/testing`: what tests of other
 * workspaces use of this package's test helpers. The daemon's test pairs
 * the whole daemon with a Host in memory (`hostInMemory`). The API's test
 * context admits every Device key a test gives (`admitEvery`), as its
 * Host would a paired Device's. The barrel (`index.ts`) serves this
 * package's own tests, with helpers no other workspace imports. Only
 * tests import this entry.
 */

export { admitEvery } from "./caller";
export { hostInMemory } from "./host-in-memory";
