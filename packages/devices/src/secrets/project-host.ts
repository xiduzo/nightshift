import {
	type DeviceKeyAccess,
	personNames,
	ROLE_REFUSAL,
	roleAllows,
	roleIn,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { project, run } from "@nightshift/db/schema";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import { NOT_A_HOST, type ProjectSecretName } from "../contract";
import type { DeviceRegistry } from "../registry";
import type { WorkHub } from "../work";
import { NOT_YOUR_DEVICE } from "./host";
import type { KeptProjectSecret, ProjectSecretStore } from "./project-store";
import type { SpaceSecretStore } from "./space-store";

/** The refusal of a project this Host does not keep, or that is not in the Space named. */
export const NOT_A_PROJECT_HERE =
	"This computer does not keep that project. Check that the project is in this Space.";

/** The refusal of a Device that has no step of the run placed on it now. */
export const NOT_YOUR_STEP =
	"This device has no step of that run now. Only the device a step runs on gets the project's secrets.";

/** The refusal of a Device whose Person takes no part in the Space. */
export const NOT_IN_SPACE =
	"This device takes no part in that Space. Ask an owner of the Space to invite you.";

/** The refusal of a Space that another Host keeps. */
export const NOT_A_SPACE_HERE =
	"This computer does not keep that Space. Check that you work in the right Space.";

type ProjectRef = { spaceId: string; projectId: string };
type StepRun = ProjectRef & { runId: string };

/**
 * This computer as the Host that keeps a Space, as a paired Device asks
 * it for the secrets of the Space's Projects (ADR 13, decisions 2, 3
 * and 6). Every call checks, from this Host's own records, that:
 *
 * - "Be a Host" is on, and the key's Device is paired here, has access,
 *   and is its Person's own;
 * - this Host keeps the Space (another Host's Space is not its to serve),
 *   and the Project is in it.
 *
 * Then, per call:
 *
 * - `list`: the key's Person is a Member of the Space.
 * - `set`, `remove`, `take`: their role there saves Flows. `take` reads a
 *   value for a move only: the Device saves it elsewhere, then removes it.
 * - `values`, for a step: the run is of that Project in that Space, and
 *   its step runs on the key's Device now. That is, the work hub has a
 *   session, a command or a tool call of the run out to that Device
 *   (`WorkHub.placed`), or the Device walks the run itself and runs its
 *   steps there. The Device's Person is a Member of the Space, or the
 *   Device offers profiles to it: another Person's Device that runs a
 *   step under an Offer gets the run's Project secrets, for that run only.
 */
export type ProjectSecretsHost = {
	list(key: DeviceKeyAccess, input: ProjectRef): Promise<ProjectSecretName[]>;
	values(
		key: DeviceKeyAccess,
		input: StepRun & { names?: readonly string[] },
	): Promise<Record<string, string>>;
	set(
		key: DeviceKeyAccess,
		input: ProjectRef & { name: string; value: string },
	): Promise<void>;
	remove(
		key: DeviceKeyAccess,
		input: ProjectRef & { name: string },
	): Promise<void>;
	take(
		key: DeviceKeyAccess,
		input: ProjectRef & { name: string },
	): Promise<string | null>;
	/** A Space's secrets (ADR 18): the same rules, for every project of the Space. */
	space: {
		list(
			key: DeviceKeyAccess,
			input: { spaceId: string },
		): Promise<ProjectSecretName[]>;
		set(
			key: DeviceKeyAccess,
			input: { spaceId: string; name: string; value: string },
		): Promise<void>;
		remove(
			key: DeviceKeyAccess,
			input: { spaceId: string; name: string },
		): Promise<void>;
		take(
			key: DeviceKeyAccess,
			input: { spaceId: string; name: string },
		): Promise<string | null>;
	};
};

/**
 * The checks of a list or a change of a Space's secrets that this computer
 * keeps: it keeps the Space, and `personId` is a Member there, whose role
 * saves Flows when `saves`.
 */
export async function spaceAccess(
	db: Database,
	hostSpaces: { hostOf(spaceId: string): Promise<string | null> },
	spaceId: string,
	who: { personId: string; saves: boolean },
): Promise<void> {
	if ((await hostSpaces.hostOf(spaceId)) !== null) {
		throw new Refusal("not-found", NOT_A_SPACE_HERE);
	}
	const role = await roleIn(db, who.personId, spaceId);
	if (!role) throw new Refusal("forbidden", NOT_IN_SPACE);
	if (who.saves && !roleAllows(role, { flow: ["save"] })) {
		throw new Refusal("forbidden", ROLE_REFUSAL.message);
	}
}

/**
 * The checks of a list or a change of a Project's secrets that this
 * computer keeps: it keeps the Space (no Host does), the Project is in
 * it, and `personId` is a Member there, whose role saves Flows when
 * `saves`.
 */
export async function projectAccess(
	db: Database,
	hostSpaces: { hostOf(spaceId: string): Promise<string | null> },
	at: ProjectRef,
	who: { personId: string; saves: boolean },
): Promise<void> {
	await keptHere(db, hostSpaces, at);
	const role = await roleIn(db, who.personId, at.spaceId);
	if (!role) throw new Refusal("forbidden", NOT_IN_SPACE);
	if (who.saves && !roleAllows(role, { flow: ["save"] })) {
		throw new Refusal("forbidden", ROLE_REFUSAL.message);
	}
}

/** Refuses a Project that is not in the Space named, or a Space another Host keeps. */
async function keptHere(
	db: Database,
	hostSpaces: { hostOf(spaceId: string): Promise<string | null> },
	at: ProjectRef,
): Promise<void> {
	const [kept] = await db
		.select({ spaceId: project.spaceId })
		.from(project)
		.where(eq(project.id, at.projectId));
	if (
		!kept ||
		kept.spaceId !== at.spaceId ||
		(await hostSpaces.hostOf(at.spaceId)) !== null
	) {
		throw new Refusal("not-found", NOT_A_PROJECT_HERE);
	}
}

/** The kept names, with the name of the Person who set each. */
export async function withNames(
	db: Database,
	kept: readonly KeptProjectSecret[],
): Promise<ProjectSecretName[]> {
	const names = await personNames(db, [
		...new Set(kept.flatMap((k) => (k.setBy ? [k.setBy] : []))),
	]);
	return kept.map((k) => ({
		name: k.name,
		setAt: k.setAt,
		setBy:
			k.setBy === null
				? null
				: { id: k.setBy, name: names.get(k.setBy) ?? "Someone" },
	}));
}

export function createProjectSecretsHost(deps: {
	db: Database;
	registry: Pick<DeviceRegistry, "get">;
	store: ProjectSecretStore;
	spaceStore: SpaceSecretStore;
	/** "Be a Host" is on now. */
	isHost(): boolean;
	/** The Host that keeps a Space, or null for one this computer keeps. */
	hostOf(spaceId: string): Promise<string | null>;
	/** The calls of runs this Host walks or relays, to the Devices they are placed on. */
	work: Pick<WorkHub, "placed">;
	/** Whether a Device offers profiles to a Space. */
	offersInto(deviceId: string, spaceId: string): Promise<boolean>;
}): ProjectSecretsHost {
	const { db } = deps;

	const hostSpaces = { hostOf: deps.hostOf };

	/** The key's Device is paired here, has access, and is its Person's own. */
	async function admit(key: DeviceKeyAccess): Promise<void> {
		if (!deps.isHost()) throw new Refusal("unavailable", NOT_A_HOST);
		const paired = await deps.registry.get(key.deviceId);
		if (
			!paired ||
			paired.revokedAt !== null ||
			paired.ownerId !== key.personId
		) {
			throw new Refusal("forbidden", NOT_YOUR_DEVICE);
		}
	}

	/** The key's Person is a Member of the Space, and may save Flows there when `saves`. */
	async function mayUse(
		key: DeviceKeyAccess,
		at: ProjectRef,
		saves: boolean,
	): Promise<void> {
		await admit(key);
		await projectAccess(db, hostSpaces, at, {
			personId: key.personId,
			saves,
		});
	}

	/** The key's Person is a Member of the Space, and may save Flows there when `saves`. */
	async function mayUseSpace(
		key: DeviceKeyAccess,
		spaceId: string,
		saves: boolean,
	): Promise<void> {
		await admit(key);
		await spaceAccess(db, hostSpaces, spaceId, {
			personId: key.personId,
			saves,
		});
	}

	return {
		async list(key, at) {
			await mayUse(key, at, false);
			return withNames(db, await deps.store.list(at.projectId));
		},
		async values(key, { names, ...step }) {
			await admit(key);
			await keptHere(db, hostSpaces, step);
			const [row] = await db
				.select({
					spaceId: run.spaceId,
					projectId: run.projectId,
					walkerId: run.walkerId,
				})
				.from(run)
				.where(eq(run.id, step.runId));
			if (
				!row ||
				row.spaceId !== step.spaceId ||
				row.projectId !== step.projectId ||
				!(row.walkerId === key.deviceId || deps.work.placed(key.deviceId, step))
			) {
				throw new Refusal("forbidden", NOT_YOUR_STEP);
			}
			if (
				!(await roleIn(db, key.personId, step.spaceId)) &&
				!(await deps.offersInto(key.deviceId, step.spaceId))
			) {
				throw new Refusal("forbidden", NOT_IN_SPACE);
			}
			// A step reads both: the Space's wins over the Project's (ADR 18).
			return {
				...(await deps.store.values(step.projectId, names)),
				...(await deps.spaceStore.values(step.spaceId, names)),
			};
		},
		async set(key, { name, value, ...at }) {
			await mayUse(key, at, true);
			await deps.store.set(at, name, value, key.personId);
		},
		async remove(key, { name, ...at }) {
			await mayUse(key, at, true);
			await deps.store.remove(at.projectId, name);
		},
		async take(key, { name, ...at }) {
			await mayUse(key, at, true);
			return (await deps.store.values(at.projectId, [name]))[name] ?? null;
		},
		space: {
			async list(key, { spaceId }) {
				await mayUseSpace(key, spaceId, false);
				return withNames(db, await deps.spaceStore.list(spaceId));
			},
			async set(key, { spaceId, name, value }) {
				await mayUseSpace(key, spaceId, true);
				await deps.spaceStore.set(spaceId, name, value, key.personId);
			},
			async remove(key, { spaceId, name }) {
				await mayUseSpace(key, spaceId, true);
				await deps.spaceStore.remove(spaceId, name);
			},
			async take(key, { spaceId, name }) {
				await mayUseSpace(key, spaceId, true);
				return (await deps.spaceStore.values(spaceId, [name]))[name] ?? null;
			},
		},
	};
}
