import type { createDevices } from "./devices";
import type { DevicesDeps } from "./devices-runtime";
import type { Handover } from "./handover";
import type { DeviceLinks, HostLinks } from "./links";
import { wireSecrets as wireSecretsSlice } from "./secrets";
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
	return wireSecretsSlice({
		hostLinks,
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
	return wireSecretsSlice({
		hostLinks: at.hostLinks,
		own: deps.ownSecrets,
		ownerId: deps.ownerId,
	}).keep({
		db: deps.db,
		secretsKey: deps.secretsKey,
		selfId: deps.self.id,
		links: at.links,
		/** Where the engine has a Project (a removed one too) and a run. */
		places: {
			spaceOf: (projectId) => engine.projects.spaceOf(projectId),
			runPlace: (runId) => engine.runPlace(runId),
		},
		hostOf: (spaceId) => engine.hostSpaces.hostOf(spaceId),
		devices: engine.devices,
		// The calls this Host sends to its placed Devices.
		work: at.handover.hub,
		offersInto: async (deviceId, spaceId) =>
			(await engine.offers.list(spaceId)).some(
				(offer) => offer.deviceId === deviceId,
			),
	});
}
