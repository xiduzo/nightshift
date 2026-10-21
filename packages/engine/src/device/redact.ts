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
 * A command's events with the secret values in `values` taken out of its
 * output, per stream, and out of the reason it could not start.
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
			};
			return;
		} else {
			yield event;
		}
	}
	yield* flush();
}
