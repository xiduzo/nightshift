/**
 * Reads an async stream one item at a time and hands each item to `onItem`.
 * Stops after an item for which `isLast` returns true.
 *
 * The stream's cleanup is part of the read. When the read stops early (after
 * the last item, or after an item that `onItem` fails on), it waits until the
 * stream closes. At that time a session's Device removes the step's knowledge
 * view and publishes what the step wrote: the step ends after that.
 *
 * A harness ends its stream soon after its signal aborts. If it does not end
 * within `graceMs` of the abort, the stream is abandoned so that a stuck
 * harness cannot hold a stop forever. That holds for its cleanup too.
 */
export async function consumeStream<T>(
	stream: AsyncIterable<T>,
	options: {
		signal: AbortSignal;
		graceMs: number;
		onItem: (item: T) => Promise<void> | void;
		isLast: (item: T) => boolean;
	},
): Promise<"ended" | "abandoned"> {
	const iterator = stream[Symbol.asyncIterator]();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const abandoned = new Promise<"abandoned">((resolve) => {
		onAbort = () => {
			timer = setTimeout(() => resolve("abandoned"), options.graceMs);
		};
		if (options.signal.aborted) onAbort();
		else options.signal.addEventListener("abort", onAbort, { once: true });
	});
	/** Whether the stream is still open: its cleanup has not run. */
	let open = true;

	try {
		while (true) {
			const result = await Promise.race([iterator.next(), abandoned]);
			if (result === "abandoned") {
				// A stuck harness: its cleanup goes on without the step.
				open = false;
				void close(iterator);
				return "abandoned";
			}
			if (result.done) {
				open = false;
				return "ended";
			}
			await options.onItem(result.value);
			if (options.isLast(result.value)) return "ended";
		}
	} finally {
		if (open) await Promise.race([close(iterator), abandoned]);
		clearTimeout(timer);
		if (onAbort) options.signal.removeEventListener("abort", onAbort);
	}
}

/**
 * Closes a stream a stop ends before it is read: its cleanup is part of
 * the step, as in `consumeStream`. Waits `graceMs` at most, so that a
 * stuck cleanup cannot hold a stop forever.
 */
export async function closeStream(
	iterator: AsyncIterator<unknown>,
	graceMs: number,
): Promise<"ended" | "abandoned"> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const abandoned = new Promise<"abandoned">((resolve) => {
		timer = setTimeout(() => resolve("abandoned"), graceMs);
	});
	try {
		return await Promise.race([
			close(iterator).then(() => "ended" as const),
			abandoned,
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** Closes the stream: resolves once its cleanup is over. Never throws. */
function close(iterator: AsyncIterator<unknown>): Promise<void> {
	return Promise.resolve()
		.then(() => iterator.return?.())
		.then(
			() => {},
			() => {},
		);
}
