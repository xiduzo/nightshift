import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * One loopback listener per process, shared by every open route of one
 * kind. Each route gets its own path and bearer token, so a caller never
 * reaches another route. The listener is checked before each new route and
 * every `WATCH_MS` while routes are open. A dead one is opened again on the
 * same port, so the URLs in use stay valid. `state` lives on `globalThis`,
 * so a `bun --hot` reload keeps the listener and its routes.
 */

/** How often the listener is checked while routes are open. */
const WATCH_MS = 2_000;
const PROBE_TIMEOUT_MS = 2_000;
const HEALTH_PATH = "/health";

export type LoopbackState<R> = {
	server: ReturnType<typeof Bun.serve> | undefined;
	port: number | undefined;
	routes: Map<string, R & { token: string }>;
	watch: ReturnType<typeof setInterval> | undefined;
	/** Set while the listener is being checked or opened again. */
	healing: Promise<void> | undefined;
};

export function newLoopbackState<R>(): LoopbackState<R> {
	return {
		server: undefined,
		port: undefined,
		routes: new Map(),
		watch: undefined,
		healing: undefined,
	};
}

type LoopbackKind<R> = {
	/** The log prefix, for example `tool-bridge`. */
	name: string;
	/** The path before the route's id, for example `/mcp/`. */
	prefix: string;
	state(): LoopbackState<R>;
	/** Answers a request under an open route. `rest`: the path after its id. */
	handle(route: R, request: Request, rest: string[]): Promise<Response>;
	/** Answers `unknown` (404), `ended` (no such route) or `unauthorized` (401). */
	refuse(why: "unknown" | "ended" | "unauthorized"): Response;
};

function bearerMatches(header: string | null, token: string): boolean {
	const a = Buffer.from(header ?? "");
	const b = Buffer.from(`Bearer ${token}`);
	return a.length === b.length && timingSafeEqual(a, b);
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

/** Opens routes on the shared listener of this kind. */
export function createLoopback<R extends object>(kind: LoopbackKind<R>) {
	const { name, prefix, state } = kind;

	async function answer(request: Request): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === HEALTH_PATH) return new Response("ok");
		if (!pathname.startsWith(prefix)) return kind.refuse("unknown");
		const [id = "", ...rest] = pathname.slice(prefix.length).split("/");
		const route = state().routes.get(id);
		if (!route) return kind.refuse("ended");
		const header = request.headers.get("authorization");
		if (!bearerMatches(header, route.token)) return kind.refuse("unauthorized");
		return kind.handle(route, request, rest);
	}

	const listen = (port: number) => {
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port,
			// A call can run as long as its work does: no idle cut-off.
			idleTimeout: 0,
			fetch: answer,
		});
		// The listener never keeps the process alive on its own.
		server.unref();
		return server;
	};

	async function heal(s: LoopbackState<R>): Promise<void> {
		const lost = s.port;
		if (s.server && lost !== undefined && (await alive(lost))) return;
		if (lost !== undefined) {
			console.error(
				`[${name}] Port ${lost} stopped answering with ${s.routes.size} open route(s). Opening it again.`,
			);
		}
		// Open the same port first. The dead server is not stopped first: when
		// its socket is already gone, stopping it could close a descriptor that
		// now belongs to someone else.
		try {
			s.server = listen(lost ?? 0);
		} catch {
			// Still bound: the old server hangs rather than died. Stop it, retry.
			s.server?.stop(true);
			try {
				s.server = listen(lost ?? 0);
			} catch (error) {
				console.error(
					`[${name}] Port ${lost} is taken. Open routes cannot be reached.`,
					error,
				);
				s.server = listen(0);
			}
		}
		s.port = s.server.port;
	}

	/** Concurrent callers share one check. */
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
				console.error(`[${name}] Could not check the listener.`, error);
			});
		}, WATCH_MS);
		s.watch.unref?.();
	}

	/** A route's own address and token, until `close`. */
	return async function open(route: R) {
		const port = await ensureListening();
		const id = randomUUID();
		const token = randomBytes(24).toString("hex");
		const { routes } = state();
		routes.set(id, { ...route, token });
		startWatch();
		return {
			url: `http://127.0.0.1:${port}${prefix}${id}`,
			token,
			close: () => {
				routes.delete(id);
			},
		};
	};
}
