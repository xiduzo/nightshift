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
 * - One listener per process, shared as `../loopback` shares it. A call can
 *   never reach another session's tools, and a call for a session that has
 *   ended gets a clear answer instead of a wrong-token error.
 * - A dead listener is logged and opened again on the same port, so the URLs
 *   of running sessions stay valid.
 *
 * The bridge serves the MCP Streamable HTTP transport statelessly: POST
 * with a JSON-RPC message or batch, answered with JSON. GET (the optional
 * server-to-client stream) gets 405, which the spec allows. Dispatch is
 * TanStack AI's own `createToolBridgeCore` + `handleBridgeJsonRpc`, the
 * library's seam for a bridge served from a `fetch` handler.
 */
import {
	LATEST_PROTOCOL_VERSION,
	SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/server";
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
import {
	createLoopback,
	type LoopbackState,
	newLoopbackState,
} from "../loopback";

type BridgeCore = ReturnType<typeof createToolBridgeCore>;

type Route = { core: BridgeCore };

// Kept across `bun --hot` reloads, like the process guard.
const holder = globalThis as { nightshiftToolBridge?: LoopbackState<Route> };

/** The shared listener's state. */
export function toolBridgeState(): LoopbackState<Route> {
	holder.nightshiftToolBridge ??= newLoopbackState();
	return holder.nightshiftToolBridge;
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

async function handle(route: Route, request: Request): Promise<Response> {
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

const REFUSALS = {
	unknown: () => rpcError(404, -32601, "Not found."),
	ended: () =>
		rpcError(
			404,
			-32001,
			"This Night Shift session has ended. Its tools are no longer available.",
		),
	unauthorized: () => rpcError(401, -32001, "Unauthorized."),
};

const openRoute = createLoopback<Route>({
	name: "tool-bridge",
	prefix: "/mcp/",
	state: toolBridgeState,
	handle,
	refuse: (why) => REFUSALS[why](),
});

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
		const { url, token, close } = await openRoute({
			core: createToolBridgeCore(tools, core),
		});
		return {
			name: BRIDGED_MCP_SERVER_NAME,
			url,
			token,
			close: async () => close(),
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
