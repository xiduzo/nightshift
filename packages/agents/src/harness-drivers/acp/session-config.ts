/**
 * Choose an ACP session's model and effort over the protocol.
 *
 * `acpCompatible` (`@tanstack/ai-acp`) starts a session but never sets its
 * config options, and some agents take no model flag on their command line:
 * pi through pi-acp, OpenCode 2.x (`opencode acp`). They offer the model as
 * a session config option instead (`configOptions`, category `model`).
 *
 * `withSessionConfig` wraps the JSON-RPC stream between the adapter's client
 * and the agent. Before the first prompt of a session it sends
 * `session/set_config_option` for the model (and the effort, when the agent
 * offers that thought level), waits for the answer, and only then lets the
 * prompt through. A refused model fails the prompt with the agent's own
 * reason. Everything else passes through untouched.
 */
import type { AnyMessage, Stream } from "@agentclientprotocol/sdk";

export type SessionConfig = {
	/** The model to choose. Unset: the agent's own setting. */
	model?: string;
	/** The effort, when the agent offers it as a thought level. */
	effort?: string;
};

type Id = string | number | null;
type Response = { id: Id; result?: unknown; error?: { message: string } };

/** A config option a `session/new` or `session/load` answer offers. */
type Option = {
	id: string;
	category: string | null;
	current: unknown;
	values: string[];
};

const OPENS = new Set(["session/new", "session/load", "session/resume"]);

const isRequest = (
	message: AnyMessage,
): message is AnyMessage & { id: Id; method: string; params?: unknown } =>
	"method" in message && "id" in message;

const isResponse = (message: AnyMessage): message is AnyMessage & Response =>
	!("method" in message) && "id" in message;

/** The select values of one config option, groups flattened. */
function valuesOf(option: { options?: unknown }): string[] {
	const list = Array.isArray(option.options) ? option.options : [];
	return list.flatMap((entry: { value?: unknown; options?: unknown }) =>
		typeof entry?.value === "string"
			? [entry.value]
			: Array.isArray(entry?.options)
				? valuesOf(entry)
				: [],
	);
}

function optionsOf(result: unknown): Option[] {
	const list = (result as { configOptions?: unknown } | null)?.configOptions;
	return (Array.isArray(list) ? list : []).map(
		(o: {
			id: string;
			category?: string | null;
			currentValue?: unknown;
			options?: unknown;
		}) => ({
			id: o.id,
			category: o.category ?? null,
			current: o.currentValue,
			values: valuesOf(o),
		}),
	);
}

/**
 * The stream with the session's model and effort chosen before its first
 * prompt. `label` names the agent in a refusal.
 */
export function withSessionConfig(
	inner: Stream,
	config: SessionConfig,
	label: string,
): Stream {
	/** Open requests by id: their method, and the session a load names. */
	const opening = new Map<Id, { method: string; sessionId?: string }>();
	const offered = new Map<string, { method: string; options: Option[] }>();
	const configured = new Set<string>();
	const waiting = new Map<string, (response: Response) => void>();
	const writer = inner.writable.getWriter();
	let next = 0;
	let inject: (message: AnyMessage) => void = () => {};

	const readable = new ReadableStream<AnyMessage>({
		start(controller) {
			inject = (message) => controller.enqueue(message);
			const reader = inner.readable.getReader();
			void (async () => {
				try {
					for (;;) {
						const { value, done } = await reader.read();
						if (done) break;
						if (isResponse(value)) {
							const own =
								typeof value.id === "string"
									? waiting.get(value.id)
									: undefined;
							if (own) {
								waiting.delete(value.id as string);
								own(value);
								continue;
							}
							const open = opening.get(value.id);
							if (open) {
								opening.delete(value.id);
								const sessionId =
									(value.result as { sessionId?: string } | undefined)
										?.sessionId ?? open.sessionId;
								if (sessionId && value.result !== undefined) {
									offered.set(sessionId, {
										method: open.method,
										options: optionsOf(value.result),
									});
								}
							}
						}
						controller.enqueue(value);
					}
					controller.close();
				} catch (error) {
					controller.error(error);
				}
			})();
		},
	});

	async function setOption(
		sessionId: string,
		option: Option,
		value: string,
	): Promise<string | null> {
		if (option.current === value) return null;
		const id = `nightshift-config-${++next}`;
		const answer = new Promise<Response>((resolve) => waiting.set(id, resolve));
		await writer.write({
			jsonrpc: "2.0",
			id,
			method: "session/set_config_option",
			params: { sessionId, configId: option.id, value },
		});
		const response = await answer;
		return response.error
			? response.error.message.replace(/^Invalid params:\s*/, "")
			: null;
	}

	/** Sets what the config asks for. A refusal text, or null. */
	async function configure(sessionId: string): Promise<string | null> {
		const offer = offered.get(sessionId);
		const find = (category: string) =>
			offer?.options.find((o) => o.category === category);
		if (config.model) {
			const option = find("model");
			if (option) {
				const refused = await setOption(sessionId, option, config.model);
				if (refused) {
					return `${label} did not take the model ${config.model}: ${refused}`;
				}
			} else if (offer?.method === "session/new") {
				// A resumed session keeps the model it started with.
				return `${label} does not let Night Shift choose the model. Set the model to default, and choose it in ${label}.`;
			}
		}
		const effort = find("thought_level");
		if (config.effort && effort?.values.includes(config.effort)) {
			// The effort is a wish: a refusal leaves the agent's own level.
			await setOption(sessionId, effort, config.effort);
		}
		return null;
	}

	const writable = new WritableStream<AnyMessage>({
		async write(message) {
			if (isRequest(message) && OPENS.has(message.method)) {
				const sessionId = (message.params as { sessionId?: string } | null)
					?.sessionId;
				opening.set(message.id, {
					method: message.method,
					...(sessionId ? { sessionId } : {}),
				});
			}
			if (isRequest(message) && message.method === "session/prompt") {
				const sessionId = (message.params as { sessionId?: string } | null)
					?.sessionId;
				if (sessionId && !configured.has(sessionId)) {
					configured.add(sessionId);
					const refusal = await configure(sessionId);
					if (refusal) {
						inject({
							jsonrpc: "2.0",
							id: message.id,
							error: { code: -32602, message: refusal },
						});
						return;
					}
				}
			}
			await writer.write(message);
		},
		close: () => writer.close(),
		abort: (reason) => writer.abort(reason),
	});

	return { readable, writable };
}
