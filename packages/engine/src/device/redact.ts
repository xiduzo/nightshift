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

/** `value` with every secret value in `values` as `•••`, in each string it holds. */
function redactDeep(value: unknown, values: readonly string[]): unknown {
	if (typeof value === "string") return redactText(value, values);
	if (Array.isArray(value))
		return value.map((item) => redactDeep(item, values));
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				redactDeep(item, values),
			]),
		);
	}
	return value;
}

/**
 * A session's events with the secret values in `values` as `•••`: its
 * tool calls and their results, and its text. The text of a message
 * comes in deltas, so a value split over two deltas is still found: a
 * delta's end that could start a value waits for the next delta of that
 * message, or for the next event.
 */
export async function* redactSession<E extends { type: string }>(
	events: AsyncIterable<E>,
	values: readonly string[],
): AsyncGenerator<E> {
	const texts = new Map<string, ReturnType<typeof streamRedactor>>();
	function* flush(except?: string): Generator<E> {
		for (const [messageId, redactor] of texts) {
			if (messageId === except) continue;
			texts.delete(messageId);
			const delta = redactor.flush();
			if (delta !== "")
				yield { type: "text", messageId, delta } as unknown as E;
		}
	}
	for await (const event of events) {
		if (isText(event)) {
			yield* flush(event.messageId);
			let redactor = texts.get(event.messageId);
			if (!redactor) {
				redactor = streamRedactor(values);
				texts.set(event.messageId, redactor);
			}
			const delta = redactor.push(event.delta);
			if (delta !== "") yield { ...event, delta };
			continue;
		}
		yield* flush();
		yield redactDeep(event, values) as E;
	}
	yield* flush();
}

function isText(event: {
	type: string;
}): event is { type: "text"; messageId: string; delta: string } {
	return (
		event.type === "text" &&
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
