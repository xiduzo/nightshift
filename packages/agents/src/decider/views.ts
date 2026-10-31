import { deciderAddress, deciderNameSchema } from "@nightshift/flows";

import type { DeciderName } from "../port";
import {
	DECIDER_ADAPTERS,
	type DeciderContext,
	deciderModels,
} from "./decider";

/**
 * A decider as the Agents page lists it. `Source` is the caller's: where
 * the value of its API key comes from.
 */
export type DeciderView<Source> = {
	name: DeciderName;
	label: string;
	/** The `@tanstack/ai-*` package. */
	pkg: string;
	/** The models that decide: the provider's listing first, then the adapter's. */
	models: string[];
	/** How many models came from the provider's listing. */
	listed: number;
	/** Why the provider's listing did not answer. Null when it did, or has none. */
	listProblem: string | null;
	defaultModel: string;
	/** The secret that holds its API key. Null: it needs none. */
	apiKey: string | null;
	apiKeySource: Source | null;
	/** Set when the decider can also make a value (a Value node made by a model). */
	value: { defaultModel: string; models: string[] } | null;
	/**
	 * Whether a Model Profile gives it an address (ADR 5): `required` for a
	 * server without a vendor API, `optional` where the address replaces
	 * the default, null for a vendor API only.
	 */
	address: "required" | "optional" | null;
	/** False when it reports a pick without a probability (a chat model). */
	probability: boolean;
};

/**
 * The deciders Decision and Value nodes pick from, and whether each has its
 * API key. A decider that lists its models (Ollama: the models pulled on
 * this computer) puts those first. Never throws.
 */
export function deciderViews<Source>(
	/** Where the value of an API key's secret comes from. */
	secretSource: (name: string) => Source,
	/** Where Ollama is, for its listing of the models it has. */
	context: DeciderContext = {},
): Promise<DeciderView<Source>[]> {
	return Promise.all(
		deciderNameSchema.options.map(async (name) => {
			const adapter = DECIDER_ADAPTERS[name];
			const offered = await deciderModels(name, context);
			return {
				name,
				label: adapter.label,
				pkg: adapter.pkg,
				models: offered.models,
				listed: offered.listed,
				listProblem: offered.problem,
				defaultModel: adapter.defaultModel,
				apiKey: adapter.apiKey,
				apiKeySource: adapter.apiKey ? secretSource(adapter.apiKey) : null,
				value: adapter.value
					? {
							defaultModel: adapter.value.defaultModel,
							models: offered.valueModels,
						}
					: null,
				address: deciderAddress(name),
				probability: adapter.probability !== false,
			};
		}),
	);
}
