import { ROLE_REFUSAL, roleAllows, wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { PersonalSecrets, ProjectSecrets } from "@nightshift/engine";
import type { WorkRelay, WorkReply, WorkRequest } from "../contract";
import type { DeviceLinks, HostLinks } from "../links";
import { wireCalls } from "./calls";
import { wireKept } from "./kept";
import {
	type OwnSecrets,
	type SecretMoves,
	type SecretMovesHost,
	wireMoves,
} from "./moves";
import { type PersonalSecretsHost, wirePersonal } from "./personal";
import { type ProjectSecretsHost, wireProjects } from "./projects";

/**
 * The wiring of the secrets a Host keeps (ADR 13, ADR 18), sealed at rest:
 * the Personal secrets, the Project and Space secrets, and the moves of a
 * secret saved on another of the Person's Devices. It builds the stores
 * and the calls of the Hosts, and fills the ports of the Members and the
 * role rules from this computer's member rows.
 */

/** What the composition gives the secrets first: this computer's Hosts and its own secrets. */
export type SecretsDeps = {
	hostLinks: Pick<HostLinks, "home">;
	/** This computer's own secrets. Without them, it moves none. */
	own: OwnSecrets | undefined;
	/** The Person who owns this computer. */
	ownerId: string;
};

/** What the composition gives the secrets once the engine and the links are there. */
export type KeepDeps = {
	db: Database;
	/** This computer's secrets key (`NIGHTSHIFT_SECRETS_KEY`, else the data folder's). */
	secretsKey: string;
	/** This computer's Device. */
	selfId: string;
	/** Lazy: the links are made after this. */
	links(): Pick<DeviceLinks, "get">;
	/** Where the engine has a Project (a removed one too) and a run. */
	places: {
		spaceOf(projectId: string): Promise<string | null>;
		runPlace(
			runId: string,
		): Promise<{ walkerId: string; spaceId: string; projectId: string } | null>;
	};
	/** The Host that keeps a Space, or null for one this computer keeps. */
	hostOf(spaceId: string): Promise<string | null>;
	/** The Devices paired with this Host. */
	devices: Parameters<ReturnType<typeof wireMoves>["relay"]>[0]["devices"];
	/** This Host's work hub: the calls of runs out to the Devices, and a Device's own stream. */
	work: Pick<WorkRelay, "call" | "online"> & {
		placed(
			deviceId: string,
			run: { spaceId: string; projectId: string; runId: string },
		): boolean;
	};
	/** Whether a Device offers profiles to a Space. */
	offersInto(deviceId: string, spaceId: string): Promise<boolean>;
};

/** The secrets this computer keeps and reads: for the engine's connection store and for the Devices page. */
export type KeptSecrets = {
	personalSecrets: PersonalSecrets;
	projectSecrets: ProjectSecrets;
	ofDevices: {
		personalSecrets: PersonalSecretsHost;
		projectSecrets: ProjectSecretsHost;
		secretMoves: SecretMovesHost;
		moves: SecretMoves;
	};
};

/** The secrets: the secret calls of its Home Host from the start, the rest once the engine is there. */
export type Secrets = {
	/** This computer moves its own value when its Home Host asks (ADR 13). Never throws. */
	serve(
		request: WorkRequest,
		via: { hostId: string },
	): AsyncGenerator<WorkReply>;
	keep(deps: KeepDeps): KeptSecrets;
};

export function wireSecrets(deps: SecretsDeps): Secrets {
	const { ownerId } = deps;
	let linksOf: KeepDeps["links"] | undefined;
	/** The calls of this computer's Hosts. Serving a call asks only for the home Host: no link is called. */
	const calls = wireCalls({
		hostLinks: deps.hostLinks,
		links: () => {
			if (!linksOf) throw new Error("The links to the Hosts are not made yet.");
			return linksOf();
		},
	});
	const moves = wireMoves({ calls, own: deps.own, ownerId });
	return {
		serve: moves.serve,
		keep(late) {
			linksOf = late.links;
			const { db } = late;
			const authSpaces = wireSpaces({ db });
			/** The secrets this computer keeps, sealed at rest. */
			const kept = wireKept({ db, secretsKey: late.secretsKey });
			const personal = wirePersonal({
				store: kept.personal,
				calls,
				ownerId,
				selfId: late.selfId,
			});
			const projects = wireProjects({
				store: kept.projects,
				spaceStore: kept.spaces,
				calls,
				places: late.places,
				spaces: { hostOf: late.hostOf },
				members: {
					roleIn: (personId, spaceId) =>
						authSpaces.findRole({ personId, spaceId }),
					names: (personIds) =>
						authSpaces.members.listPersonNames({ ids: personIds }),
				},
				rules: {
					savesFlows: (role) => roleAllows(role, { flow: ["save"] }),
					refusalWords: () => ROLE_REFUSAL.message,
				},
				work: late.work,
				offers: { offersInto: late.offersInto },
				ownerId,
			});
			const relayed = moves.relay({
				devices: late.devices,
				work: late.work,
				selfId: late.selfId,
			});
			return {
				personalSecrets: personal.device,
				projectSecrets: projects.device,
				ofDevices: {
					personalSecrets: personal.host,
					projectSecrets: projects.host,
					// As a Home Host: a paired Device asks to move a secret on another.
					secretMoves: relayed.host,
					// The owner's moves of a secret on another of their Devices.
					moves: relayed.device,
				},
			};
		},
	};
}
