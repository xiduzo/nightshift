import { z } from "zod";

/**
 * What a person sees of the secrets: names, where each is set, and when.
 * Never a value.
 */

/**
 * Where a `${NAME}` gets its value: a Personal secret, this computer's
 * keychain, the environment, or nowhere. "personal" is as this computer
 * last read the Person's list: names, never values.
 */
export type SecretSource = "personal" | "keychain" | "env" | "missing";

/**
 * Where a saved secret lives (ADR 13). "computer": this computer's keychain
 * only. "personal": the Person's, for their steps on each of their
 * computers.
 */
export type SecretScope = "computer" | "personal";

/** A Project secret as Members see it: its name, when it was set and by whom. Never its value. */
export type ProjectSecretName = {
	name: string;
	setAt: number;
	/** The Person who set it last, with their name. Null: not known. */
	setBy: { id: string; name: string } | null;
};

export type SecretView = {
	name: string;
	/**
	 * Where its saved value lives. A name that is saved nowhere (only the
	 * environment has it, or nothing) is "computer".
	 */
	scope: SecretScope;
	/** Saved in its scope: this computer's keychain, or the Person's Personal secrets. */
	saved: boolean;
	/** Set in the daemon's environment. */
	inEnv: boolean;
	/** The connections that reference it. */
	usedBy: string[];
	/** When a value was last saved through Night Shift (epoch ms). Null: not known, or never. */
	setAt: number | null;
	/** When Night Shift last read it to use it (epoch ms), to the minute. Null: never, or not since it was removed. */
	usedAt: number | null;
};

/**
 * The secrets as the Secrets page lists them. `personal`: whether this
 * computer could read the Person's Personal secret names now. When it
 * could not, the list has this computer's secrets only.
 */
export type SecretList = {
	secrets: SecretView[];
	personal: "available" | "unavailable";
};

/** A saved secret as the document's facts hold it: an older document holds bare names. */
export const savedSecretSchema = z.union([
	z.string().transform((name) => ({ name, setAt: null })),
	z.object({ name: z.string(), setAt: z.number().nullable() }),
]);

/** The environment: the fallback of every `${NAME}`. */
export type SecretEnvironment = Readonly<Record<string, string | undefined>>;

/** What the rows of the Secrets page are made of. Names and times only. */
export type SecretFactsNow = {
	/** The Personal names with when each was set. Null: they could not be listed now. */
	personal: readonly { name: string; setAt: number }[] | null;
	/** Each referenced name, with the connections that reference it. */
	usedBy: ReadonlyMap<string, readonly string[]>;
	/** This computer's saved names, with when each was set. */
	saved: ReadonlyMap<string, number | null>;
	/** When each name was last used. */
	used: ReadonlyMap<string, number>;
	env: SecretEnvironment;
	/** More names to list (a Command node's). */
	named: Iterable<string>;
};

/**
 * The rows of the Secrets page: the Personal names, this computer's saved
 * ones, the referenced ones and `named`, sorted. A name saved in both
 * scopes is listed once per scope, Personal first. A name only Personal
 * has is listed once.
 */
export function secretRows(facts: SecretFactsNow): SecretList {
	const { personal, usedBy, saved, used, env, named } = facts;
	const personalSet = new Map((personal ?? []).map((p) => [p.name, p.setAt]));
	const view = (name: string, scope: SecretScope): SecretView => ({
		name,
		scope,
		saved: scope === "personal" ? true : saved.has(name),
		inEnv: env[name] !== undefined,
		usedBy: [...(usedBy.get(name) ?? [])],
		setAt:
			scope === "personal"
				? (personalSet.get(name) ?? null)
				: (saved.get(name) ?? null),
		usedAt: used.get(name) ?? null,
	});
	const names = new Set([
		...personalSet.keys(),
		...usedBy.keys(),
		...saved.keys(),
		...named,
	]);
	const rows: SecretView[] = [];
	for (const name of [...names].sort()) {
		if (personalSet.has(name)) rows.push(view(name, "personal"));
		if (!personalSet.has(name) || saved.has(name)) {
			rows.push(view(name, "computer"));
		}
	}
	return {
		secrets: rows,
		personal: personal === null ? "unavailable" : "available",
	};
}

/** Where a name gets its value, as this computer knows the Personal names now. */
export function sourceOf(
	name: string,
	known: {
		personal: ReadonlyMap<string, number>;
		saved: ReadonlyMap<string, number | null>;
		env: SecretEnvironment;
	},
): SecretSource {
	if (known.personal.has(name)) return "personal";
	if (known.saved.has(name)) return "keychain";
	return known.env[name] === undefined ? "missing" : "env";
}
