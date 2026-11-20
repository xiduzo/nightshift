import type { DevicesDeps } from "./devices-runtime";
import type { Handover } from "./handover";
import type { createDevices } from "./host";
import type { DeviceLinks, HostLinks } from "./links";
import {
	createPersonalSecretStore,
	createPersonalSecretsHost,
	createProjectSecretStore,
	createProjectSecretsHost,
	createSecretMovesHost,
	createSpaceSecretStore,
	devicePersonalSecrets,
	deviceProjectSecrets,
	deviceSecretMoves,
	secretsCipher,
	serveSecretCall,
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
	return serveSecretCall({
		hostLinks,
		own: deps.ownSecrets,
		ownerId: deps.ownerId,
	});
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
	/** The Personal secrets this computer keeps: as a Home Host, and its owner's without one. */
	const cipher = secretsCipher(deps.secretsKey);
	const personalStore = createPersonalSecretStore({ db, cipher });
	/** The Project secrets this computer keeps: of the Spaces it keeps, as their Host or without one. */
	const projectStore = createProjectSecretStore({ db, cipher });
	/** The Space secrets this computer keeps: of the Spaces it keeps, as their Host or without one. */
	const spaceStore = createSpaceSecretStore({ db, cipher });
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
	const personalSecrets = devicePersonalSecrets({
		hostLinks,
		links,
		store: personalStore,
		ownerId,
		selfId: self.id,
	});
	const ofDevices = {
		personalSecrets: createPersonalSecretsHost({ store: personalStore }),
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
		secretMoves: createSecretMovesHost({
			registry: engine.devices,
			work: handover.hub,
			self: { id: self.id, ownerId, own: deps.ownSecrets },
		}),
		// The owner's moves of a secret on another of their Devices.
		moves: deviceSecretMoves({
			registry: engine.devices,
			work: handover.hub,
			hostLinks,
			links,
			ownerId,
		}),
	};
	return { projectSecrets, personalSecrets, ofDevices };
}
