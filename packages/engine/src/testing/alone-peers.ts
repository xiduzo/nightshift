import type { OwnDevice, PeerContext, Peers, PlacedDevice } from "../contract";
import type { PeersFactory } from "../contract/peers";
import { followOwnStep } from "../log";
import { NOT_ON_THIS_COMPUTER } from "../projects";

/**
 * The peers of a computer that is alone: no other Device, no Host, no
 * Offers. Every step runs here, and every Space is this Replica's own.
 * The engine's own tests walk with it. The real peers are
 * `@nightshift/devices`, whose tests cover the engine among other Devices.
 */
export const alonePeers: PeersFactory = (context: PeerContext): Peers => {
	const { device, log } = context;

	async function here(spaceId: string, projectId: string): Promise<OwnDevice> {
		const project = await context.project(projectId, spaceId);
		return {
			deviceId: await log.walkerId(),
			name: device.name,
			thisDevice: true,
			online: true,
			hasClone: project.repoPath !== null,
		};
	}

	const ownDevices = async (
		spaceId: string,
		_personId: string,
		projectId: string,
	) => [await here(spaceId, projectId)];

	return {
		placement: {
			deviceFor: () => device,
			deviceById: () => device,
			async place(input) {
				const walker: PlacedDevice = {
					device,
					id: device.id,
					name: device.name,
					thisDevice: true,
					hasClone: input.project.repoPath !== null,
				};
				const self = await log.walkerId();
				if (
					input.deviceId !== undefined &&
					input.deviceId !== device.id &&
					input.deviceId !== self
				) {
					throw new Error(
						"That device cannot take runs from this computer. Pair it with this computer, or choose another device.",
					);
				}
				return {
					run: walker,
					walker,
					async deviceNamed(name) {
						if (name === device.name) return walker;
						throw new Error(
							`The flow names the device "${name}", but you have no device of that name, and none of that name offers profiles to this Space. Check the node's device.`,
						);
					},
				};
			},
			ownDevices,
			devicesFor: ownDevices,
			async placements(spaceId, personId, projectId) {
				return (await ownDevices(spaceId, personId, projectId))
					.filter((d) => d.online && d.hasClone)
					.map(({ deviceId, name, thisDevice }) => ({
						deviceId,
						name,
						thisDevice,
					}));
			},
			async flowsElsewhere() {
				throw new Error(NOT_ON_THIS_COMPUTER);
			},
			async loadNames() {},
		},
		offers: {
			refusal: () => null,
			async schedulesWithOffers(_project, _spaceId, actor, schedules) {
				if (!actor || !schedules.some((s) => s.device !== undefined)) {
					return [...schedules];
				}
				return schedules.map(({ person: _old, ...rest }) => rest);
			},
		},
		hostOf: async () => null,
		personOnHost: async () => null,
		runs: {
			async walkers(_spaceId, ids) {
				const self = await log.walkerId();
				return new Map(
					[...new Set(ids)].map((id) => {
						const mine = id === self || id === device.id;
						return [
							id,
							{ id, name: mine ? device.name : null, thisDevice: mine },
						];
					}),
				);
			},
			pendingCommands: async () => [],
			// Every run is walked here: its own file, then live.
			stepEntries: (step, afterSeq, signal) =>
				followOwnStep(
					{
						bus: context.bus,
						stepEnded: context.stepEnded,
						ownEntries: context.history.ownTranscript,
						archived: async () => null,
					},
					step,
					afterSeq,
					signal,
				),
			async keepWalk() {
				throw new Error("This computer is alone. It has no archive.");
			},
			archived: async () => null,
		},
		async pathsFor(_spaceId, actor) {
			const viewer = actor?.personId ?? null;
			return async (summary) => {
				if (viewer === null) return summary;
				const owner = summary.device.thisDevice ? context.ownerId() : null;
				if (owner === viewer) return summary;
				return {
					...summary,
					worktreePath: "",
					...("takeOverCommand" in summary ? { takeOverCommand: null } : {}),
				};
			};
		},
	};
};
