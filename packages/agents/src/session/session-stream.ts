import type { AgentEvent } from "../port";
import type { Translator } from "./translate";

const ABORTED = Symbol("aborted");

function abortPromise(signal: AbortSignal): {
	promise: Promise<typeof ABORTED>;
	dispose: () => void;
} {
	let onAbort = () => {};
	const promise = new Promise<typeof ABORTED>((resolve) => {
		onAbort = () => resolve(ABORTED);
		if (signal.aborted) resolve(ABORTED);
		else signal.addEventListener("abort", onAbort, { once: true });
	});
	return {
		promise,
		dispose: () => signal.removeEventListener("abort", onAbort),
	};
}

/** Close an iterator, but never wait longer than `ms` and never throw. */
async function closeWithin(
	iterator: AsyncIterator<unknown>,
	ms: number,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const closed = Promise.resolve()
		.then(() => iterator.return?.())
		.catch(() => {});
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, ms);
	});
	await Promise.race([closed, timeout]);
	clearTimeout(timer);
}

/**
 * Drive a chunk stream through a translator and keep the AgentHarness
 * contract: events in order, one terminal event last, no throw. An abort ends
 * the stream right away, without waiting for the next chunk; so does a
 * settled translator (see `Translator.settled`).
 */
export async function* streamSession(options: {
	chunks: AsyncIterable<unknown>;
	translator: Translator;
	signal: AbortSignal;
	/** How long to wait for the source to shut down after an abort. */
	abortGraceMs?: number;
}): AsyncGenerator<AgentEvent> {
	const { translator, signal } = options;
	const graceMs = options.abortGraceMs ?? 5_000;
	const abort = abortPromise(signal);
	let iterator: AsyncIterator<unknown> | undefined;
	let thrown: unknown;
	let sourceDone = false;

	try {
		try {
			iterator = options.chunks[Symbol.asyncIterator]();
			while (!signal.aborted) {
				const next = iterator.next();
				// The race may drop this promise; keep a late rejection handled.
				next.catch(() => {});
				const result = await Promise.race([next, abort.promise]);
				if (result === ABORTED) break;
				if (result.done) {
					sourceDone = true;
					break;
				}
				for (const event of translator.push(result.value)) yield event;
				if (translator.settled()) {
					// The turn is over: let the source shut down in the
					// background (OpenCode's adapter holds RUN_FINISHED until its
					// event subscription sees one more server event).
					sourceDone = true;
					void closeWithin(iterator, graceMs);
					break;
				}
			}
		} catch (error) {
			thrown = error;
			sourceDone = true;
		}

		if (iterator && !sourceDone) {
			sourceDone = true;
			await closeWithin(iterator, graceMs);
		}
		for (const event of translator.finish({
			aborted: signal.aborted,
			thrown,
		})) {
			yield event;
		}
	} finally {
		abort.dispose();
		// The consumer stopped early: release the source without blocking.
		if (iterator && !sourceDone) void closeWithin(iterator, graceMs);
	}
}
