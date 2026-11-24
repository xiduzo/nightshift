import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import { inMemoryComputer } from "../../../../access/computer/adapters/out/in-memory-computer";
import type { ProjectRef, StepRun } from "../../../../contract";
import type {
	PersonalSecrets,
	ProjectSecrets,
	SecretReferences,
	SpaceSecrets,
} from "../../application/ports";
import { createKnownSecrets } from "../../domain/known-secrets";
import type { ProjectSecretName } from "../../domain/secret-views";
import { inMemoryComputerSecrets } from "./in-memory-computer-secrets";
import { inMemorySecretFacts } from "./in-memory-secret-facts";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemorySecretsPorts`, which gives a use-case test every port of
 * the slice at once. Test code: production code never imports this file.
 */

/** What a twin of another package was asked, in order. */
type Calls = { call: string; args: unknown[] }[];

/** The Personal secrets of one Person in memory. `fail` makes every call throw until `heal`. */
export function inMemoryPersonalSecrets(
	initial: Iterable<[string, { value: string; setAt: number }]> = [],
) {
	const secrets = new Map(initial);
	const calls: Calls = [];
	let failure: unknown = null;
	const check = (call: string, args: unknown[]) => {
		calls.push({ call, args });
		if (failure !== null) throw failure;
	};
	const twin = {
		async list() {
			check("list", []);
			return [...secrets].map(([name, { setAt }]) => ({ name, setAt }));
		},
		async values(names: readonly string[]) {
			check("values", [names]);
			const out: Record<string, string> = {};
			for (const name of names) {
				const found = secrets.get(name);
				if (found) out[name] = found.value;
			}
			return out;
		},
		async set(name: string, value: string) {
			check("set", [name]);
			secrets.set(name, { value, setAt: 1 });
		},
		async remove(name: string) {
			check("remove", [name]);
			secrets.delete(name);
		},
		secrets,
		calls,
		fail(error: unknown) {
			failure = error;
		},
		heal() {
			failure = null;
		},
	};
	return twin satisfies PersonalSecrets;
}

/** A keeper's secrets of one scope, by key (a Project id or a Space id). */
function keeperOf() {
	return new Map<string, Map<string, { value: string; setAt: number }>>();
}

/**
 * The secrets of the Projects and the Spaces in memory. A run's values
 * are its Space's over its Project's. `keptHere` says whether this
 * computer keeps them itself (`kept`). `fail` makes every call throw.
 */
export function inMemoryProjectSecrets() {
	const projects = keeperOf();
	const spaces = keeperOf();
	const calls: Calls = [];
	let failure: unknown = null;
	let keptHere = true;
	const check = (call: string, args: unknown[]) => {
		calls.push({ call, args });
		if (failure !== null) throw failure;
	};
	const of = (
		keeper: Map<string, Map<string, { value: string; setAt: number }>>,
		key: string,
	) => {
		let found = keeper.get(key);
		if (!found) {
			found = new Map();
			keeper.set(key, found);
		}
		return found;
	};
	const names = (
		held: Map<string, { value: string; setAt: number }>,
	): ProjectSecretName[] =>
		[...held].map(([name, { setAt }]) => ({ name, setAt, setBy: null }));
	const both = (project: ProjectRef) =>
		new Map([
			...of(projects, project.projectId),
			...of(spaces, project.spaceId),
		]);
	const space = {
		async list(spaceId: string, personId: string) {
			check("space.list", [spaceId, personId]);
			return names(of(spaces, spaceId));
		},
		async set(spaceId: string, name: string, value: string, personId: string) {
			check("space.set", [spaceId, name, personId]);
			of(spaces, spaceId).set(name, { value, setAt: 1 });
		},
		async remove(spaceId: string, name: string, personId: string) {
			check("space.remove", [spaceId, name, personId]);
			of(spaces, spaceId).delete(name);
		},
		async take(spaceId: string, name: string, personId: string) {
			check("space.take", [spaceId, name, personId]);
			return of(spaces, spaceId).get(name)?.value ?? null;
		},
	} satisfies SpaceSecrets;
	const twin = {
		async list(project: ProjectRef, personId: string) {
			check("list", [project, personId]);
			return names(of(projects, project.projectId));
		},
		async values(run: StepRun, wanted?: readonly string[]) {
			check("values", [run, wanted]);
			const out: Record<string, string> = {};
			for (const [name, { value }] of both(run)) {
				if (!wanted || wanted.includes(name)) out[name] = value;
			}
			return out;
		},
		async set(
			project: ProjectRef,
			name: string,
			value: string,
			personId: string,
		) {
			check("set", [project, name, personId]);
			of(projects, project.projectId).set(name, { value, setAt: 1 });
		},
		async remove(project: ProjectRef, name: string, personId: string) {
			check("remove", [project, name, personId]);
			of(projects, project.projectId).delete(name);
		},
		async take(project: ProjectRef, name: string, personId: string) {
			check("take", [project, name, personId]);
			return of(projects, project.projectId).get(name)?.value ?? null;
		},
		async kept(project: ProjectRef, wanted?: readonly string[]) {
			check("kept", [project, wanted]);
			if (!keptHere) return [];
			const held = both(project);
			return wanted
				? wanted.flatMap((name) => {
						const found = held.get(name);
						return found ? [found.value] : [];
					})
				: [...held.values()].map(({ value }) => value);
		},
		space,
		projects,
		spaces,
		calls,
		fail(error: unknown) {
			failure = error;
		},
		heal() {
			failure = null;
		},
		keptElsewhere() {
			keptHere = false;
		},
	};
	return twin satisfies ProjectSecrets;
}

/** The connections' references in memory: name → the connections that reference it. */
export function inMemorySecretReferences(
	initial: Iterable<[string, string[]]> = [],
) {
	const usedBy = new Map<string, readonly string[]>(initial);
	return {
		usedBy: () => usedBy,
		references: usedBy,
	} satisfies SecretReferences & {
		references: Map<string, readonly string[]>;
	};
}

/**
 * Every port of secrets in memory at once: where each use-case test
 * starts. Personal and Project secrets are reachable; `unreach` makes
 * one answer null (not reachable yet), and `without` takes it away.
 * The clock reads `clock.now`, and `warnings` holds each log line.
 */
export function inMemorySecretsPorts() {
	const warnings: { line: string; error: unknown }[] = [];
	const personalTwin = inMemoryPersonalSecrets();
	const projectTwin = inMemoryProjectSecrets();
	const reachable = { personal: true, projects: true };
	const clock = { now: 120_000 };
	const place = { host: false };
	const access = inMemoryAccess();
	access.members.join("space-1", "ada", "member");
	const ports = {
		/** `ada` owns this computer, and is a member of the Space `space-1`. */
		computerAccess: inMemoryComputer({ id: () => "ada" }),
		access,
		computer: inMemoryComputerSecrets(),
		facts: inMemorySecretFacts(),
		references: inMemorySecretReferences(),
		personal: (() => (reachable.personal ? personalTwin : null)) as
			| (() => PersonalSecrets | null)
			| undefined,
		projects: (() => (reachable.projects ? projectTwin : null)) as
			| (() => ProjectSecrets | null)
			| undefined,
		known: createKnownSecrets((line, error) => warnings.push({ line, error })),
		env: {} as Record<string, string | undefined>,
		host: () => place.host,
		now: () => clock.now,
	};
	return {
		...ports,
		personalTwin,
		projectTwin,
		warnings,
		clock,
		place,
		/** The scope answers null: it cannot be reached yet. */
		unreach(scope: "personal" | "projects") {
			reachable[scope] = false;
		},
		/** This computer has no such scope. */
		without(scope: "personal" | "projects") {
			return { ...ports, [scope]: undefined };
		},
	};
}
