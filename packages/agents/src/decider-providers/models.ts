/**
 * The models a decider offers, from its provider's listing and from the
 * registry, and whether the server at a profile's address answers: it is
 * asked for the same listing.
 */

import { deciderAddress, type ModelAddress } from "@nightshift/flows";
import { messageOf } from "@nightshift/refusal";
import type { DeciderName } from "../port";
import { reachAddress, type TanstackDeciderOptions } from "./access";
import { type AddressAccess, AddressError } from "./address";
import type { DeciderContext } from "./decider-record";
import { DECIDER_ADAPTERS } from "./registry";

export type DeciderModels = {
	/** The models that decide: the provider's listing first, then the adapter's. */
	models: string[];
	/** The models that make a value, in the same order. Empty when it lists none. */
	valueModels: string[];
	/** How many models came from the provider's listing. */
	listed: number;
	/** Why the provider's listing did not answer. Null when it did, or has none. */
	problem: string | null;
};

/**
 * The models a decider offers: what the provider has on hand first (Ollama:
 * the models pulled on this computer), then the adapter's lists. Never
 * throws: a provider that does not answer leaves the adapter's lists.
 */
export async function deciderModels(
	name: DeciderName,
	context: DeciderContext = {},
	/** A profile's address, its secrets read (`reachAddress`): its server lists instead. */
	at?: AddressAccess,
): Promise<DeciderModels> {
	const spec = DECIDER_ADAPTERS[name];
	const merged = (listed: string[], known: readonly string[]) => [
		...listed,
		...known.filter((m) => !listed.includes(m)),
	];
	const result = (listed: string[], problem: string | null) => ({
		models: merged(listed, spec.models),
		valueModels: spec.value ? merged(listed, spec.value.models ?? []) : [],
		listed: listed.length,
		problem,
	});
	const list =
		at && spec.listAt
			? () => (spec.listAt as NonNullable<typeof spec.listAt>)(at, context)
			: spec.listModels
				? () =>
						(spec.listModels as NonNullable<typeof spec.listModels>)(context)
				: null;
	if (!list) return result([], null);
	try {
		return result([...new Set(await list())], null);
	} catch (error) {
		return result([], messageOf(error));
	}
}

/**
 * The models a decider offers at a profile's address, for the profile's
 * page: the server's listing first, or why it did not answer (a missing
 * secret too). This is also how the person tests an address. Never throws.
 */
export async function deciderModelsAt(
	name: DeciderName,
	address: ModelAddress,
	options: TanstackDeciderOptions,
): Promise<DeciderModels> {
	const at = await reachAddress(address, options.secret);
	if (!("problem" in at)) return deciderModels(name, options, at);
	const known = await deciderModels(name, {});
	return { ...known, problem: at.problem };
}

/** How a listing failure reads at run start: whether the server answered at all. */
function listingReason(error: unknown): "silent" | "refused" | "other" {
	if (error instanceof AddressError) return error.reason;
	const message = messageOf(error);
	if (/does not answer/i.test(message)) return "silent";
	if (/\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(message))
		return "refused";
	return "other";
}

/**
 * Whether the server at a profile's address answers: it lists its models
 * (`listAt`). Nothing answering, a refused key and a missing secret count;
 * a server that answers with an error of its own answers.
 */
export async function checkAddress(
	name: DeciderName,
	address: ModelAddress,
	options: TanstackDeciderOptions,
): Promise<string | null> {
	const spec = DECIDER_ADAPTERS[name];
	if (deciderAddress(name) === null || !spec.listAt) return null;
	const at = await reachAddress(address, options.secret);
	if ("problem" in at) {
		return `It needs the secret ${at.secret}. Add it on the Secrets page.`;
	}
	try {
		await spec.listAt(at, options);
		return null;
	} catch (error) {
		switch (listingReason(error)) {
			case "silent":
				return "Nothing answers there. Start the server, or change the address in Settings.";
			case "refused":
				return address.apiKey
					? `It refuses the API key. Check the secret ${address.apiKey}.`
					: "It wants an API key. Add the secret of its key to the address in Settings.";
			default:
				return null;
		}
	}
}
