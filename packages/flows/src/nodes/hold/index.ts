/** The Hold family: Wait, Lease and Service. */

export {
	DEFAULT_LEASE_TTL_MINUTES,
	type LeaseNode,
	leaseDefinition,
	leaseNodeSchema,
	leaseSection,
} from "./lease";
export {
	DEFAULT_SERVICE_EVERY_SECONDS,
	DEFAULT_SERVICE_TIMEOUT_MINUTES,
	type ServiceNode,
	serviceDefinition,
	serviceNodeSchema,
	serviceSection,
} from "./service";
export {
	commandWaitOutcome,
	signalRules,
	type WaitCommand,
	type WaitNode,
	type WaitUntil,
	waitCommandOf,
	waitDefinition,
	waitNodeSchema,
	waitSignalOf,
	waitUrlOf,
} from "./wait";
