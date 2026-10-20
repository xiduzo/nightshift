/**
 * One MCP tool bridge for the whole process, shared by every session.
 *
 * A harness reaches Night Shift's own tools (`report_step`, the permission
 * prompt) over MCP. TanStack AI's default bridge opens one `node:http`
 * listener per session on a random port. In the dev daemon those listeners
 * have died while their session still ran. The OS then handed the free port
 * to the next session's bridge, and the first session's next call reached
 * the wrong bridge: "MCP server "tanstack" rejected the Authorization
 * header". The report was lost and the step hung (incident of 2026-10-20).
 *
 * This bridge removes that failure mode:
 * - One `Bun.serve` listener per process. A session gets its own path
 *   (`/mcp/<id>`) and bearer token, so a call can never reach another
 *   session's tools, and a call for a session that has ended gets a clear
 *   answer instead of a wrong-token error.
 * - The listener is checked before each new session and every
 *   `WATCH_MS` while sessions are open. A dead listener is logged and opened
 *   again on the same port, so the URLs of running sessions stay valid.
 * - The state lives on `globalThis`, so a `bun --hot` reload keeps the
 *   listener and its sessions.
 *
 * The bridge serves the MCP Streamable HTTP transport statelessly: POST
 * with a JSON-RPC message or batch, answered with JSON. GET (the optional
 * server-to-client stream) gets 405, which the spec allows. Dispatch is
 * TanStack AI's own `createToolBridgeCore` + `handleBridgeJsonRpc`, the
 * library's seam for a bridge served from a `fetch` handler.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
	LATEST_PROTOCOL_VERSION,
	SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { defineChatMiddleware } from "@tanstack/ai";
import {
	BRIDGED_MCP_SERVER_NAME,
	createToolBridgeCore,
	handleBridgeJsonRpc,
	hostForSandbox,
	nodeHttpBridgeProvisioner,
	provideToolBridgeProvisioner,
	type ToolBridgeProvisioner,
} from "@tanstack/ai-sandbox";

type BridgeCore = ReturnType<typeof createToolBridgeCore>;

type Route = { token: string; core: BridgeCore };

type BridgeState = {
	server: ReturnType<typeof Bun.serve> | undefined;
	port: number | undefined;
	routes: Map<string, Route>;
	watch: ReturnType<typeof setInterval> | undefined;
	/** Set while the listener is being checked or opened again. */
	healing: Promise<void> | undefined;
};

/** How often the listener is checked while sessions are open. */
export const WATCH_MS = 2_000;

/** How long a liveness probe of the listener may take. */
const PROBE_TIMEOUT_MS = 2_000;

const HEALTH_PATH = "/health";
const ROUTE_PREFIX = "/mcp/";

// Kept across `bun --hot` reloads, like the process guard.
const holder = globalThis as { nightshiftToolBridge?: BridgeState };

function state(): BridgeState {
	holder.nightshiftToolBridge ??= {
		server: undefined,
		port: undefined,
		routes: new Map(),
		watch: undefined,
		healing: undefined,
	};
	return holder.nightshiftToolBridge;
}

function bearerMatches(header: string | null, token: string): boolean {
	if (!header) return false;
	const a = Buffer.from(header);
	const b = Buffer.from(`Bearer ${token}`);
	return a.length === b.length && timingSafeEqual(a, b);
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const rpcError = (status: number, code: number, message: string) =>
	json({ jsonrpc: "2.0", id: null, error: { code, message } }, status);

type RpcMessage = {
	id?: string | number | null;
	method?: unknown;
	params?: { protocolVersion?: unknown };
};

/** The answer to one JSON-RPC message, or null for a notification. */
async function answer(core: BridgeCore, message: unknown): Promise<unknown> {
	if (message === null || typeof message !== "object") {
		return handleBridgeJsonRpc(core, message);
	}
	const rpc = message as RpcMessage;
	// A notification (no id) gets no answer, whatever its method.
	if (rpc.id === undefined) return null;
	if (rpc.method === "ping") return { jsonrpc: "2.0", id: rpc.id, result: {} };
	const response = (await handleBridgeJsonRpc(core, message)) as {
		result?: { protocolVersion?: string };
	} | null;
	// Agree on the client's protocol version when the SDK knows it: the
	// bridge serves tools only, which every version handles the same way.
	if (rpc.method === "initialize" && response?.result) {
		const asked = rpc.params?.protocolVersion;
		response.result.protocolVersion =
			typeof asked === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(asked)
				? asked
				: LATEST_PROTOCOL_VERSION;
	}
	return response;
}

async function handle(request: Request): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === HEALTH_PATH) return new Response("ok");
	if (!url.pathname.startsWith(ROUTE_PREFIX)) {
		return rpcError(404, -32601, "Not found.");
	}
	const route = state().routes.get(url.pathname.slice(ROUTE_PREFIX.length));
	if (!route) {
		return rpcError(
			404,
			-32001,
			"This Night Shift session has ended. Its tools are no longer available.",
		);
	}
	if (!bearerMatches(request.headers.get("authorization"), route.token)) {
		return rpcError(401, -32001, "Unauthorized.");
	}
	if (request.method !== "POST") {
		return new Response(null, { status: 405, headers: { allow: "POST" } });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return rpcError(400, -32700, "Parse error.");
	}
	if (Array.isArray(body)) {
		const answers = (
			await Promise.all(body.map((m) => answer(route.core, m)))
		).filter((a) => a !== null);
		return answers.length > 0
			? json(answers)
			: new Response(null, { status: 202 });
	}
	const one = await answer(route.core, body);
	return one === null ? new Response(null, { status: 202 }) : json(one);
}

function listen(port: number): ReturnType<typeof Bun.serve> {
	return Bun.serve({
		hostname: "127.0.0.1",
		port,
		// A tool call can run as long as the tool does: no idle cut-off.
		idleTimeout: 0,
		fetch: handle,
	});
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

/**
 * Open the listener, or open it again when it no longer answers. Concurrent
 * callers share one check.
 */
async function ensureListening(): Promise<number> {
	const s = state();
	s.healing ??= heal(s).finally(() => {
		s.healing = undefined;
	});
	await s.healing;
	return s.port as number;
}

async function heal(s: BridgeState): Promise<void> {
	if (s.server && s.port !== undefined && (await alive(s.port))) return;
	const lost = s.port;
	if (lost === undefined) {
		s.server = listen(0);
		s.port = s.server.port;
		return;
	}
	console.error(
		`[tool-bridge] The tool bridge on port ${lost} stopped answering with ${s.routes.size} open session(s). Opening it again.`,
	);
	// Open the same port first: the URLs of running sessions stay valid. The
	// dead server is not stopped first: when its socket is already gone,
	// stopping it could close a descriptor that now belongs to someone else.
	try {
		s.server = listen(lost);
	} catch {
		// Still bound: the old server hangs rather than died. Stop it, retry.
		s.server?.stop(true);
		try {
			s.server = listen(lost);
		} catch (error) {
			console.error(
				`[tool-bridge] Port ${lost} is taken. Open sessions cannot reach their tools.`,
				error,
			);
			s.server = listen(0);
		}
	}
	s.port = s.server.port;
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
			console.error("[tool-bridge] Could not check the tool bridge.", error);
		});
	}, WATCH_MS);
	s.watch.unref?.();
}

/**
 * The provisioner: one route on the shared listener per session. Sandboxes
 * that reach the host another way (Docker) keep TanStack AI's default.
 */
export const sharedToolBridgeProvisioner: ToolBridgeProvisioner = {
	async provision(tools, options) {
		const { provider, ...core } = options;
		if (hostForSandbox(provider) !== "127.0.0.1") {
			return nodeHttpBridgeProvisioner.provision(tools, options);
		}
		const port = await ensureListening();
		const id = randomUUID();
		const token = randomBytes(24).toString("hex");
		const routes = state().routes;
		routes.set(id, { token, core: createToolBridgeCore(tools, core) });
		startWatch();
		return {
			name: BRIDGED_MCP_SERVER_NAME,
			url: `http://127.0.0.1:${port}${ROUTE_PREFIX}${id}`,
			token,
			close: async () => {
				routes.delete(id);
			},
		};
	},
};

/** Chat middleware that gives the session the shared tool bridge. */
export const withSharedToolBridge = defineChatMiddleware({
	name: "nightshift-tool-bridge",
	setup(ctx) {
		provideToolBridgeProvisioner(ctx, sharedToolBridgeProvisioner);
	},
});

/** Test hook: the shared listener's state. */
export function toolBridgeState(): Readonly<BridgeState> {
	return state();
}
