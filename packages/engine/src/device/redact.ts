import type { ExecEvent } from "./types";

/** What a secret value becomes in a command's output, as in an exported run. */
export const SECRET_MASK = "•••";

/**
 * Takes secret values out of text that arrives in chunks. A value split
 * over two chunks is still found: the end of a chunk that could start a
 * value waits for the next chunk, or for `flush`. Each value also goes as
 * it appears inside a JSON string, so data parsed from the output has none.
 */
export function streamRedactor(values: readonly string[]): {
	/** The text that is safe to show now. */
	push(text: string): string;
	/** The text held back, at the end of the stream. */
	flush(): string;
} {
	const secrets = [
		...new Set(
			values.flatMap((value) =>
				value === "" ? [] : [value, JSON.stringify(value).slice(1, -1)],
			),
		),
	].sort((a, b) => b.length - a.length);
	const longest = secrets[0]?.length ?? 0;
	let pending = "";
	return {
		push(text) {
			const masked = secrets.reduce(
				(out, secret) => out.replaceAll(secret, SECRET_MASK),
				pending + text,
			);
			// The longest end that a value starts with waits for more text.
			let hold = Math.min(masked.length, longest - 1);
			while (hold > 0) {
				const end = masked.slice(-hold);
				if (secrets.some((s) => s.length > hold && s.startsWith(end))) break;
				hold--;
			}
			pending = masked.slice(masked.length - hold);
			return masked.slice(0, masked.length - hold);
		},
		flush() {
			const rest = pending;
			pending = "";
			return rest;
		},
	};
}

/** `text` with every secret value in `values` as `•••`. */
export function redactText(text: string, values: readonly string[]): string {
	const redactor = streamRedactor(values);
	return redactor.push(text) + redactor.flush();
}

/**
 * A JSON value with every secret value in `values` as `•••`, in each
 * string it holds. `all`: the names of its fields too. `values`: the names
 * stay, for an object whose fields a reader knows by name.
 */
export function redactJson<T>(
	value: T,
	values: readonly string[],
	where: "all" | "values" = "all",
): T {
	const hide = (item: unknown): unknown => {
		if (typeof item === "string") return redactText(item, values);
		if (Array.isArray(item)) return item.map(hide);
		if (typeof item !== "object" || item === null) return item;
		return Object.fromEntries(
			Object.entries(item).map(([key, field]) => [
				where === "all" ? redactText(key, values) : key,
				hide(field),
			]),
		);
	};
	// The shape stays: a string becomes a string, an object an object.
	return hide(value) as T;
}

/**
 * `text` with every secret value in `values` as `•••`. An object or a list
 * written as JSON stays JSON: a number keeps its digits.
 */
export function redactJsonText(
	text: string,
	values: readonly string[],
): string {
	const hidden = redactText(text, values);
	if (hidden === text) return text;
	const before = parsed(text);
	return before === undefined || parsed(hidden) !== undefined
		? hidden
		: JSON.stringify(redactJson(before, values));
}

/** The object or list a text holds as JSON, else nothing. */
function parsed(text: string): object | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null ? value : undefined;
	} catch {
		return undefined;
	}
}

/** The same error, with the secret values in its words as `•••`. */
function redactError(error: unknown, values: readonly string[]): unknown {
	if (typeof error === "string") return redactText(error, values);
	for (
		let one = error, depth = 0;
		one instanceof Error && depth < 8;
		one = one.cause, depth++
	) {
		for (const name of ["message", "stack"] as const) {
			const text = one[name];
			const shown = text && redactText(text, values);
			if (shown === text) continue;
			// A DOMException has no setter for its message.
			Object.defineProperty(one, name, { value: shown, configurable: true });
		}
	}
	return error;
}

/**
 * A session's events with the secret values in `values` as `•••`: its
 * tool calls and their results, its text and its thinking. The text of a
 * message comes in deltas, so a value split over two deltas is still
 * found: a delta's end that could start a value waits for the next delta
 * of that message, or for the next event. Thinking goes the same way.
 */
export async function* redactSession<E extends { type: string }>(
	events: AsyncIterable<E>,
	values: readonly string[],
): AsyncGenerator<E> {
	/** The open streams by kind and message id, with the event that opened them. */
	const streams = new Map<
		string,
		{ event: E & Streamed; redactor: ReturnType<typeof streamRedactor> }
	>();
	function* flush(except?: string): Generator<E> {
		for (const [key, { event, redactor }] of streams) {
			if (key === except) continue;
			streams.delete(key);
			const delta = redactor.flush();
			if (delta !== "") yield { ...event, delta };
		}
	}
	for await (const event of hidingErrors(events, values)) {
		if (isStreamed(event)) {
			const key = `${event.type}\u0000${event.messageId}`;
			yield* flush(key);
			let stream = streams.get(key);
			if (!stream) {
				stream = { event, redactor: streamRedactor(values) };
				streams.set(key, stream);
			}
			const delta = stream.redactor.push(event.delta);
			if (delta !== "") yield { ...event, delta };
			continue;
		}
		yield* flush();
		yield redactEvent(event, values);
	}
	yield* flush();
}

/** The events as they are; what the stream throws has its words hidden. */
async function* hidingErrors<E>(
	events: AsyncIterable<E>,
	values: readonly string[],
): AsyncGenerator<E> {
	try {
		yield* events;
	} catch (error) {
		throw redactError(error, values);
	}
}

/**
 * An event keeps its own fields, and a report the names its output schema
 * gives. What an agent sends to a tool has no names of ours: all of it goes.
 */
function redactEvent<E extends { type: string }>(
	event: E,
	values: readonly string[],
): E {
	const hidden = redactJson(event, values, "values");
	return event.type === "tool-end" && "input" in event
		? { ...hidden, input: redactJson(event.input, values) }
		: hidden;
}

/** An event whose words come in deltas: an agent's text or thinking. */
type Streamed = { type: "text" | "thinking"; messageId: string; delta: string };

function isStreamed<E extends { type: string }>(
	event: E,
): event is E & Streamed {
	return (
		(event.type === "text" || event.type === "thinking") &&
		"messageId" in event &&
		typeof event.messageId === "string" &&
		"delta" in event &&
		typeof event.delta === "string"
	);
}

/**
 * A command's events with the secret values in `values` taken out of its
 * output, per stream, out of the reason it could not start, and out of
 * what it wrote to `NS_OUTPUT`.
 */
export async function* redactExec(
	events: AsyncIterable<ExecEvent>,
	values: readonly string[],
): AsyncGenerator<ExecEvent> {
	const streams = {
		stdout: streamRedactor(values),
		stderr: streamRedactor(values),
	};
	function* flush(): Generator<ExecEvent> {
		for (const stream of ["stdout", "stderr"] as const) {
			const text = streams[stream].flush();
			if (text !== "") yield { type: "output", stream, text };
		}
	}
	for await (const event of events) {
		if (event.type === "output") {
			const text = streams[event.stream].push(event.text);
			if (text !== "") yield { ...event, text };
		} else if (event.type === "exit") {
			yield* flush();
			yield {
				...event,
				spawnError:
					event.spawnError === null
						? null
						: redactText(event.spawnError, values),
				...(event.output === undefined
					? {}
					: { output: redactText(event.output, values) }),
			};
			return;
		} else {
			yield event;
		}
	}
	yield* flush();
}
