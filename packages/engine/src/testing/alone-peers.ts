import type { OwnDevice } from "../contract";
import { followOwnStep } from "../log";
import {
	type PeerContext,
	type Peers,
	type PlacedDevice,
	planNodes,
} from "../run";
import type { PeersFactory } from "../run/peers";

/**
 * The peers of a computer that is alone: no other Device, no Host, no
 * Offers. Every step runs here, and every Space is this Replica's own:
 * a run's plan has this computer only, and its starter's Person as is.
 * The engine's own tests walk with it. The real peers are
 * `@nightshift/devices`, whose tests cover the engine among other Devices.
 */
export const alonePeers: PeersFactory = (context: PeerContext): Peers => {
	const { device } = context;

	async function here(spaceId: string, projectId: string): Promise<OwnDevice> {
		const project = await context.projects.find(projectId, spaceId);
		return {
			deviceId: await context.walkerId(),
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
			async plan({ start, project }) {
				const walker: PlacedDevice = {
					device,
					id: device.id,
					name: device.name,
					thisDevice: true,
					hasClone: project.repoPath !== null,
				};
				const self = await context.walkerId();
				// No other Device: the node walk refuses every other one.
				return planNodes(
					start,
					{
						walker,
						byId: async (id) =>
							id === device.id || id === self ? walker : null,
						byName: async (name) => (name === device.name ? walker : null),
						profileDevice: async (id) =>
							id === device.id || id === self ? walker : null,
						profileFor: context.profiles.here,
						lastKnown: context.profiles.lastKnown,
						flows: context.flows,
					},
					start.startedBy ?? context.ownerId(),
				);
			},
			deviceFor: () => device,
			deviceById: () => device,
			// No Device of the Person's but this computer.
			moveTo: async () => null,
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
		},
		offers: {
			async schedulesWithOffers(_project, _spaceId, actor, schedules) {
				if (!actor || !schedules.some((s) => s.device !== undefined)) {
					return [...schedules];
				}
				return schedules.map(({ person: _old, ...rest }) => rest);
			},
		},
		runs: {
			async walkers(_spaceId, ids) {
				const self = await context.walkerId();
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
			pendingCommands: async () => new Map(),
			// Every run is walked here: its own file, then live.
			stepEntries: (step, afterSeq, signal) =>
				followOwnStep(
					{
						watch: context.history.watch,
						stepEnded: async (step) =>
							(await context.runs.stepStamp(step))?.ended === true,
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
