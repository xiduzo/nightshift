import { z } from "zod";
import {
	jsonSchemaSchema,
	type NodeCheck,
	nodeBase,
	outputInferredSchema,
	placed,
	requestHeadersSchema,
	secretNameSchema,
} from "./base";
import { type NodeDefinition, noOwnColors } from "./definition";

/**
 * The Web request node: one HTTP request from the step's computer, with no
 * shell and no project folder. Its answer is typed data: `status`,
 * `headers` and `body`. A secret reaches the request only as `${NAME}` in
 * the node's own text, never through a value a template renders.
 */

export const WEB_REQUEST_METHODS = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"HEAD",
] as const;
export type WebRequestMethod = (typeof WEB_REQUEST_METHODS)[number];

/** How much of an answer a step keeps by default: 1 MiB. */
export const DEFAULT_WEB_REQUEST_MAX_BYTES = 1024 * 1024;
/** The most a node may ask to keep: 10 MiB. Every Replica of the Space keeps the answer. */
export const MAX_WEB_REQUEST_BYTES = 10 * 1024 * 1024;
/** How long one request may take by default. */
export const DEFAULT_WEB_REQUEST_TIMEOUT_SECONDS = 30;

/**
 * What the request sends. `json`: a JSON text whose strings are templates;
 * a string that is one reference keeps its JSON value
 * (`{ "items": "{{plan.data.tasks}}" }` sends the list). `text`: a template,
 * sent as `contentType` (default `text/plain; charset=utf-8`). `form`: one
 * template per field, sent as a form.
 */
export const webRequestBodySchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("json"), value: z.string() }),
	z.object({
		kind: z.literal("text"),
		value: z.string(),
		contentType: z.string().trim().min(1).max(200).optional(),
	}),
	z.object({
		kind: z.literal("form"),
		fields: z.record(z.string().min(1), z.string()),
	}),
]);
export type WebRequestBody = z.infer<typeof webRequestBodySchema>;

export const webRequestNodeSchema = z.object({
	...nodeBase,
	...placed,
	type: z.literal("web-request"),
	method: z.enum(WEB_REQUEST_METHODS).default("GET"),
	/**
	 * Where it goes: an `http://` or `https://` URL, a template. `${NAME}`
	 * in it reads a secret on the step's computer. Exactly one of `url` and
	 * `urlSecret`.
	 */
	url: z.string().optional(),
	/**
	 * A secret that holds the whole URL, by name: a template that renders
	 * the name (`SLACK_WEBHOOK_URL`, or `{{channel}}`). For an incoming
	 * webhook, whose address is its key: Night Shift never shows it.
	 */
	urlSecret: z.string().optional(),
	/** Added to the URL's query, one template per name. `${NAME}` reads a secret. */
	query: z.record(z.string().min(1), z.string()).optional(),
	/** One template per header. `${NAME}` reads a secret: `Bearer ${API_TOKEN}`. */
	headers: requestHeadersSchema.optional(),
	body: webRequestBodySchema.optional(),
	/** How long the request may take. Default 30 seconds. */
	timeoutSeconds: z.number().int().positive().max(600).optional(),
	/**
	 * The most of the answer the step keeps, in bytes: a larger answer
	 * ends the step `fail`. Default 1 MiB, at most 10 MiB.
	 */
	maxBytes: z.number().int().positive().max(MAX_WEB_REQUEST_BYTES).optional(),
	/**
	 * A JSON Schema for the answer's `body`, as `output` on an Agent node.
	 * Later nodes read its fields (`{{fetch.body.items}}`).
	 */
	output: jsonSchemaSchema.optional(),
	/** Night Shift inferred `output` from a real output (`outputInferredSchema`). */
	outputInferred: outputInferredSchema,
});
export type WebRequestNode = z.infer<typeof webRequestNodeSchema>;

/**
 * status: the HTTP status. headers: the answer's headers, by lower-case
 * name. body: the JSON the server sent when it says JSON, else its text.
 */
export const webRequestOutputFields = [
	"outcome",
	"status",
	"headers",
	"body",
	"visit",
] as const;

/** `pass` on a 2xx answer, `fail` on any other answer or a request that went wrong. */
export const webRequestOutcomes = ["pass", "fail"] as const;

/** A secret reference in a node's own text: `${API_TOKEN}`. */
const SECRET_REF = /\$\{([A-Za-z_][A-Za-z0-9_]{0,127})\}/g;

/**
 * Text with secrets in it: each `${NAME}` is a part of its own, the rest
 * is text. Only a node's own text is split: a value that a template
 * renders stays text, so a `${NAME}` in it is never filled.
 */
export type SecretPart = { text: string } | { secret: string };

/** `text` as parts: its text and its `${NAME}` references, in order. */
export function secretParts(text: string): SecretPart[] {
	const parts: SecretPart[] = [];
	let last = 0;
	for (const match of text.matchAll(SECRET_REF)) {
		if (match.index > last) parts.push({ text: text.slice(last, match.index) });
		parts.push({ secret: match[1] ?? "" });
		last = match.index + match[0].length;
	}
	if (last < text.length || parts.length === 0) {
		parts.push({ text: text.slice(last) });
	}
	return parts;
}

/** The secrets `text` reads: each `${NAME}` in it, in order. */
export function secretNamesIn(text: string): string[] {
	return secretParts(text).flatMap((part) =>
		"secret" in part ? [part.secret] : [],
	);
}

/**
 * The secrets a Web request reads: the one that holds its URL, and each
 * `${NAME}` of its own text. `urlSecret` is a template: `known` gives the
 * text it renders before a run, or null when only a run knows it
 * (`{{webhook}}` reads an input that the run gets).
 */
export function webRequestSecrets(
	node: WebRequestNode,
	known: (template: string) => string | null,
): string[] {
	const urlSecret =
		node.urlSecret === undefined ? "" : (known(node.urlSecret)?.trim() ?? "");
	return [
		...(secretNameSchema.safeParse(urlSecret).success ? [urlSecret] : []),
		...ownTexts(node).flatMap(({ text }) => secretNamesIn(text)),
	];
}

/** The texts of a Web request node that may hold `${NAME}`, by what the person calls them. */
function ownTexts(node: WebRequestNode): { where: string; text: string }[] {
	const body = node.body;
	return [
		...(node.url !== undefined ? [{ where: "URL", text: node.url }] : []),
		...Object.entries(node.query ?? {}).map(([name, text]) => ({
			where: `query value "${name}"`,
			text,
		})),
		...Object.entries(node.headers ?? {}).map(([name, text]) => ({
			where: `header "${name}"`,
			text,
		})),
		...(body === undefined
			? []
			: body.kind === "form"
				? Object.entries(body.fields).map(([name, text]) => ({
						where: `form field "${name}"`,
						text,
					}))
				: [{ where: "body", text: body.value }]),
	];
}

/**
 * The checks of a Web request node: one place it goes (`url` or
 * `urlSecret`), an address that can work, no body on a GET or a HEAD, a
 * JSON body that is valid, and templates that read known names.
 */
export function checkWebRequestNode(
	node: WebRequestNode,
	check: NodeCheck,
): void {
	const title = `Web request node "${node.id}"`;
	const url = node.url?.trim() ?? "";
	const urlSecret = node.urlSecret?.trim() ?? "";
	if (url === "" && urlSecret === "") {
		check.error(`${title} needs a URL, or a secret that holds one.`);
	} else if (url !== "" && urlSecret !== "") {
		check.error(
			`${title} has a URL and a secret that holds one. Keep one of them.`,
		);
	}
	if (url !== "") checkUrl(url, title, check);
	if (urlSecret !== "") {
		check.template(urlSecret, "URL secret");
		if (
			!urlSecret.includes("{{") &&
			!secretNameSchema.safeParse(urlSecret).success
		) {
			check.error(
				`${title}: "${urlSecret}" is not the name of a secret. Use letters, digits and _, for example SLACK_WEBHOOK_URL.`,
			);
		}
	}
	for (const { where, text } of ownTexts(node)) {
		check.template(text, where);
	}
	const body = node.body;
	if (body !== undefined && (node.method === "GET" || node.method === "HEAD")) {
		check.error(
			`${title} sends a body with ${node.method}. Use POST, PUT or PATCH, or remove the body.`,
		);
	}
	if (body?.kind === "json") checkJsonBody(body.value, title, check);
}

/** A URL without templates or secrets must be a valid `http://` or `https://` address. */
function checkUrl(url: string, title: string, check: NodeCheck): void {
	if (url.includes("{{") || url.includes("${")) {
		if (!/^(https?:\/\/|\{\{|\$\{)/i.test(url)) {
			check.error(
				`${title}: the URL must start with http:// or https://, for example https://api.example.com/items.`,
			);
		}
		return;
	}
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		check.error(
			`${title}: "${url}" is not a valid URL. Use an address such as https://api.example.com/items.`,
		);
		return;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		check.error(
			`${title}: the URL must start with http:// or https://, for example https://api.example.com/items.`,
		);
	}
}

/**
 * A JSON body is valid JSON, or one reference that renders the whole
 * body. A template goes in quotes: a quoted template that is one
 * reference keeps its JSON value.
 */
function checkJsonBody(value: string, title: string, check: NodeCheck): void {
	const text = value.trim();
	if (text === "" || /^\{\{[^}]*\}\}$/.test(text)) return;
	try {
		JSON.parse(text);
	} catch {
		check.error(
			`${title}: the JSON body is not valid. Check its format, and put each template in quotes: "{{plan.data.tasks}}".`,
		);
	}
}

/** The Web request node type. */
export const webRequestDefinition = {
	type: "web-request",
	label: "Web request",
	family: "do",
	standsIn: true,
	outcomes: () => webRequestOutcomes,
	outcomeColor: noOwnColors,
	outputFields: webRequestOutputFields,
	check: checkWebRequestNode,
	secrets: webRequestSecrets,
	sample: {
		id: "fetch",
		type: "web-request",
		position: { x: 0, y: 0 },
		url: "https://api.example.com/items",
		query: { q: "{{topic}}" },
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
		headers: { Authorization: "Bearer ${API_TOKEN}" },
	},
} satisfies NodeDefinition<
	WebRequestNode,
	z.input<typeof webRequestNodeSchema>
>;
