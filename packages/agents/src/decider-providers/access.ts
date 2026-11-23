/**
 * What one decider call connects with: the secrets of the call, the API
 * key, and the address of the node's Model Profile with its secrets read.
 */

import {
	addressRoot,
	deciderAddress,
	type ModelAddress,
} from "@nightshift/flows";
import type { DeciderName, DecisionInput } from "../port";
import type { AddressAccess } from "./address";
import type {
	DeciderAccess,
	DeciderAdapter,
	DeciderContext,
} from "./decider-record";

export type TanstackDeciderOptions = DeciderContext & {
	/**
	 * A secret's value: the run's Project (with `run`), Personal, the
	 * keychain, then the environment.
	 */
	secret: (
		name: string,
		run?: DecisionInput["run"],
	) => Promise<string | undefined>;
};

/** The secrets of one call: the run's, when the call names one. */
export function secretsOf(
	options: TanstackDeciderOptions,
	run: DecisionInput["run"],
): (name: string) => Promise<string | undefined> {
	return run
		? (name) => options.secret(name, run)
		: (name) => options.secret(name);
}

/** `${NAME}`: a secret, as a header value reads it. */
const SECRET_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The key and the address an adapter connects with, or why it cannot: a
 * missing secret. With an address, its own key and headers, and no vendor
 * key (ADR 5); a vendor API without a key fails as before.
 */
export async function accessFor(
	spec: DeciderAdapter,
	address: ModelAddress | undefined,
	name: DeciderName,
	secret: (name: string) => Promise<string | undefined>,
): Promise<DeciderAccess | { problem: string }> {
	if (address === undefined && deciderAddress(name) === "required") {
		return {
			problem: `${spec.label} needs an address. Pick a Model Profile with the address of its server.`,
		};
	}
	if (address === undefined || deciderAddress(name) === null) {
		const apiKey = spec.apiKey ? await secret(spec.apiKey) : undefined;
		if (spec.apiKey && !apiKey) {
			return {
				problem: `${spec.label} needs an API key. Add the secret ${spec.apiKey} on the Secrets page.`,
			};
		}
		return { apiKey, address: undefined };
	}
	const at = await reachAddress(address, secret);
	if ("problem" in at) return { problem: at.problem };
	const { apiKey, ...reachedAt } = at;
	return { apiKey, address: reachedAt };
}

/**
 * A Model Profile's address with its secrets read: the API key's value and
 * the headers with `${NAME}` filled in, or which secret is missing. The
 * secrets are this Device's own (ADR 1).
 */
export async function reachAddress(
	address: ModelAddress,
	secret: (name: string) => Promise<string | undefined>,
): Promise<AddressAccess | { problem: string; secret: string }> {
	const missing = (name: string) => ({
		problem: `The address ${address.baseUrl} needs the secret ${name}. Add it on the Secrets page.`,
		secret: name,
	});
	const apiKey = address.apiKey ? await secret(address.apiKey) : undefined;
	if (address.apiKey && !apiKey) return missing(address.apiKey);
	const headers: Record<string, string> = {};
	for (const [header, value] of Object.entries(address.headers ?? {})) {
		let filled = value;
		for (const match of value.matchAll(SECRET_REFERENCE)) {
			const ref = match[1] as string;
			const found = await secret(ref);
			if (found === undefined) return missing(ref);
			filled = filled.replaceAll(match[0], found);
		}
		headers[header] = filled;
	}
	return { root: addressRoot(address), headers, apiKey };
}
