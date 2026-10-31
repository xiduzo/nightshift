/**
 * Test helpers of `@nightshift/devices`: the engine's test options with
 * the peers' own (`withPeers`), the Host's own router in memory behind
 * `HostClient` (`inMemoryHost`), the Host's documents in memory behind
 * the document channel (`memoryDocuments`), a Host with a few procedures for one test
 * (`partialHostClient`), and a Host with its paired Device in one process
 * (`pairedReplicas`).
 */

export {
	inMemoryHost,
	inMemoryHostClient,
	type MemoryHost,
} from "./in-memory-host";
export { type MemoryNetwork, memoryDocuments } from "./memory-documents";
export { type PairedReplicas, pairedReplicas } from "./paired";
export {
	type PartialHostClient,
	partialHostClient,
} from "./partial-host-client";
export { withPeers } from "./peers";
