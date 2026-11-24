import { Refusal } from "@nightshift/refusal";

/**
 * The rules and the words of the Project and Space secrets this computer
 * keeps (ADR 13, ADR 18). Each check reads through the functions it
 * takes, in the order of the reads a request makes.
 */

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

/** The refusal of a change through this computer by someone who does not own it. */
export const OWNER_ONLY =
	"Only the owner of this computer can change this project's secrets here.";

/** A Project, by its Space. */
export type ProjectAt = { spaceId: string; projectId: string };

/** A step's run of a Project. */
export type StepAt = ProjectAt & { runId: string };

/** The Host that keeps a Space, or null for one this computer keeps. */
export type HostOf = (spaceId: string) => Promise<string | null>;

/** What a role may do in a Space: the rule and the words come from the Space's roles. */
export type RoleRule<R> = {
	/** Whether the role saves Flows. */
	savesFlows(role: R): boolean;
	/** The words of a role that does not allow a request. */
	refusalWords(): string;
};

/** Who lists or changes secrets: their role per Space, and whether the call saves. */
export type SecretsWho<R> = {
	roleIn(spaceId: string): Promise<R | null>;
	/** The call changes a value: the role must save Flows. */
	saves: boolean;
};

/** Refuses a role that is no Member's, or one that does not save Flows when `saves`. */
export function memberWhoSaves<R>(
	role: R | null,
	saves: boolean,
	rule: RoleRule<R>,
): void {
	if (!role) throw new Refusal("forbidden", NOT_IN_SPACE);
	if (saves && !rule.savesFlows(role)) {
		throw new Refusal("forbidden", rule.refusalWords());
	}
}

/** Refuses a Project that is not in the Space named, or a Space another Host keeps. */
export async function keptHere(
	spaceOf: (projectId: string) => Promise<string | null>,
	hostOf: HostOf,
	at: ProjectAt,
): Promise<void> {
	const kept = await spaceOf(at.projectId);
	if (
		kept === null ||
		kept !== at.spaceId ||
		(await hostOf(at.spaceId)) !== null
	) {
		throw new Refusal("not-found", NOT_A_PROJECT_HERE);
	}
}

/**
 * The checks of a list or a change of a Project's secrets that this
 * computer keeps: it keeps the Space (no Host does), the Project is in
 * it, and `who` is a Member there, whose role saves Flows when
 * `who.saves`.
 */
export async function projectAccess<R>(
	spaceOf: (projectId: string) => Promise<string | null>,
	hostOf: HostOf,
	at: ProjectAt,
	who: SecretsWho<R>,
	rule: RoleRule<R>,
): Promise<void> {
	await keptHere(spaceOf, hostOf, at);
	memberWhoSaves(await who.roleIn(at.spaceId), who.saves, rule);
}

/**
 * The checks of a list or a change of a Space's secrets that this computer
 * keeps: it keeps the Space, and `who` is a Member there, whose role
 * saves Flows when `who.saves`.
 */
export async function spaceAccess<R>(
	hostOf: HostOf,
	spaceId: string,
	who: SecretsWho<R>,
	rule: RoleRule<R>,
): Promise<void> {
	if ((await hostOf(spaceId)) !== null) {
		throw new Refusal("not-found", NOT_A_SPACE_HERE);
	}
	memberWhoSaves(await who.roleIn(spaceId), who.saves, rule);
}

/**
 * The values of a step's names that this computer keeps: the Space's over
 * the Project's (ADR 18), as one answer. The engine's Secret scope rule
 * reads that answer as one scope, between Personal and this computer.
 */
export async function keptStepValues(
	values: {
		project(
			projectId: string,
			names?: readonly string[],
		): Promise<Record<string, string>>;
		space(
			spaceId: string,
			names?: readonly string[],
		): Promise<Record<string, string>>;
	},
	step: StepAt,
	names?: readonly string[],
): Promise<Record<string, string>> {
	return {
		...(await values.project(step.projectId, names)),
		...(await values.space(step.spaceId, names)),
	};
}

/** A kept name as a Member lists it: with the name of the Person who set it. */
export type NamedSecret = {
	name: string;
	setAt: number;
	setBy: { id: string; name: string } | null;
};

/** The Persons who set these kept names, each once. */
export function settersOf(kept: readonly { setBy: string | null }[]): string[] {
	return [...new Set(kept.flatMap((k) => (k.setBy ? [k.setBy] : [])))];
}

/** The kept names, with the name of the Person who set each: "Someone" for one this computer does not know. */
export function namedSecrets(
	kept: readonly { name: string; setAt: number; setBy: string | null }[],
	names: ReadonlyMap<string, string>,
): NamedSecret[] {
	return kept.map((k) => ({
		name: k.name,
		setAt: k.setAt,
		setBy:
			k.setBy === null
				? null
				: { id: k.setBy, name: names.get(k.setBy) ?? "Someone" },
	}));
}

/**
 * Where a person's list or change runs: here after the checks, when this
 * computer keeps the Space, else at the Host that keeps it. Through the
 * Host, only the owner of this computer acts: the key is theirs.
 */
export async function atKeeper<T>(
	keeper: string | null,
	person: { personId: string; ownerId: string },
	here: () => Promise<T>,
	atHost: (hostId: string) => Promise<T>,
): Promise<T> {
	if (keeper === null) return here();
	if (person.personId !== person.ownerId) {
		throw new Refusal("forbidden", OWNER_ONLY);
	}
	return atHost(keeper);
}
