import { redactError } from "./redact-error";
import {
	SECRET_MASK,
	type SecretMask,
	secretForms,
	secretMask,
} from "./secret-mask";
import type { ExecEvent } from "./types";

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
	const secrets = secretForms(values);
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
	const mask = secretMask(values);
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
	for await (const event of hidingErrors(events, mask)) {
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
		yield redactEvent(event, mask);
	}
	yield* flush();
}

/** The events as they are; what the stream throws has its words hidden. */
async function* hidingErrors<E>(
	events: AsyncIterable<E>,
	mask: SecretMask,
): AsyncGenerator<E> {
	try {
		yield* events;
	} catch (error) {
		throw redactError(error, mask);
	}
}

/**
 * An event keeps its own fields, and a report the names its output schema
 * gives. What an agent sends to a tool has no names of ours: all of it goes.
 */
function redactEvent<E extends { type: string }>(
	event: E,
	mask: SecretMask,
): E {
	// The events of a session are objects: they stay so.
	const hidden = mask.json(event, "values") as E;
	return event.type === "tool-end" && "input" in event
		? { ...hidden, input: mask.json(event.input) }
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
	const mask = secretMask(values);
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
					event.spawnError === null ? null : mask.text(event.spawnError),
				...(event.output === undefined
					? {}
					: { output: mask.text(mask.jsonText(event.output)) }),
			};
			return;
		} else {
			yield event;
		}
	}
	yield* flush();
}
