import {
	personNames,
	ROLE_REFUSAL,
	type Role,
	roleAllows,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { project, run } from "@nightshift/db/schema";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import type { Caller, ProjectSecretName } from "../contract";
import type { WorkHub } from "../work";
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
 * and 6). The Host admitted the Caller before the call reached here
 * (`Devices.admit`): "Be a Host" is on, and its Device is paired here
 * with access, as its Person's own. Every call checks, from this Host's
 * own records, that it keeps the Space (another Host's Space is not its
 * to serve), and that the Project is in it.
 *
 * Then, per call:
 *
 * - `list`: the Caller's Person is a Member of the Space.
 * - `set`, `remove`, `take`: their role there saves Flows. `take` reads a
 *   value for a move only: the Device saves it elsewhere, then removes it.
 * - `values`, for a step: the run is of that Project in that Space, and
 *   its step runs on the Caller's Device now. That is, the work hub has a
 *   session, a command or a tool call of the run out to that Device
 *   (`WorkHub.placed`), or the Device walks the run itself and runs its
 *   steps there. The Device's Person is a Member of the Space, or the
 *   Device offers profiles to it: another Person's Device that runs a
 *   step under an Offer gets the run's Project secrets, for that run only.
 */
export type ProjectSecretsHost = {
	list(caller: Caller, input: ProjectRef): Promise<ProjectSecretName[]>;
	values(
		caller: Caller,
		input: StepRun & { names?: readonly string[] },
	): Promise<Record<string, string>>;
	set(
		caller: Caller,
		input: ProjectRef & { name: string; value: string },
	): Promise<void>;
	remove(caller: Caller, input: ProjectRef & { name: string }): Promise<void>;
	take(
		caller: Caller,
		input: ProjectRef & { name: string },
	): Promise<string | null>;
	/** A Space's secrets (ADR 18): the same rules, for every project of the Space. */
	space: {
		list(
			caller: Caller,
			input: { spaceId: string },
		): Promise<ProjectSecretName[]>;
		set(
			caller: Caller,
			input: { spaceId: string; name: string; value: string },
		): Promise<void>;
		remove(
			caller: Caller,
			input: { spaceId: string; name: string },
		): Promise<void>;
		take(
			caller: Caller,
			input: { spaceId: string; name: string },
		): Promise<string | null>;
	};
};

/** Who lists or changes secrets: their role per Space, as the Caller reads it, and whether the call saves. */
export type SecretsAccess = Pick<Caller, "roleIn"> & {
	/** The call changes a value: the role must save Flows. */
	saves: boolean;
};

/**
 * The checks of a list or a change of a Space's secrets that this computer
 * keeps: it keeps the Space, and `who` is a Member there, whose role
 * saves Flows when `who.saves`.
 */
export async function spaceAccess(
	hostSpaces: { hostOf(spaceId: string): Promise<string | null> },
	spaceId: string,
	who: SecretsAccess,
): Promise<void> {
	if ((await hostSpaces.hostOf(spaceId)) !== null) {
		throw new Refusal("not-found", NOT_A_SPACE_HERE);
	}
	memberWhoSaves(await who.roleIn(spaceId), who.saves);
}

/**
 * The checks of a list or a change of a Project's secrets that this
 * computer keeps: it keeps the Space (no Host does), the Project is in
 * it, and `who` is a Member there, whose role saves Flows when
 * `who.saves`.
 */
export async function projectAccess(
	db: Database,
	hostSpaces: { hostOf(spaceId: string): Promise<string | null> },
	at: ProjectRef,
	who: SecretsAccess,
): Promise<void> {
	await keptHere(db, hostSpaces, at);
	memberWhoSaves(await who.roleIn(at.spaceId), who.saves);
}

/** Refuses a role that is no Member's, or one that does not save Flows when `saves`. */
function memberWhoSaves(role: Role | null, saves: boolean): void {
	if (!role) throw new Refusal("forbidden", NOT_IN_SPACE);
	if (saves && !roleAllows(role, { flow: ["save"] })) {
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

/**
 * The values of a step's names that this computer keeps: the Space's over
 * the Project's (ADR 18), as one answer. The engine's Secret scope rule
 * reads that answer as one scope, between Personal and this computer.
 */
export async function keptStepValues(
	stores: {
		store: Pick<ProjectSecretStore, "values">;
		spaceStore: Pick<SpaceSecretStore, "values">;
	},
	step: StepRun,
	names?: readonly string[],
): Promise<Record<string, string>> {
	return {
		...(await stores.store.values(step.projectId, names)),
		...(await stores.spaceStore.values(step.spaceId, names)),
	};
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
	store: ProjectSecretStore;
	spaceStore: SpaceSecretStore;
	/** The Host that keeps a Space, or null for one this computer keeps. */
	hostOf(spaceId: string): Promise<string | null>;
	/** The calls of runs this Host walks or relays, to the Devices they are placed on. */
	work: Pick<WorkHub, "placed">;
	/** Whether a Device offers profiles to a Space. */
	offersInto(deviceId: string, spaceId: string): Promise<boolean>;
}): ProjectSecretsHost {
	const { db } = deps;

	const hostSpaces = { hostOf: deps.hostOf };

	/** The Caller's Person is a Member of the Space, and may save Flows there when `saves`. */
	function mayUse(
		caller: Caller,
		at: ProjectRef,
		saves: boolean,
	): Promise<void> {
		return projectAccess(db, hostSpaces, at, { roleIn: caller.roleIn, saves });
	}

	/** The Caller's Person is a Member of the Space, and may save Flows there when `saves`. */
	function mayUseSpace(
		caller: Caller,
		spaceId: string,
		saves: boolean,
	): Promise<void> {
		return spaceAccess(hostSpaces, spaceId, { roleIn: caller.roleIn, saves });
	}

	return {
		async list(caller, at) {
			await mayUse(caller, at, false);
			return withNames(db, await deps.store.list(at.projectId));
		},
		async values(caller, { names, ...step }) {
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
				!(
					row.walkerId === caller.deviceId ||
					deps.work.placed(caller.deviceId, step)
				)
			) {
				throw new Refusal("forbidden", NOT_YOUR_STEP);
			}
			if (
				!(await caller.member(step.spaceId)) &&
				!(await deps.offersInto(caller.deviceId, step.spaceId))
			) {
				throw new Refusal("forbidden", NOT_IN_SPACE);
			}
			return keptStepValues(deps, step, names);
		},
		async set(caller, { name, value, ...at }) {
			await mayUse(caller, at, true);
			await deps.store.set(at, name, value, caller.personId);
		},
		async remove(caller, { name, ...at }) {
			await mayUse(caller, at, true);
			await deps.store.remove(at.projectId, name);
		},
		async take(caller, { name, ...at }) {
			await mayUse(caller, at, true);
			return (await deps.store.values(at.projectId, [name]))[name] ?? null;
		},
		space: {
			async list(caller, { spaceId }) {
				await mayUseSpace(caller, spaceId, false);
				return withNames(db, await deps.spaceStore.list(spaceId));
			},
			async set(caller, { spaceId, name, value }) {
				await mayUseSpace(caller, spaceId, true);
				await deps.spaceStore.set(spaceId, name, value, caller.personId);
			},
			async remove(caller, { spaceId, name }) {
				await mayUseSpace(caller, spaceId, true);
				await deps.spaceStore.remove(spaceId, name);
			},
			async take(caller, { spaceId, name }) {
				await mayUseSpace(caller, spaceId, true);
				return (await deps.spaceStore.values(spaceId, [name]))[name] ?? null;
			},
		},
	};
}
