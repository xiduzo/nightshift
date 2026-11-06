import { roleIn } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { run } from "@nightshift/db/schema";
import type { ProjectSecrets } from "@nightshift/engine/device-config";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import type { HostClient } from "../contract";
import type { DeviceLinks, HostSpaces } from "../links";
import { askHost, PERSONAL_DEADLINE_MS } from "./device";
import {
	keptStepValues,
	NOT_YOUR_STEP,
	projectAccess,
	type SecretsAccess,
	spaceAccess,
	withNames,
} from "./project-host";
import type { ProjectSecretStore } from "./project-store";
import type { SpaceSecretStore } from "./space-store";

/** What a person reads when the Host of the Space does not know Project secrets yet. */
export const OLDER_HOST_PROJECT_SECRETS =
	"The Host of this Space runs an older version of Night Shift. Update Night Shift there to use project secrets.";

/** The refusal of a change through this computer by someone who does not own it. */
export const OWNER_ONLY =
	"Only the owner of this computer can change this project's secrets here.";

/**
 * The secrets of the Projects as this computer reaches them (ADR 13), the
 * engine's `ProjectSecrets` port. Per call, by the Project's Space:
 *
 * - A Space a Host keeps: the call goes to that Host over its link, with
 *   this Device's key, in the name of this computer's owner. The Host
 *   checks the Member, their role and the step. Nothing is kept here: a
 *   value lives in memory for the use that asked.
 * - A Space this computer keeps (as its Host, or without one): its own
 *   store, after the same checks, from its own records.
 *
 * A Host that cannot be reached, or does not answer within the deadline,
 * throws `HostUnreachableError`: a step then reads the secret as missing
 * (fails closed).
 */
export function deviceProjectSecrets(deps: {
	db: Database;
	hostSpaces: Pick<HostSpaces, "hostOf">;
	/** Lazy: the links are made after this. */
	links(): Pick<DeviceLinks, "get">;
	store: ProjectSecretStore;
	spaceStore: SpaceSecretStore;
	/** The Person who owns this computer: the only one who acts through its key. */
	ownerId: string;
	deadlineMs?: number;
}): ProjectSecrets {
	const { db, store, spaceStore } = deps;
	const options = {
		deadlineMs: deps.deadlineMs ?? PERSONAL_DEADLINE_MS,
		olderHost: OLDER_HOST_PROJECT_SECRETS,
	};

	/** The Host that keeps the Space and its link, or null when this computer keeps it. */
	async function keeper(spaceId: string) {
		const hostId = await deps.hostSpaces.hostOf(spaceId);
		return hostId === null ? null : deps.links().get(hostId);
	}

	/** `personId` as who lists or changes here: their role per Space, from this computer's member rows. */
	function byPerson(personId: string, saves: boolean): SecretsAccess {
		return { roleIn: (spaceId) => roleIn(db, personId, spaceId), saves };
	}

	/**
	 * A change, or a list, by `personId`: here after the checks, else at the
	 * Host. Through the Host, only the owner of this computer acts: the
	 * key is theirs.
	 */
	async function asPerson<T>(
		at: { spaceId: string; projectId: string },
		personId: string,
		saves: boolean,
		here: () => Promise<T>,
		onHost: (client: HostClient) => Promise<T>,
	): Promise<T> {
		const hostId = await deps.hostSpaces.hostOf(at.spaceId);
		if (hostId === null) {
			await projectAccess(db, deps.hostSpaces, at, byPerson(personId, saves));
			return here();
		}
		if (personId !== deps.ownerId) throw new Refusal("forbidden", OWNER_ONLY);
		return askHost(deps.links().get(hostId), onHost, options);
	}

	/** A change, or a list, of a Space's secrets by `personId`: as `asPerson`. */
	async function inSpace<T>(
		spaceId: string,
		personId: string,
		saves: boolean,
		here: () => Promise<T>,
		onHost: (client: HostClient) => Promise<T>,
	): Promise<T> {
		const hostId = await deps.hostSpaces.hostOf(spaceId);
		if (hostId === null) {
			await spaceAccess(deps.hostSpaces, spaceId, byPerson(personId, saves));
			return here();
		}
		if (personId !== deps.ownerId) throw new Refusal("forbidden", OWNER_ONLY);
		return askHost(deps.links().get(hostId), onHost, options);
	}

	return {
		list: (at, personId) =>
			asPerson(
				at,
				personId,
				false,
				async () => {
					const kept = await store.list(at.projectId);
					return withNames(db, kept);
				},
				(client) => client.projectSecrets.list(at),
			),
		async values(step, names) {
			if (names?.length === 0) return {};
			const link = await keeper(step.spaceId);
			if (link === null) {
				// This computer keeps the Space: its own run of the Project.
				const [row] = await db
					.select({ spaceId: run.spaceId, projectId: run.projectId })
					.from(run)
					.where(eq(run.id, step.runId));
				if (row?.spaceId !== step.spaceId || row.projectId !== step.projectId) {
					throw new Refusal("forbidden", NOT_YOUR_STEP);
				}
				return keptStepValues({ store, spaceStore }, step, names);
			}
			return askHost(
				link,
				(client) =>
					client.projectSecrets.values({
						...step,
						...(names ? { names: [...names] } : {}),
					}),
				options,
			);
		},
		set: (at, name, value, personId) =>
			asPerson(
				at,
				personId,
				true,
				() => store.set(at, name, value, personId),
				(client) => client.projectSecrets.set({ ...at, name, value }),
			),
		remove: (at, name, personId) =>
			asPerson(
				at,
				personId,
				true,
				() => store.remove(at.projectId, name),
				(client) => client.projectSecrets.remove({ ...at, name }),
			),
		take: (at, name, personId) =>
			asPerson(
				at,
				personId,
				true,
				async () => (await store.values(at.projectId, [name]))[name] ?? null,
				(client) => client.projectSecrets.take({ ...at, name }),
			),
		async kept(at, names) {
			if ((await deps.hostSpaces.hostOf(at.spaceId)) !== null) return [];
			return [
				...Object.values(await spaceStore.values(at.spaceId, names)),
				...Object.values(await store.values(at.projectId, names)),
			];
		},
		space: {
			list: (spaceId, personId) =>
				inSpace(
					spaceId,
					personId,
					false,
					async () => withNames(db, await spaceStore.list(spaceId)),
					(client) => client.spaceSecrets.list({ spaceId }),
				),
			set: (spaceId, name, value, personId) =>
				inSpace(
					spaceId,
					personId,
					true,
					() => spaceStore.set(spaceId, name, value, personId),
					(client) => client.spaceSecrets.set({ spaceId, name, value }),
				),
			remove: (spaceId, name, personId) =>
				inSpace(
					spaceId,
					personId,
					true,
					() => spaceStore.remove(spaceId, name),
					(client) => client.spaceSecrets.remove({ spaceId, name }),
				),
			take: (spaceId, name, personId) =>
				inSpace(
					spaceId,
					personId,
					true,
					async () => (await spaceStore.values(spaceId, [name]))[name] ?? null,
					(client) => client.spaceSecrets.take({ spaceId, name }),
				),
		},
	};
}
