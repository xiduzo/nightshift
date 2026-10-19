import { appRouter } from "@nightshift/api/routers/index";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createContext } from "./context";
import { desktopOrigins, ENV } from "./env.server";
import { runExportResponse } from "./run-export";
import { auth, connections, db, sync } from "./services";
import type { SocketData } from "./sync";

const app = new Hono();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: [ENV.CORS_ORIGIN, ...desktopOrigins],
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	}),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => auth.handler(c.req.raw));

// A file download, not an oRPC call. Public like the procedures: local
// single-user mode has no session yet.
app.get("/api/runs/:id/export", (c) =>
	runExportResponse({ db, connections }, c.req.param("id")),
);

export const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

export const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

app.use("/*", async (c, next) => {
	const context = await createContext({ context: c });

	const rpcResult = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context: context,
	});

	if (rpcResult.matched) {
		return c.newResponse(rpcResult.response.body, rpcResult.response);
	}

	const apiResult = await apiHandler.handle(c.req.raw, {
		prefix: "/api-reference",
		context: context,
	});

	if (apiResult.matched) {
		return c.newResponse(apiResult.response.body, apiResult.response);
	}

	await next();
});

app.get("/", (c) => {
	return c.text("OK");
});

/** The relay's WebSocket: Yjs documents sync here (see `sync.ts`). */
export const SYNC_PATH = "/sync";

/**
 * What Bun serves: the Hono app, and the sync WebSocket beside it. Bun
 * upgrades the socket itself, so the sync path never reaches Hono.
 */
export default {
	fetch(request: Request, server: Bun.Server<SocketData>) {
		if (new URL(request.url).pathname === SYNC_PATH) {
			return sync.upgrade(request, server);
		}
		return app.fetch(request, server);
	},
	websocket: sync.websocket,
};
