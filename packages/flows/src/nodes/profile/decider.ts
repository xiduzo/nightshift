import { z } from "zod";
import type { NodeCheck } from "../base";
import { secretNameSchema } from "../names";
import type { ProfileRef } from "./device";

/**
 * Who decides a Decision or a Value by a model: the deciders, the address
 * of a model's server, and the headers of a request a node makes.
 */

/**
 * Who decides a Decision node: a TanStack AI decision model, through
 * `decide()`. TypeSafe and OpenRouter serve Jev, OpenAI its Decisions API,
 * Ollaya a `laya` model on this computer, Ollama any chat model pulled on
 * this computer. OpenJev serves the Jev wire API at an address, and
 * `compatible` is any OpenAI-compatible chat server at an address (ADR 5).
 */
export const deciderNameSchema = z.enum([
	"typesafe",
	"openrouter",
	"openai",
	"ollaya",
	"ollama",
	"openjev",
	"compatible",
]);
export type DeciderName = z.infer<typeof deciderNameSchema>;

/**
 * Whether a decider reaches a server at an address (ADR 5): `required` for
 * one that has no vendor API, `optional` for one whose default the address
 * replaces (OpenAI's API, the Device's Ollama), null for a vendor API only.
 */
const DECIDER_ADDRESS: Record<DeciderName, "required" | "optional" | null> = {
	typesafe: null,
	openrouter: null,
	openai: "optional",
	ollaya: null,
	ollama: "optional",
	openjev: "required",
	compatible: "required",
};

/** Whether the decider takes an address, and whether it needs one. */
export function deciderAddress(
	name: DeciderName,
): "required" | "optional" | null {
	return DECIDER_ADDRESS[name];
}

/**
 * Whether a decider gives a probability with its pick. A chat model
 * (Ollama, an OpenAI-compatible server) gives the pick only, so a cascade
 * cannot test it against a `minConfidence` (ADR 6).
 */
export function deciderMeasuresProbability(name: DeciderName): boolean {
	return name !== "ollama" && name !== "compatible";
}

/** A header name, as HTTP allows it. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * The headers of a request a node makes (a Web request, a Wait for a URL):
 * one template per header name. `${NAME}` reads a secret.
 */
export const requestHeadersSchema = z
	.record(
		z.string().regex(HEADER_NAME, "Use a header name such as Authorization."),
		z.string(),
	)
	.refine((headers) => Object.keys(headers).length <= 32, {
		message: "Use at most 32 headers.",
	});

/** An `http://` or `https://` URL without a query or a fragment. */
function isServerUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.search === "" &&
			url.hash === ""
		);
	} catch {
		return false;
	}
}

/**
 * Where a Model Profile's decider finds its server (ADR 5): a base URL, the
 * secret that holds its API key, and headers whose values may read secrets
 * as `${NAME}`. Only names of secrets: the Device that runs the step reads
 * their values. The base URL is the server, for example
 * `http://127.0.0.1:8080`; a trailing `/v1` is fine too.
 */
export const modelAddressSchema = z.object({
	baseUrl: z
		.string()
		.trim()
		.refine(
			isServerUrl,
			"Use an http:// or https:// address, such as http://127.0.0.1:8080.",
		),
	/** The secret that holds the API key, sent as a bearer token. Unset: none. */
	apiKey: secretNameSchema.optional(),
	headers: z
		.record(
			z.string().regex(HEADER_NAME, "Use a header name such as X-Api-Key."),
			z.string().trim().min(1, "A header needs a value.").max(4000),
		)
		.refine((headers) => Object.keys(headers).length <= 32, {
			message: "Use at most 32 headers.",
		})
		.optional(),
});
export type ModelAddress = z.infer<typeof modelAddressSchema>;

/** The plain text of a node's address (`modelAddressSchema`). */
export const modelAddressPlain: readonly string[] = [
	"address.baseUrl",
	"address.headers{}",
];

/**
 * The server of an address, without a trailing `/v1`: each adapter adds its
 * own path (`/v1/systemone`, `/v1/chat/completions`, `/api/tags`).
 */
export function addressRoot(address: Pick<ModelAddress, "baseUrl">): string {
	return address.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * A Decision or a Value decided by a model reaches an address through its
 * Model Profile only (ADR 5): the address belongs to the profile, so it
 * belongs to one Device. A run copies it onto the node when it resolves
 * the profile, so a flow never sets one. A decider that needs an address
 * therefore needs a profile.
 */
export function checkModelAddress(
	node: {
		id: string;
		by: string;
		decider?: DeciderName;
		profile?: ProfileRef;
		address?: ModelAddress;
	},
	title: "Decision" | "Value",
	check: NodeCheck,
): void {
	if (node.address !== undefined) {
		check.error(
			`${title} node "${node.id}" sets an address. Put the address on a Model Profile, and pick that profile.`,
		);
		return;
	}
	if (
		node.by === "model" &&
		node.profile === undefined &&
		node.decider !== undefined &&
		deciderAddress(node.decider) === "required"
	) {
		check.error(
			`${title} node "${node.id}" uses the decider "${node.decider}", which needs an address. Pick a Model Profile on ${node.decider} that has one.`,
		);
	}
}
