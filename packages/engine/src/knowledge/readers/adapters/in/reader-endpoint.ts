import {
	createLoopback,
	type LoopbackState,
	newLoopbackState,
} from "@nightshift/agents/loopback";

/**
 * The step's page reader on this computer (ADR 39): one loopback listener
 * per process, where a Command step of a sync flow asks the project's
 * reader for a page. Each step gets its own path (`/reader/<id>`) and bearer
 * token, as `@nightshift/agents/loopback` gives them, so a step never reaches
 * another step's reader. A step that ended gets a clear answer.
 *
 * Its own listener rather than a route of the daemon's server: the
 * daemon's server may listen on every interface (a Host), and a step needs
 * only this computer. This module knows nothing of pages: a route's
 * `handle` answers.
 */

export type ReaderRoute = {
	/** Answers one request under the step's path: `read`, `map` or `links`. */
	handle(
		action: string,
		params: URLSearchParams,
		signal: AbortSignal,
	): Promise<Response>;
};

const holder = globalThis as {
	nightshiftPageReaders?: LoopbackState<ReaderRoute>;
};

const plain = (text: string, status: number) =>
	new Response(text, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});

const REFUSALS = {
	unknown: () => plain("Not found.", 404),
	ended: () => plain("This step has ended. Its page reader is gone.", 410),
	unauthorized: () => plain("Unauthorized.", 401),
};

/** Opens a step's own address and token on the listener, until `close`. */
export const openReaderRoute = createLoopback<ReaderRoute>({
	name: "page-reader",
	prefix: "/reader/",
	state() {
		holder.nightshiftPageReaders ??= newLoopbackState();
		return holder.nightshiftPageReaders;
	},
	refuse: (why) => REFUSALS[why](),
	async handle(route, request, [action = "", ...rest]) {
		if (request.method !== "GET" || rest.length > 0) {
			return plain("Not found.", 404);
		}
		try {
			const { searchParams } = new URL(request.url);
			return await route.handle(action, searchParams, request.signal);
		} catch (error) {
			return plain(
				`The page reader stopped: ${error instanceof Error ? error.message : String(error)}`,
				500,
			);
		}
	},
});
