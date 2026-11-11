import {
	DEFAULT_WEB_REQUEST_MAX_BYTES,
	DEFAULT_WEB_REQUEST_TIMEOUT_SECONDS,
	type JsonValue,
	renderTemplate,
	renderValue,
	secretParts,
	type TemplateContext,
	type WebRequestMethod,
	type WebRequestNode,
} from "@nightshift/flows";
import { parseInstant } from "@nightshift/time";

import type {
	Capabilities,
	RequestField,
	RequestPart,
	RequestText,
	WebRequestInput,
	WebResponse,
} from "../../device";
import type { StepOutputs } from "../../log";
import {
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../context";
import { RESUME_RULES } from "../resume-point";
import { type BodyResult, runStep, type StepHandle } from "../step-runner";

/**
 * The Web request node: one HTTP request from the step's Device
 * (`Device.request`), with no shell and no project folder. The engine
 * renders the node's text into parts: each `${NAME}` of the node's own
 * text is a secret part, which the Device fills in; every other piece has
 * its templates rendered and stays text, so a `${NAME}` that a template
 * renders is never filled. The Device checks the addresses, follows
 * redirects, keeps at most `maxBytes` and masks the secrets in the answer.
 *
 * `pass` on 2xx, `fail` on any other answer, on an answer that is too
 * large or on a redirect that goes wrong. A 429 waits as a usage limit
 * does, until the `Retry-After` the server sends. A 5xx, a server that
 * cannot be reached or does not answer in time waits as the network does;
 * the run policy's grace bounds both. Outputs: `status`, `headers`, `body`
 * (JSON when the server says JSON, else text) and `visit`.
 *
 * Every visit is new (`RESUME_RULES.fresh`); a step that waits continues
 * and asks again.
 */
export function webRequestNode(
	node: WebRequestNode,
	ctx: StepContext,
): NodeAction {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: WEB_REQUEST.resumeRules(node),
			body: (step) => sendWebRequest(ctx, node, step),
		});
}

/** The words of a Device too old to send web requests, or null when it can. */
export function sendsRequests(
	what: string,
	nodes: readonly { id: string }[],
	has: Capabilities,
): string | null {
	if (nodes.length === 0 || has.requests) return null;
	const where = has.elsewhere ?? "this computer";
	return `${what} (${nodes.map((n) => n.id).join(", ")}), but ${where} runs an older version of Night Shift. Update Night Shift on ${where}.`;
}

/**
 * The Web request kind. A wait node for its policy waits (a 429, a server
 * that is down), the Device only, and a Device that sends web requests.
 */
export const WEB_REQUEST: NodeKind<WebRequestNode> = {
	...PLAIN_KIND,
	type: "web-request",
	make: webRequestNode,
	works: () => "device",
	aux: () => [{ kind: "wait" }],
	resumeRules: () => RESUME_RULES.fresh,
	requirements: [
		(nodes, has) => sendsRequests("The flow sends web requests", nodes, has),
	],
};

/** A node's own text as parts: `${NAME}` a secret, every other piece with its templates rendered. */
export function requestText(
	text: string,
	tctx: TemplateContext,
): RequestPart[] {
	return secretParts(text).map((part) =>
		"secret" in part ? part : { text: renderTemplate(part.text, tctx) },
	);
}

function fieldsOf(
	record: Record<string, string> | undefined,
	tctx: TemplateContext,
): RequestField[] {
	return Object.entries(record ?? {}).map(([name, text]) => ({
		name,
		value: requestText(text, tctx),
	}));
}

/** The request of a node, rendered. Throws for a JSON body that is not valid. */
export function webRequestOf(
	node: WebRequestNode,
	tctx: TemplateContext,
	signal: AbortSignal,
): WebRequestInput {
	const urlSecret = node.urlSecret?.trim() ?? "";
	const body = node.body;
	return {
		method: node.method,
		url:
			urlSecret !== ""
				? [{ secret: renderTemplate(urlSecret, tctx).trim() }]
				: requestText(node.url ?? "", tctx),
		query: fieldsOf(node.query, tctx),
		headers: fieldsOf(node.headers, tctx),
		...(body === undefined
			? {}
			: body.kind === "form"
				? { body: { kind: "form", fields: fieldsOf(body.fields, tctx) } }
				: body.kind === "text"
					? {
							body: {
								kind: "text",
								contentType: body.contentType ?? "text/plain; charset=utf-8",
								text: requestText(body.value, tctx),
							},
						}
					: body.value.trim() === ""
						? {}
						: {
								body: {
									kind: "text",
									contentType: "application/json",
									text: jsonBody(body.value, tctx),
								},
							}),
		timeoutMs:
			(node.timeoutSeconds ?? DEFAULT_WEB_REQUEST_TIMEOUT_SECONDS) * 1000,
		maxBytes: node.maxBytes ?? DEFAULT_WEB_REQUEST_MAX_BYTES,
		signal,
	};
}

/** The GET of a Wait for a URL, rendered. */
export function urlWaitRequest(
	url: string,
	headers: Record<string, string> | undefined,
	tctx: TemplateContext,
	signal: AbortSignal,
): WebRequestInput {
	return {
		method: "GET" satisfies WebRequestMethod,
		url: requestText(url, tctx),
		headers: fieldsOf(headers, tctx),
		timeoutMs: DEFAULT_WEB_REQUEST_TIMEOUT_SECONDS * 1000,
		maxBytes: DEFAULT_WEB_REQUEST_MAX_BYTES,
		signal,
	};
}

/**
 * A JSON body as parts. Its strings are templates: one that is a single
 * reference keeps its JSON value, any other renders as text. A string
 * with a `${NAME}` stays a string, the secret escaped inside it. A body
 * that is one reference sends that value.
 */
export function jsonBody(value: string, tctx: TemplateContext): RequestPart[] {
	const text = value.trim();
	let parsed: JsonValue;
	try {
		parsed = JSON.parse(text) as JsonValue;
	} catch (error) {
		if (/^\{\{[^}]*\}\}$/.test(text)) {
			return [{ text: JSON.stringify(renderValue(text, tctx)) }];
		}
		throw new Error(
			`The JSON body is not valid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const parts: RequestPart[] = [];
	const push = (part: RequestPart) => {
		const last = parts.at(-1);
		if ("text" in part && last && "text" in last) {
			parts[parts.length - 1] = { text: last.text + part.text };
		} else parts.push(part);
	};
	const walk = (item: JsonValue): void => {
		if (typeof item === "string") {
			const pieces = secretParts(item);
			if (pieces.every((piece) => "text" in piece)) {
				push({ text: JSON.stringify(renderValue(item, tctx)) });
				return;
			}
			push({ text: '"' });
			for (const piece of pieces) {
				push(
					"secret" in piece
						? { secret: piece.secret, escape: "json" }
						: {
								text: JSON.stringify(renderTemplate(piece.text, tctx)).slice(
									1,
									-1,
								),
							},
				);
			}
			push({ text: '"' });
			return;
		}
		if (Array.isArray(item)) {
			push({ text: "[" });
			item.forEach((element, index) => {
				if (index > 0) push({ text: "," });
				walk(element);
			});
			push({ text: "]" });
			return;
		}
		if (typeof item === "object" && item !== null) {
			push({ text: "{" });
			Object.entries(item).forEach(([key, element], index) => {
				push({ text: `${index > 0 ? "," : ""}${JSON.stringify(key)}:` });
				walk(element);
			});
			push({ text: "}" });
			return;
		}
		push({ text: JSON.stringify(item) });
	};
	walk(parsed);
	return parts;
}

/** A request text as a person may see it: each secret as `${NAME}`, never its value. */
export function shownText(text: RequestText): string {
	return text
		.map((part) => ("text" in part ? part.text : `\${${part.secret}}`))
		.join("");
}

/** The URL of a request as the transcript shows it, with its query. */
export function shownUrl(input: WebRequestInput): string {
	const query = (input.query ?? [])
		.map(
			(field) =>
				`${encodeURIComponent(field.name)}=${encodeURIComponent(shownText(field.value))}`,
		)
		.join("&");
	const url = shownText(input.url);
	const whole =
		query === "" ? url : `${url}${url.includes("?") ? "&" : "?"}${query}`;
	return whole.length > 2000 ? `${whole.slice(0, 1999)}…` : whole;
}

/**
 * When a 429 says to ask again: `Retry-After` in seconds or as a date.
 * Null when it says neither.
 */
export function retryAfterOf(
	value: string | undefined,
	now: number,
): number | null {
	if (value === undefined) return null;
	const text = value.trim();
	if (/^\d+$/.test(text)) return now + Number(text) * 1000;
	const at = parseInstant(text);
	return Number.isNaN(at) ? null : at;
}

/** The status line of an answer: "404 Not Found". */
export function statusLine(
	response: Pick<WebResponse, "status" | "statusText">,
): string {
	return `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
}

async function sendWebRequest(
	ctx: StepContext,
	node: WebRequestNode,
	step: StepHandle,
): Promise<BodyResult> {
	const { visit, signal } = step;
	const empty: StepOutputs = { visit };
	const end = (
		outcome: string,
		outputs: StepOutputs,
		error: string | null,
	): BodyResult => ({ kind: "end", outcome, outputs, error });

	let input: WebRequestInput;
	try {
		input = webRequestOf(node, step.tctx, signal);
	} catch (error) {
		return end(
			"error",
			empty,
			error instanceof Error ? error.message : String(error),
		);
	}
	step.record(null, {
		type: "web-request",
		method: input.method,
		url: shownUrl(input),
	});
	const result = await step.device.request(input);
	if (signal.aborted) return { kind: "aborted", outputs: empty };
	if (result.kind === "refused") return end("error", empty, result.message);
	if (result.kind === "failed") {
		step.record(null, {
			type: "web-response",
			status: null,
			text: result.message,
			bytes: null,
		});
		return result.network
			? {
					kind: "wait",
					reason: "network",
					message: result.message,
					resetAt: null,
					harnessSessionId: null,
				}
			: end("fail", empty, result.message);
	}
	const { response } = result;
	step.record(null, {
		type: "web-response",
		status: response.status,
		text: response.statusText,
		bytes: response.bytes,
	});
	const line = statusLine(response);
	if (response.status === 429) {
		return {
			kind: "wait",
			reason: "usage-limit",
			message: `the server answered ${line}`,
			resetAt: retryAfterOf(response.headers["retry-after"], ctx.now()),
			harnessSessionId: null,
		};
	}
	if (response.status >= 500) {
		return {
			kind: "wait",
			reason: "network",
			message: `the server answered ${line}`,
			resetAt: null,
			harnessSessionId: null,
		};
	}
	const outputs: StepOutputs = {
		visit,
		status: response.status,
		headers: response.headers,
		body: response.body,
	};
	const ok = response.status >= 200 && response.status < 300;
	return end(
		ok ? "pass" : "fail",
		outputs,
		ok ? null : `The server answered ${line}.`,
	);
}
