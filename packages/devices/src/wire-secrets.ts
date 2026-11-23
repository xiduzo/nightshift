import type { DevicesDeps } from "./devices-runtime";
import type { Handover } from "./handover";
import type { createDevices } from "./host";
import type { DeviceLinks, HostLinks } from "./links";
import {
	createProjectSecretsHost,
	deviceProjectSecrets,
	wireCalls,
	wireKept,
	wireMoves,
	wirePersonal,
} from "./secrets";
import type { PeerEngine } from "./wire-peers-engine";

/**
 * The secrets block of the devices runtime (`startDevices`): the secrets
 * this computer keeps, the ones it reads at its Hosts, and its moves of
 * a secret (ADR 13).
 */

/** The secret pieces of the Devices page (`createDevices`). */
export type SecretsOfDevices = Pick<
	Parameters<typeof createDevices>[0],
	"personalSecrets" | "projectSecrets" | "secretMoves" | "moves"
>;

/** The secret calls of its Home Host: this computer moves its own value (ADR 13). */
export function wireSecretCalls(
	deps: Pick<DevicesDeps, "ownSecrets" | "ownerId">,
	hostLinks: HostLinks,
) {
	return wireMoves({
		// Serving a call asks only for the home Host: no link is called.
		calls: wireCalls({ hostLinks, links: () => ({ get: () => undefined }) }),
		own: deps.ownSecrets,
		ownerId: deps.ownerId,
	}).serve;
}

/**
 * The secrets this computer keeps and reads: for the engine's connection
 * store (`personalSecrets`, `projectSecrets`) and for the Devices page.
 */
export function wireSecrets(
	deps: Pick<
		DevicesDeps,
		"db" | "secretsKey" | "ownerId" | "self" | "ownSecrets"
	>,
	engine: PeerEngine,
	at: {
		hostLinks: HostLinks;
		links(): DeviceLinks;
		handover: Pick<Handover, "hub">;
	},
) {
	const { db, ownerId, self } = deps;
	const { hostLinks, links, handover } = at;
	/** The secrets this computer keeps, sealed at rest. */
	const kept = wireKept({ db, secretsKey: deps.secretsKey });
	const personalStore = kept.personal;
	const projectStore = kept.projects;
	const spaceStore = kept.spaces;
	/** Where the engine has a Project (a removed one too) and a run. */
	const places = {
		spaceOf: (projectId: string) => engine.projects.spaceOf(projectId),
		runPlace: (runId: string) => engine.runPlace(runId),
	};
	const projectSecrets = deviceProjectSecrets({
		db,
		places,
		hostSpaces: engine.hostSpaces,
		links,
		store: projectStore,
		spaceStore,
		ownerId,
	});
	/** The Personal secrets: as a Home Host, and the owner's, at the Home Host or kept here. */
	/** The calls of this computer's Hosts, over its links. */
	const calls = wireCalls({ hostLinks, links });
	const personal = wirePersonal({
		store: personalStore,
		calls,
		ownerId,
		selfId: self.id,
	});
	const personalSecrets = personal.device;
	/** The moves of a secret saved on another of the owner's Devices. */
	const moves = wireMoves({ calls, own: deps.ownSecrets, ownerId }).relay({
		devices: engine.devices,
		work: handover.hub,
		selfId: self.id,
	});
	const ofDevices = {
		personalSecrets: personal.host,
		projectSecrets: createProjectSecretsHost({
			db,
			places,
			store: projectStore,
			spaceStore,
			hostOf: (spaceId) => engine.hostSpaces.hostOf(spaceId),
			// The calls this Host sends to its placed Devices.
			work: handover.hub,
			offersInto: async (deviceId, spaceId) =>
				(await engine.offers.list(spaceId)).some(
					(offer) => offer.deviceId === deviceId,
				),
		}),
		// As a Home Host: a paired Device asks to move a secret on another.
		secretMoves: moves.host,
		// The owner's moves of a secret on another of their Devices.
		moves: moves.device,
	};
	return { projectSecrets, personalSecrets, ofDevices };
}
