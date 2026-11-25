import type { McpServerConfig } from "@nightshift/agents/types";
import type { SecretUse, StepRun } from "../contract";
import type { DeviceConnectionsPort } from "./ports";
import {
	redactExec,
	redactJson,
	redactJsonText,
	redactSession,
	redactText,
} from "./redact";
import type { ExecEvent, SessionEvent, ToolResult } from "./types";
import type { WebRequestResult } from "./web-request";
import { unreachableNote } from "./words";

/**
 * The secrets of one use on this computer: each job of a step (a session,
 * a command, a tool call, a web request) reads them here, and hides here
 * what comes back. Every value it read is hidden, so a job has no list of
 * its own. Which scopes a read asks is the Secret scope rule's
 * (`secretScopes`, ADR 13, ADR 18): this passes the facts of the use on.
 */
export type StepSecrets = {
	/** The facts of the use, for what reads its secrets itself (launchers, harnesses). */
	readonly use: SecretUse;
	/** The secrets by name, or why `subject` does not start: one is not saved here. */
	env(
		names: readonly string[],
		subject: string,
	): Promise<
		{ ok: true; env: Record<string, string> } | { ok: false; message: string }
	>;
	/** One secret, or nothing when it is not saved here. */
	one(name: string): Promise<string | undefined>;
	/** The MCP servers of these connections, with their `${NAME}` filled in. */
	servers(
		connections: string[] | undefined,
	): Promise<
		| { ok: true; servers: Record<string, McpServerConfig> }
		| { ok: false; message: string }
	>;
	/** Values that something else read for this use: hidden too. */
	add(values: readonly string[] | undefined): void;
	/** What comes back of the job, with every value as `•••`. */
	hideText(text: string): string;
	hideSession(events: AsyncIterable<SessionEvent>): AsyncIterable<SessionEvent>;
	hideExec(events: AsyncIterable<ExecEvent>): AsyncIterable<ExecEvent>;
	hideTool(result: ToolResult): ToolResult;
	hideRequest(result: WebRequestResult): WebRequestResult;
};

/** The secrets of one use, read from this computer's connections and secrets. */
export function stepSecrets(
	connections: DeviceConnectionsPort,
	run: StepRun | undefined,
	underOffer?: true,
): StepSecrets {
	const use: SecretUse = {
		...(run ? { run } : {}),
		...(underOffer ? { underOffer } : {}),
	};
	const values: string[] = [];
	return {
		use,
		async env(names, subject) {
			if (names.length === 0) return { ok: true, env: {} };
			const found = await connections.secretEnv(names, use);
			if (!found.ok) {
				return {
					ok: false,
					message: missingSecretsMessage(found.missing, found, subject),
				};
			}
			values.push(...Object.values(found.env));
			return { ok: true, env: found.env };
		},
		async one(name) {
			const found = await connections.secretEnv([name], use);
			const value = found.ok ? found.env[name] : undefined;
			if (value !== undefined) values.push(value);
			return value;
		},
		async servers(names) {
			const found = await connections.mcpServersFor(
				names ? { connections: names } : {},
				use,
			);
			if (!found.ok) return { ok: false, message: found.message };
			values.push(...(found.values ?? []));
			return { ok: true, servers: found.servers };
		},
		add(more) {
			values.push(...(more ?? []));
		},
		hideText: (text) => redactText(text, values),
		hideSession: (events) =>
			values.length > 0 ? redactSession(events, values) : events,
		hideExec: (events) =>
			values.length > 0 ? redactExec(events, values) : events,
		hideTool: (result) =>
			values.length > 0 ? hiddenTool(result, values) : result,
		hideRequest: (result) =>
			values.length > 0 ? hiddenRequest(result, values) : result,
	};
}

/**
 * Why a job does not start: secrets it names that this computer does not
 * have, and why when the Personal secrets could not be read.
 */
function missingSecretsMessage(
	missing: readonly string[],
	found: Parameters<typeof unreachableNote>[0],
	subject: string,
): string {
	const [noun, isNot, it] =
		missing.length === 1
			? ["secret", "it is", "it"]
			: ["secrets", "they are", "them"];
	return `${subject} needs the ${noun} ${missing.join(", ")}, but ${isNot} not saved. Save ${it} on the Secrets page, or remove ${it} from the node.${unreachableNote(found)}`;
}

/** A tool call's result with the values masked: its message, its text, its data and the arguments. */
function hiddenTool(result: ToolResult, values: readonly string[]): ToolResult {
	if (result.kind === "refused") {
		return { ...result, message: redactText(result.message, values) };
	}
	if (result.kind === "failed") {
		return {
			...result,
			message: redactText(result.message, values),
			arguments: redactJson(result.arguments, values),
		};
	}
	return {
		...result,
		arguments: redactJson(result.arguments, values),
		text: redactJsonText(result.text, values),
		structuredContent: redactJson(result.structuredContent, values),
	};
}

/** A request's result with the values masked: its messages, headers and body. */
function hiddenRequest(
	result: WebRequestResult,
	values: readonly string[],
): WebRequestResult {
	if (result.kind !== "answered") {
		return { ...result, message: redactText(result.message, values) };
	}
	const { response } = result;
	return {
		kind: "answered",
		response: {
			...response,
			statusText: redactText(response.statusText, values),
			// A header keeps its name: the step reads it by that.
			headers: redactJson(response.headers, values, "values"),
			body: redactJson(response.body, values),
		},
	};
}
