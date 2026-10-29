import jsonata from "jsonata";
import type { FlowInputDef } from "../flow";
import type { JsonValue } from "../nodes";
import {
	isTruthy,
	renderTemplate,
	renderValue,
	ruleMessage,
	type TemplateContext,
	templateRefs,
} from "../template";
import type { Schedule } from "./schedules";

/**
 * Webhook schedules: what a webhook is to a schedule once it arrived and
 * its secret checked out. The event (`{ body, headers }`), whether the
 * schedule's `when` holds for it, the flow's inputs it renders, and the key
 * of the signal it sends. Browser-safe: the signature check lives with the
 * daemon that receives the webhook.
 */

/** Where a webhook schedule listens, on the address of the computer that takes it. */
export const WEBHOOK_PATH = "/hooks";

/** The path of a schedule's webhook: `/hooks/<project id>/<schedule id>`. */
export function webhookPath(projectId: string, scheduleId: string): string {
	return `${WEBHOOK_PATH}/${encodeURIComponent(projectId)}/${encodeURIComponent(scheduleId)}`;
}

/**
 * A webhook as a schedule reads it: the body (JSON when it is JSON, else
 * the text) and the headers, by lower-case name, without the ones that
 * carry a secret.
 */
export type WebhookEvent = {
	body: JsonValue;
	headers: Record<string, string>;
};

/** Headers that carry a secret or a session: never part of the event. */
const SECRET_HEADERS = new Set([
	"authorization",
	"proxy-authorization",
	"cookie",
	"x-hub-signature",
	"x-hub-signature-256",
	"x-gitlab-token",
]);

/** The name of the secret a webhook names as `${NAME}`, or null. */
export function webhookSecretName(secret: string): string | null {
	return (
		/^\$\{([A-Za-z_][A-Za-z0-9_]{0,127})\}$/.exec(secret.trim())?.[1] ?? null
	);
}

/**
 * The event of a webhook: its headers without the secret ones, and its
 * body. A JSON body, or GitHub's form body (`payload=<json>`), is parsed;
 * any other body stays text. An empty body is null.
 */
export function webhookEvent(
	headers: Iterable<[string, string]>,
	body: string,
): WebhookEvent {
	const kept: Record<string, string> = {};
	for (const [name, value] of headers) {
		const key = name.toLowerCase();
		if (!SECRET_HEADERS.has(key)) kept[key] = value;
	}
	return { body: parsedBody(kept["content-type"] ?? "", body), headers: kept };
}

function parsedBody(contentType: string, body: string): JsonValue {
	if (body.trim() === "") return null;
	if (contentType.includes("application/x-www-form-urlencoded")) {
		const form = new URLSearchParams(body);
		const payload = form.get("payload");
		if (payload !== null) return parsedJson(payload) ?? payload;
		return Object.fromEntries(form);
	}
	return parsedJson(body) ?? body;
}

function parsedJson(text: string): JsonValue | undefined {
	try {
		return JSON.parse(text) as JsonValue;
	} catch {
		return undefined;
	}
}

/** What a JSONata expression over the event gave, or why it failed. */
type Evaluated = { value: JsonValue | undefined } | { error: string };

async function evaluate(
	expression: string,
	event: WebhookEvent,
): Promise<Evaluated> {
	try {
		const value: unknown = await jsonata(expression).evaluate({ event });
		return { value: value as JsonValue | undefined };
	} catch (error) {
		return { error: ruleMessage(error) };
	}
}

/**
 * Whether a webhook schedule takes the event: its `when` holds (as JSONata
 * reads true), or it has none. `error` says why the rule failed.
 */
export async function webhookHolds(
	schedule: Pick<Schedule, "webhook">,
	event: WebhookEvent,
): Promise<{ holds: boolean } | { error: string }> {
	const when = schedule.webhook?.when;
	if (when === undefined) return { holds: true };
	const result = await evaluate(when, event);
	if ("error" in result) return result;
	return { holds: isTruthy(result.value) };
}

/** A value as the text a key compares: "" when missing, JSON for objects. */
export function keyText(value: JsonValue | undefined): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/**
 * The key of the signal a webhook schedule sends, as text: its `key`
 * evaluated over the event, or null when it has none. `error` says why the
 * expression failed.
 */
export async function webhookSignalKey(
	schedule: Pick<Schedule, "signal">,
	event: WebhookEvent,
): Promise<{ key: string | null } | { error: string }> {
	const key = schedule.signal?.key;
	if (key === undefined) return { key: null };
	const result = await evaluate(key, event);
	if ("error" in result) return result;
	return { key: keyText(result.value) };
}

/**
 * A webhook schedule's input values for its flow, rendered over the event:
 * `{{event.body.pull_request.number}}`. A `json` input that is one
 * reference keeps the JSON value; any other value renders as text. A value
 * without a template is kept as it is.
 */
export function webhookInputs(
	schedule: Pick<Schedule, "inputs">,
	inputs: readonly FlowInputDef[],
	event: WebhookEvent,
): Record<string, JsonValue> {
	const context: TemplateContext = {
		nodes: {},
		inputs: { event: event as unknown as JsonValue },
		run: {
			branch: "",
			base_branch: "",
			index: "",
			worktree: "",
			base_ref: "",
			flow: "",
		},
	};
	const types = new Map(inputs.map((input) => [input.name, input.type]));
	const rendered: Record<string, JsonValue> = {};
	for (const [name, value] of Object.entries(schedule.inputs)) {
		if (typeof value !== "string" || templateRefs(value).length === 0) {
			rendered[name] = value;
		} else if (types.get(name) === "json") {
			rendered[name] = renderValue(value, context);
		} else {
			rendered[name] = renderTemplate(value, context);
		}
	}
	return rendered;
}
