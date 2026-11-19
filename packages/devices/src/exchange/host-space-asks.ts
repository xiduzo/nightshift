import { PinNotHereError, type StartRunInput } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import type { Caller } from "../contract";
import type { HostShared } from "./host-deps";
import { mergePersonalHere } from "./personal-merge";
import type { HostExchange } from "./types";

/** What a person reads when the run of an output they pinned has not reached this Host yet. */
export const pinNotOnHost = (nodeId: string) =>
	`The output you pinned on "${nodeId}" is not on the computer that keeps this Space yet. Try again in a moment.`;

/**
 * What a Device asks of the Host's Spaces (`sync`): a run to start, the
 * Devices of a project, its Offers, its Projects and Clones, and the
 * merge of its personal Space.
 */
export function hostSpaceAsks(
	shared: HostShared,
): Pick<
	HostExchange,
	| "startRun"
	| "startTest"
	| "devices"
	| "offer"
	| "withdrawOffer"
	| "addProject"
	| "addWithoutFolder"
	| "addClone"
	| "setClones"
	| "mergePersonal"
> {
	const { deps, door } = shared;
	const { db, engine, registry } = deps;

	/** Starts a run placed on another Device, for the Caller's Person: this Host walks it. */
	async function startFor(
		caller: Caller,
		input: StartRunInput & { spaceId: string },
	): Promise<{ runId: string }> {
		return { runId: (await door.start(caller, input)).id };
	}

	return {
		async addProject(caller, input) {
			await caller.may(input.spaceId, { project: ["add"] });
			return engine.projects.addFromRemote(input.spaceId, {
				name: input.name,
				remote: input.remote,
			});
		},

		async addWithoutFolder(caller, input) {
			await caller.may(input.spaceId, { project: ["add"] });
			return engine.projects.defineWithoutFolder(input.spaceId, {
				name: input.name,
			});
		},

		async addClone(caller, input) {
			await caller.may(input.spaceId, { project: ["add"] });
			await engine.projects.recordClone(input.spaceId, {
				projectId: input.projectId,
				deviceId: caller.deviceId,
				deviceName: input.deviceName,
			});
		},

		async setClones(caller, input) {
			await caller.may(input.spaceId, { project: ["add"] });
			// The Device's own name and kind, as it says them each time it links.
			await registry.describe(caller.deviceId, {
				name: input.deviceName,
				dev: input.dev === true,
				machine: input.machine,
			});
			// Only the Caller's own Device: never another Device's Clones.
			return engine.projects.setClones(input.spaceId, {
				deviceId: caller.deviceId,
				deviceName: input.deviceName,
				projectIds: input.projectIds,
			});
		},

		async offer(caller, input) {
			await caller.may(
				input.spaceId,
				{ offer: ["make"] },
				"Your role in this Space does not let you offer profiles.",
			);
			await engine.offers.publish({
				...input,
				profileName: input.profileName ?? input.profile,
				deviceId: caller.deviceId,
				by: caller.personId,
			});
		},

		async withdrawOffer(caller, input) {
			// The Device's owner withdraws its own Offer, whatever their role now.
			if (!(await caller.member(input.spaceId))) {
				throw new Refusal("not-found", "That Space does not exist.");
			}
			await engine.offers.withdraw({
				...input,
				deviceId: caller.deviceId,
				by: caller.personId,
			});
		},

		startRun: startFor,

		async startTest(caller, input) {
			// The Device found each pinned output in its own log first: one
			// that is not here yet is on its way (ADR 27).
			return startFor(caller, input).catch((error: unknown) => {
				if (error instanceof PinNotHereError) {
					throw new Refusal("unavailable", pinNotOnHost(error.nodeId));
				}
				throw error;
			});
		},

		devices: (caller, input) => door.devices(caller, input),

		async mergePersonal(caller, input) {
			// A Guest Host never merges: it keeps only shared Spaces.
			if (!caller.device.homeHost) {
				throw new Refusal(
					"forbidden",
					"This Host is not the home Host of this device. Only a home Host takes its personal Space.",
				);
			}
			return mergePersonalHere(
				{
					db,
					projects: engine.projects,
					hostedElsewhere: async (spaceId) =>
						(await engine.hostSpaces.hostOf(spaceId)) !== null,
				},
				caller,
				{ name: caller.device.name },
				input,
			);
		},
	};
}
