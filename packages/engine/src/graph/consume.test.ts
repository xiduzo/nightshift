import { describe, expect, test } from "bun:test";
import { closeStream, consumeStream } from "./consume";

/**
 * A session's stream does its cleanup when it closes: the Device removes the
 * step's knowledge view and publishes what the step wrote, the harness
 * removes its own files. The step ends after that, not before.
 */

/** One turn of the event loop, as a cleanup that removes files takes. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

const read = (
	stream: AsyncIterable<string>,
	options: {
		order: string[];
		signal?: AbortSignal;
		onItem?: (item: string) => void;
	},
) =>
	consumeStream(stream, {
		signal: options.signal ?? new AbortController().signal,
		graceMs: 1,
		onItem: (item) => {
			options.order.push(item);
			options.onItem?.(item);
		},
		isLast: (item) => item === "finished",
	});

describe("consumeStream", () => {
	test("a stream that ends on its last item has done its cleanup when the read returns", async () => {
		const order: string[] = [];
		async function* session() {
			try {
				yield "text";
				yield "finished";
				yield "never read";
			} finally {
				await turn();
				order.push("cleanup");
			}
		}
		expect(await read(session(), { order })).toBe("ended");
		order.push("returned");
		expect(order).toEqual(["text", "finished", "cleanup", "returned"]);
	});

	test("a stream is closed, its cleanup done, when an item fails", async () => {
		const order: string[] = [];
		async function* session() {
			try {
				yield "text";
				yield "finished";
			} finally {
				await turn();
				order.push("cleanup");
			}
		}
		const failing = read(session(), {
			order,
			onItem: () => {
				throw new Error("The log is not written.");
			},
		});
		await expect(failing).rejects.toThrow("The log is not written.");
		expect(order).toEqual(["text", "cleanup"]);
	});

	test("a stop ends the wait for a cleanup that never ends, after the grace", async () => {
		const order: string[] = [];
		const stop = new AbortController();
		async function* session() {
			try {
				yield "finished";
			} finally {
				stop.abort();
				await new Promise(() => {});
			}
		}
		expect(await read(session(), { order, signal: stop.signal })).toBe("ended");
		expect(order).toEqual(["finished"]);
	});
});

describe("closeStream", () => {
	test("a stream a stop closes before its read has done its cleanup when the close returns", async () => {
		const order: string[] = [];
		async function* session() {
			try {
				yield "ready";
				yield "never read";
			} finally {
				await turn();
				order.push("cleanup");
			}
		}
		const stream = session();
		await stream.next();
		expect(await closeStream(stream, 1_000)).toBe("ended");
		order.push("returned");
		expect(order).toEqual(["cleanup", "returned"]);
	});

	test("a cleanup that never ends is left after the grace", async () => {
		async function* session() {
			try {
				yield "ready";
			} finally {
				await new Promise(() => {});
			}
		}
		const stream = session();
		await stream.next();
		expect(await closeStream(stream, 1)).toBe("abandoned");
	});
});
