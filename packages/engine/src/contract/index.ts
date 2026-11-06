/**
 * What the engine shares with its callers and the Devices, in words every
 * vertical may name: who acts (`Actor`), a change of Members
 * (`MemberChange`), a run start and its schema (`StartRunInput`,
 * `startRunInputSchema`), the Command (`command.ts`: what a person asks of
 * a run, the kinds that travel to its Walker, the permission each needs
 * and its wire schema), where a run can be placed (`Placement`,
 * `OwnDevice`, `NodeToPlace`), and the ports a vertical asks of the
 * devices: the Device rows (`DeviceDirectory`), the Hosts (`Relay`, and
 * `HostUnreachableError` when one cannot be reached), the leases a Host
 * keeps (`LeaseHost`, ADR 7) and the Offer rule of a schedule (`OffersPort`). It imports no other vertical.
 */

export type { Actor, MemberChange } from "./actor";
export {
	COMMAND_KINDS,
	commandOf,
	permissionOf,
	type RunActionRequest,
	type RunCommandInput,
	type RunCommandKind,
	requestOf,
	runCommandSchema,
} from "./command";
export type { DeviceDirectory } from "./directory";
export type {
	LeaseAnswer,
	LeaseHolder,
	LeaseHost,
	LeaseTake,
	SpaceLease,
} from "./leases";
export type { OffersPort } from "./offers";
export type {
	DeviceProfile,
	NodeToPlace,
	OwnDevice,
	Placement,
} from "./placement";
export {
	HOST_UNREACHABLE,
	HostUnreachableError,
	OLDER_HOST,
	OlderHostError,
	type Relay,
} from "./relay";
export { type StartRunInput, startRunInputSchema } from "./start-run";
