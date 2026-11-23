import type { DeciderName } from "@nightshift/flows";
import { valueDeciderNameSchema } from "@nightshift/flows";

/** The secret that holds the TypeSafe Jev key: the guided setup saves it there. */
export const TYPESAFE_API_KEY = "TYPESAFE_API_KEY";

/**
 * The model the guided setup downloads for a decider on this computer
 * (Q22), and about how big its download is: 2.0 GB, as ollama.com lists
 * it. The person sees the size before the download starts.
 */
export const LOCAL_DECIDER_MODEL = {
	name: "llama3.2:latest",
	bytes: 2_000_000_000,
} as const;

/**
 * What the guided setup of a decider needs (Q22): the secret of the
 * TypeSafe Jev key, and the model a decider on this computer downloads.
 */
export const DECIDER_SETUP = {
	typesafeKey: TYPESAFE_API_KEY,
	localModel: LOCAL_DECIDER_MODEL,
} as const;

/** The person-visible name of each decider (the registry uses the same words). */
export const DECIDER_LABELS: Record<DeciderName, string> = {
	typesafe: "TypeSafe Jev",
	openrouter: "Jev on OpenRouter",
	openai: "OpenAI Decisions",
	ollaya: "Ollaya on this computer",
	ollama: "Ollama on this computer",
	openjev: "OpenJev",
	compatible: "OpenAI-compatible server",
};

/** Default decision and value models per decider (the registry uses the same ids). */
export const DECIDER_DEFAULTS: Record<
	DeciderName,
	{ decision: string; value: string | null }
> = {
	typesafe: { decision: "jev-latest", value: null },
	openrouter: {
		decision: "~typesafe/jev-latest",
		value: "~openai/gpt-mini-latest",
	},
	openai: { decision: "gpt-6-luna", value: "gpt-5-mini" },
	ollaya: { decision: "laya:latest", value: null },
	ollama: {
		decision: LOCAL_DECIDER_MODEL.name,
		value: LOCAL_DECIDER_MODEL.name,
	},
	openjev: { decision: "openjev-latest", value: null },
	compatible: { decision: "default", value: "default" },
};

/** What a decider without a text adapter answers a Value node. */
export function cannotMakeValueMessage(name: DeciderName): string {
	const labels = valueDeciderNameSchema.options.map(
		(other) => DECIDER_LABELS[other],
	);
	const able =
		labels.length > 1
			? `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`
			: (labels[0] ?? "");
	return `${DECIDER_LABELS[name]} cannot make a value. Choose ${able}.`;
}

/**
 * The model a decider starts a node on when the node names none. What
 * `Decider.defaultModel` answers for the TanStack decider and the fake
 * alike, so both sit at the same seam with the same values.
 */
export function defaultDeciderModel(
	name: DeciderName,
	makes: "decision" | "value",
): string {
	const entry = DECIDER_DEFAULTS[name];
	return makes === "value" ? (entry.value ?? entry.decision) : entry.decision;
}
