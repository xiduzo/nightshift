/**
 * What the engine shares with its callers and the Devices, in words every
 * vertical may name: who acts (`Actor`), a change of Members
 * (`MemberChange`), a run start and its schema (`StartRunInput`,
 * `startRunInputSchema`), where a run can be placed (`Placement`,
 * `OwnDevice`, `NodeToPlace`), and the ports a vertical asks of the
 * devices: the Device rows (`DeviceDirectory`), the Hosts (`Relay`) and the
 * Offer rule of a schedule (`OffersPort`). It imports no other vertical.
 */

export type { Actor, MemberChange } from "./actor";
export type { DeviceDirectory } from "./directory";
export type { OffersPort } from "./offers";
export type {
	DeviceProfile,
	NodeToPlace,
	OwnDevice,
	Placement,
} from "./placement";
export type { Relay, RunCommandInput, RunCommandKind } from "./relay";
export { type StartRunInput, startRunInputSchema } from "./start-run";
