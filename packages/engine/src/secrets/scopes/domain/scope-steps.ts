import { secretNameSchema } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { SecretScope } from "./secret-views";
import {
	NEEDS_A_VALUE,
	notInProject,
	notInSpace,
	notPersonal,
	noValueHere,
	PERSONAL_UNREACHABLE,
	PROJECT_UNREACHABLE,
} from "./secret-words";

/**
 * The steps that save, remove and read a value in one scope of this
 * computer's Person: this computer's keychain, or the Personal secrets.
 * The use cases share them. Each takes what it works on as functions: the
 * shapes below are what it reads of the ports.
 */

/**
 * A port another package gives, read at each use. It answers null while
 * it cannot be reached. Undefined: this computer has no such scope.
 */
export type Reach<T> = (() => T | null) | undefined;

/** The port now, or a refusal with `words` that says it cannot be reached. */
export function reached<T>(reach: Reach<T>, words: string): T {
	const port = reach?.() ?? null;
	if (!port) throw new Refusal("unavailable", words);
	return port;
}

/** The Project and Space secrets now, or a refusal that says they cannot be read. */
export function reachProjects<T>(reach: Reach<T>): T {
	return reached(reach, PROJECT_UNREACHABLE);
}

/** The Personal secrets now, or a refusal that says they cannot be read. */
export function reachPersonal<T>(reach: Reach<T>): T {
	return reached(reach, PERSONAL_UNREACHABLE);
}

/** Refuses a name that is no secret name, then an empty value. */
export function checkSecret(name: string, value: string): void {
	secretNameSchema.parse(name);
	if (value === "") throw new Refusal("invalid", NEEDS_A_VALUE);
}

/**
 * The value read to move a secret, or the refusal that its place has no
 * value of that name. The words name the secret, never a value.
 */
export function movedValue(
	value: string | null,
	from: SecretScope | "project" | "space",
	name: string,
): string {
	if (value !== null) return value;
	const words = {
		computer: noValueHere,
		personal: notPersonal,
		project: notInProject,
		space: notInSpace,
	}[from](name);
	throw new Refusal("not-found", words);
}

/** This computer's keychain and the names it holds, with the clock for the set time. */
export type HereSteps = {
	computer: {
		get(name: string): Promise<string | null>;
		set(name: string, value: string): Promise<void>;
		delete(name: string): Promise<void>;
	};
	facts: {
		saved(): ReadonlyMap<string, number | null>;
		writeSaved(
			saved: ReadonlyMap<string, number | null>,
			forget?: readonly string[],
		): Promise<void>;
	};
	now: () => number;
};

/** The Person's Personal secrets, and what this computer remembers of their names. */
export type PersonalSteps = {
	personal: Reach<{
		values(names: readonly string[]): Promise<Record<string, string>>;
		set(name: string, value: string): Promise<void>;
		remove(name: string): Promise<void>;
	}>;
	known: {
		readonly personal: Map<string, number>;
		personalChanged(): void;
	};
	now: () => number;
};

/**
 * The Personal names with when each was set, and what this computer
 * remembers of them now. Empty without a Personal scope. Null when they
 * cannot be listed now: the reason is logged once.
 */
export async function listPersonalNames(on: {
	personal: Reach<{ list(): Promise<{ name: string; setAt: number }[]> }>;
	known: {
		readonly personal: Map<string, number>;
		answered(): void;
		warnOnce(what: "listed", error: unknown): void;
	};
}): Promise<{ name: string; setAt: number }[] | null> {
	if (on.personal === undefined) return [];
	try {
		const listed = await reached(on.personal, PERSONAL_UNREACHABLE).list();
		on.known.answered();
		on.known.personal.clear();
		for (const { name, setAt } of listed) on.known.personal.set(name, setAt);
		return listed;
	} catch (error) {
		on.known.warnOnce("listed", error);
		return null;
	}
}

/** Saves a value in this computer's keychain, then its name with the time. */
export async function saveHere(
	on: HereSteps,
	name: string,
	value: string,
): Promise<void> {
	await on.computer.set(name, value);
	await on.facts.writeSaved(new Map(on.facts.saved()).set(name, on.now()));
}

/** Removes this computer's saved value, then its name and its use time. */
export async function removeHere(on: HereSteps, name: string): Promise<void> {
	await on.computer.delete(name);
	const saved = new Map(on.facts.saved());
	saved.delete(name);
	await on.facts.writeSaved(saved, [name]);
}

/** Saves a Personal secret, and tells the listeners. */
export async function savePersonal(
	on: PersonalSteps,
	name: string,
	value: string,
): Promise<void> {
	await reached(on.personal, PERSONAL_UNREACHABLE).set(name, value);
	on.known.personal.set(name, on.now());
	on.known.personalChanged();
}

/** Removes a Personal secret, and tells the listeners. */
export async function removePersonal(
	on: PersonalSteps,
	name: string,
): Promise<void> {
	await reached(on.personal, PERSONAL_UNREACHABLE).remove(name);
	on.known.personal.delete(name);
	on.known.personalChanged();
}

/** Saves a value in a scope. */
export function saveIn(
	on: HereSteps & PersonalSteps,
	scope: SecretScope,
	name: string,
	value: string,
): Promise<void> {
	return scope === "personal"
		? savePersonal(on, name, value)
		: saveHere(on, name, value);
}

/** Removes the saved value of a scope. */
export function removeIn(
	on: HereSteps & PersonalSteps,
	scope: SecretScope,
	name: string,
): Promise<void> {
	return scope === "personal" ? removePersonal(on, name) : removeHere(on, name);
}

/** The value a scope keeps for a name, to move it: never shown. Null: none. */
export async function valueIn(
	on: HereSteps & PersonalSteps,
	scope: SecretScope,
	name: string,
): Promise<string | null> {
	if (scope === "personal") {
		return (
			(await reached(on.personal, PERSONAL_UNREACHABLE).values([name]))[name] ??
			null
		);
	}
	return on.facts.saved().has(name) ? await on.computer.get(name) : null;
}
