/**
 * Reads an async stream one item at a time and hands each item to `onItem`.
 * Stops after an item for which `isLast` returns true.
 *
 * A harness ends its stream soon after its signal aborts. If it does not end
 * within `graceMs` of the abort, the stream is abandoned so that a stuck
 * harness cannot hold a stop forever.
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
	const close = () => {
		Promise.resolve(iterator.return?.()).catch(() => {});
	};

	try {
		while (true) {
			const result = await Promise.race([iterator.next(), abandoned]);
			if (result === "abandoned") {
				close();
				return "abandoned";
			}
			if (result.done) return "ended";
			await options.onItem(result.value);
			if (options.isLast(result.value)) {
				close();
				return "ended";
			}
		}
	} finally {
		clearTimeout(timer);
		if (onAbort) options.signal.removeEventListener("abort", onAbort);
	}
}
