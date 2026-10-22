/**
 * Test helpers of `@nightshift/devices`: the engine's test options with
 * the peers' own (`withPeers`), a Host in memory behind `HostClient`
 * (`inMemoryHost`), and a Host with its paired Device in one process
 * (`pairedReplicas`).
 */

export {
	inMemoryHost,
	inMemoryHostClient,
	type MemoryHost,
} from "./in-memory-host";
export { type PairedReplicas, pairedReplicas } from "./paired";
export { withPeers } from "./peers";
