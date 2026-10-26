/**
 * How a stream of the assistant ended: `done`, an `error` event with its
 * words, stopped by the person (the signal), or broken off: the call
 * failed (`message`, when it says why) or the stream ended without `done`
 * or `error`.
 */
export type StreamEnd =
	| { kind: "done" }
	| { kind: "error"; message: string }
	| { kind: "stopped" }
	| { kind: "broken"; message?: string };

/**
 * Reads one stream of the assistant (a suggestion or a chat answer) to its
 * end: each event to `onEvent`, up to and including `done` or `error`.
 * Nothing reaches `onEvent` once `signal` aborts.
 */
export async function followStream<
	E extends { type: string; message?: unknown },
>(
	open: () => Promise<AsyncIterable<E>>,
	signal: AbortSignal,
	onEvent: (event: E) => void,
): Promise<StreamEnd> {
	try {
		const events = await open();
		for await (const event of events) {
			if (signal.aborted) return { kind: "stopped" };
			onEvent(event);
			if (event.type === "done") return { kind: "done" };
			if (event.type === "error")
				return { kind: "error", message: String(event.message ?? "") };
		}
	} catch (error) {
		if (signal.aborted) return { kind: "stopped" };
		return {
			kind: "broken",
			message:
				error instanceof Error && error.message ? error.message : undefined,
		};
	}
	return signal.aborted ? { kind: "stopped" } : { kind: "broken" };
}
