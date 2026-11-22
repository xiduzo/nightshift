import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * The step's page reader on this computer (ADR 39): one loopback listener
 * per process, where a Command step of a sync flow asks the project's
 * reader for a page. The lessons of the tool bridge
 * (`@nightshift/agents`, `session/tool-bridge.ts`) hold here too:
 *
 * - One `Bun.serve` on 127.0.0.1 for the whole process. Each step gets its
 *   own path (`/reader/<id>`) and bearer token, so a step never reaches
 *   another step's reader, and a step that ended gets a clear answer.
 * - The listener is checked before each new step and every `WATCH_MS`
 *   while steps are open. A dead listener is opened again on the same
 *   port, so the address a running step has stays valid.
 * - The state lives on `globalThis`, so a `bun --hot` reload keeps the
 *   listener and the steps that use it.
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

type Route = ReaderRoute & { token: string };

type EndpointState = {
	server: ReturnType<typeof Bun.serve> | undefined;
	port: number | undefined;
	routes: Map<string, Route>;
	watch: ReturnType<typeof setInterval> | undefined;
	healing: Promise<void> | undefined;
};

const WATCH_MS = 2_000;
const PROBE_TIMEOUT_MS = 2_000;
const HEALTH_PATH = "/health";
const ROUTE_PREFIX = "/reader/";

const holder = globalThis as { nightshiftPageReaders?: EndpointState };

function state(): EndpointState {
	holder.nightshiftPageReaders ??= {
		server: undefined,
		port: undefined,
		routes: new Map(),
		watch: undefined,
		healing: undefined,
	};
	return holder.nightshiftPageReaders;
}

function bearerMatches(header: string | null, token: string): boolean {
	if (!header) return false;
	const a = Buffer.from(header);
	const b = Buffer.from(`Bearer ${token}`);
	return a.length === b.length && timingSafeEqual(a, b);
}

const plain = (text: string, status: number) =>
	new Response(text, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});

async function handle(request: Request): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === HEALTH_PATH) return new Response("ok");
	if (!url.pathname.startsWith(ROUTE_PREFIX)) return plain("Not found.", 404);
	const [id = "", action = "", ...rest] = url.pathname
		.slice(ROUTE_PREFIX.length)
		.split("/");
	const route = state().routes.get(id);
	if (!route) {
		return plain("This step has ended. Its page reader is gone.", 410);
	}
	if (!bearerMatches(request.headers.get("authorization"), route.token)) {
		return plain("Unauthorized.", 401);
	}
	if (request.method !== "GET" || rest.length > 0) {
		return plain("Not found.", 404);
	}
	try {
		return await route.handle(action, url.searchParams, request.signal);
	} catch (error) {
		return plain(
			`The page reader stopped: ${error instanceof Error ? error.message : String(error)}`,
			500,
		);
	}
}

function listen(port: number): ReturnType<typeof Bun.serve> {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port,
		// A read takes as long as the page and its reader take.
		idleTimeout: 0,
		fetch: handle,
	});
	// The listener never keeps the process alive on its own.
	server.unref();
	return server;
}

async function alive(port: number): Promise<boolean> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`, {
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		return response.ok && (await response.text()) === "ok";
	} catch {
		return false;
	}
}

async function heal(s: EndpointState): Promise<void> {
	if (s.server && s.port !== undefined && (await alive(s.port))) return;
	const lost = s.port;
	if (lost === undefined) {
		s.server = listen(0);
		s.port = s.server.port;
		return;
	}
	console.error(
		`[page-reader] The page reader on port ${lost} stopped answering with ${s.routes.size} open step(s). Opening it again.`,
	);
	try {
		s.server = listen(lost);
	} catch {
		s.server?.stop(true);
		try {
			s.server = listen(lost);
		} catch (error) {
			console.error(
				`[page-reader] Port ${lost} is taken. Open steps cannot reach their page reader.`,
				error,
			);
			s.server = listen(0);
		}
	}
	s.port = s.server.port;
}

/** Opens the listener, or opens it again when it no longer answers. Callers at once share one check. */
async function ensureListening(): Promise<number> {
	const s = state();
	s.healing ??= heal(s).finally(() => {
		s.healing = undefined;
	});
	await s.healing;
	return s.port as number;
}

function startWatch(): void {
	const s = state();
	if (s.watch) return;
	s.watch = setInterval(() => {
		if (s.routes.size === 0) {
			clearInterval(s.watch);
			s.watch = undefined;
			return;
		}
		ensureListening().catch((error) => {
			console.error("[page-reader] Could not check the page reader.", error);
		});
	}, WATCH_MS);
	s.watch.unref?.();
}

/** A step's own address and token on the listener, until `close`. */
export type OpenedRoute = { url: string; token: string; close(): void };

export async function openReaderRoute(
	route: ReaderRoute,
): Promise<OpenedRoute> {
	const port = await ensureListening();
	const id = randomUUID();
	const token = randomBytes(24).toString("hex");
	const routes = state().routes;
	routes.set(id, { ...route, token });
	startWatch();
	return {
		url: `http://127.0.0.1:${port}${ROUTE_PREFIX}${id}`,
		token,
		close: () => {
			routes.delete(id);
		},
	};
}
