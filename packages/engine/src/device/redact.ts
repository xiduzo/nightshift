import { isDeepStrictEqual } from "node:util";
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
 * string it holds. A value that is itself a JSON document goes as a whole,
 * also where it is written as data. A number stays. `all`: the names of
 * the fields go too. `values`: the names stay, for an object whose fields
 * a reader knows by name.
 */
export function redactJson(
	value: unknown,
	values: readonly string[],
	where: "all" | "values" = "all",
): unknown {
	const documents = values.flatMap((text) => {
		const document = jsonIn(text);
		return typeof document === "object" && Object.keys(document).length > 0
			? [document]
			: [];
	});
	const hide = (item: unknown): unknown => {
		if (typeof item === "string") return redactText(item, values);
		if (typeof item !== "object" || item === null) return item;
		if (documents.some((document) => isDeepStrictEqual(document, item))) {
			return SECRET_MASK;
		}
		if (Array.isArray(item)) return item.map(hide);
		return Object.fromEntries(
			Object.entries(item).map(([key, field]) => [
				where === "all" ? redactText(key, values) : key,
				hide(field),
			]),
		);
	};
	return hide(value);
}

/**
 * `text` with every secret value in `values` as `•••`, for a reader that
 * takes it as JSON when it is JSON. Text that is no object, list or string
 * as JSON, so also JSON that is not valid, is hidden as plain text. Plain
 * hiding is also enough when the JSON then reads as the hidden data does:
 * the text keeps its layout. Else the text is the hidden data, written
 * again: without its layout, and each number as JavaScript reads it, so a
 * very big integer loses digits (as it does in `data`). A value that is
 * itself a number, or a word of JSON, then stays where it is a number or a
 * word. A value that runs over several parts of the JSON still goes.
 */
export function redactJsonText(
	text: string,
	values: readonly string[],
): string {
	const plain = redactText(text, values);
	const data = jsonIn(text);
	if (data === undefined) return plain;
	const hidden = redactJson(data, values);
	const read = jsonIn(plain);
	if (read !== undefined && isDeepStrictEqual(read, hidden)) return plain;
	return redactText(
		JSON.stringify(hidden),
		values.filter((value) => !isLiteral(value)),
	);
}

/** The object, list or string a text holds as JSON, else nothing. */
function jsonIn(text: string): object | string | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return (typeof value === "object" && value !== null) ||
			typeof value === "string"
			? value
			: undefined;
	} catch {
		return undefined;
	}
}

/** Whether a value can be (a part of) a number or a word of JSON. */
function isLiteral(value: string): boolean {
	return (
		/^[-+.\deE]+$/.test(value) ||
		["true", "false", "null"].some((word) => word.includes(value))
	);
}

/**
 * What a stream threw, with the secret values in it as `•••`: the words,
 * the cause, the errors and the own fields of an error. It stays the same
 * error. One that cannot change becomes a new one of its class.
 */
function redactError(
	error: unknown,
	values: readonly string[],
	seen = new Set<unknown>(),
): unknown {
	if (typeof error === "string") return redactText(error, values);
	if (typeof error !== "object" || error === null || seen.has(error)) {
		return error;
	}
	seen.add(error);
	const inside = (value: unknown) => redactError(value, values, seen);
	if (Array.isArray(error)) return error.map(inside);
	if (!(error instanceof Error)) {
		// A plain object. Another class (a Response, a Buffer) stays.
		return Object.getPrototypeOf(error) === Object.prototype
			? redactJsonFields(error, values, inside)
			: error;
	}
	const changed: [string, unknown][] = [];
	for (const name of new Set([
		...Object.getOwnPropertyNames(error),
		"message",
		"stack",
		"name",
	])) {
		const was: unknown = Reflect.get(error, name);
		const now = inside(was);
		if (!isDeepStrictEqual(now, was)) changed.push([name, now]);
	}
	const put = (target: object) =>
		// A DOMException has no setter for its message.
		changed.every(([name, value]) =>
			Reflect.defineProperty(target, name, { value, configurable: true }),
		);
	if (put(error)) return error;
	const copy = Object.setPrototypeOf(
		new Error(),
		Object.getPrototypeOf(error),
	) as Error;
	for (const name of ["message", "stack", "name", "cause"]) {
		if (!changed.some(([one]) => one === name) && Object.hasOwn(error, name)) {
			changed.push([name, Reflect.get(error, name)]);
		}
	}
	put(copy);
	return copy;
}

/** A plain object with its names hidden, and each field as `inside` gives it. */
function redactJsonFields(
	value: object,
	values: readonly string[],
	inside: (field: unknown) => unknown,
): object {
	return Object.fromEntries(
		Object.entries(value).map(([key, field]) => [
			redactText(key, values),
			inside(field),
		]),
	);
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
	// The events of a session are objects: they stay so.
	const hidden = redactJson(event, values, "values") as E;
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
					: { output: hiddenOutput(event.output, values) }),
			};
			return;
		} else {
			yield event;
		}
	}
	yield* flush();
}

/** A command's data, which its step reads as JSON. A number with the digits of a value goes too. */
function hiddenOutput(output: string, values: readonly string[]): string {
	return redactText(redactJsonText(output, values), values);
}
