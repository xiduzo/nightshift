/** What a procedure of the Host's contract is built from: its refusals, its Device key permission, and an output schema that describes a reply and never changes it. */

export { described, describedStream, exact } from "./described";
export { hostAnswer, ODD_HOST_ANSWER } from "./host-answer";
export {
	archive,
	deviceId,
	deviceName,
	type HostProcedureMeta,
	keyRefusalSchema,
	machineFingerprintSchema,
	NOT_A_HOST,
	procedure,
	refusalDataSchema,
	relay,
	sync,
} from "./host-procedure";
