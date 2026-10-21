import { appRouter } from "@nightshift/api";
import { authEndpointAllowed, PEER_ADDRESS_HEADER } from "@nightshift/auth";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { leaseHealth, readHeartbeat } from "../runtime";
import type { Sync } from "../sync";
import { artifactFileResponse } from "./artifact-file";
import { type HttpServices, requestContexts } from "./context";
import { desktopOrigins } from "./origins";
import { runExportResponse } from "./run-export";
import type { DaemonServe } from "./serve";
import { peerAddress } from "./this-computer";

/** The relay's WebSocket: Yjs documents sync here (see `sync/`). */
export const SYNC_PATH = "/sync";

/**
 * What Bun serves: the Hono app (the health check, Better Auth, the run
 * export, run artifacts, the procedures), and the sync WebSocket beside it. Bun upgrades
 * the socket itself, so the sync path never reaches Hono.
 */
export function createHttp(
	services: HttpServices & {
		/** The web app's address (CORS_ORIGIN). */
		corsOrigin: string;
		/** The lease this daemon holds, to tell another daemon's apart. */
		leaseOwner: string;
		sync: Sync;
		/** Where Bun listens, and the daemon's own TLS. */
		serve: Pick<DaemonServe, "hostname" | "tls">;
	},
): DaemonServe {
	const { auth, db, connections, sync } = services;
	const { access, createContext } = requestContexts(services);
	const app = new Hono();

	// For watchdogs and health checks, before the logger: they ask often. 200
	// while the lease heartbeat is fresh, else 503. It reads the clock and the
	// database only, so it answers truthfully when the timers stopped. It says
	// nothing about this computer: anyone may ask.
	app.get("/health", async (c) => {
		try {
			const health = leaseHealth(await readHeartbeat(db), {
				owner: services.leaseOwner,
			});
			return c.json(
				{ status: health.status, heartbeatAgeMs: health.heartbeatAgeMs },
				health.healthy ? 200 : 503,
			);
		} catch {
			return c.json({ status: "unknown", heartbeatAgeMs: null }, 503);
		}
	});

	app.use(logger());
	app.use(
		"/*",
		cors({
			origin: [services.corsOrigin, ...desktopOrigins],
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization"],
			credentials: true,
		}),
	);

	// Better Auth's own endpoints (the session, the Spaces). A request from
	// this computer without a session goes in with the local session. A
	// session the Host refuses (two-factor required, not on) may only set it
	// up and sign out. The connection's address goes along for the rate
	// limits: the client's own copy of the header never does.
	app.on(["POST", "GET"], "/api/auth/*", async (c) => {
		const { headers, hostAccess } = await access(c);
		if (!hostAccess.allowed) {
			const path = c.req.path.replace(/^\/api\/auth/, "");
			if (!authEndpointAllowed(hostAccess, path)) {
				return c.json(
					{ code: hostAccess.code, message: hostAccess.message },
					403,
				);
			}
		}
		const forwarded = new Headers(headers);
		forwarded.delete(PEER_ADDRESS_HEADER);
		const peer = peerAddress(c);
		if (peer) forwarded.set(PEER_ADDRESS_HEADER, peer);
		return auth.handler(new Request(c.req.raw, { headers: forwarded }));
	});

	// A file download, not an oRPC call: the run of the session's Space, for a
	// role that may export runs.
	app.get("/api/runs/:id/export", async (c) => {
		const { session, spaceId, can, hostAccess } = await access(c);
		if (!session || !spaceId) {
			return c.json({ message: "Sign in to use Night Shift." }, 401);
		}
		if (!hostAccess.allowed) {
			return c.json(
				{ code: hostAccess.code, message: hostAccess.message },
				403,
			);
		}
		if (!(await can({ run: ["export"] }))) {
			return c.json(
				{ message: "Your role in this Space does not allow this." },
				403,
			);
		}
		return runExportResponse({ db, connections }, c.req.param("id"), spaceId);
	});

	// A file, not an oRPC call: one artifact of a run of the session's Space,
	// for an <img>, a <video> or a download.
	app.get("/api/runs/:id/artifacts/:artifactId", async (c) => {
		const { session, spaceId, hostAccess } = await access(c);
		if (!session || !spaceId) {
			return c.json({ message: "Sign in to use Night Shift." }, 401);
		}
		if (!hostAccess.allowed) {
			return c.json(
				{ code: hostAccess.code, message: hostAccess.message },
				403,
			);
		}
		return artifactFileResponse(
			services.engine.space(spaceId, { personId: session.user.id }),
			c.req.raw,
			c.req.param("id"),
			c.req.param("artifactId"),
		);
	});

	const apiHandler = new OpenAPIHandler(appRouter, {
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

	const rpcHandler = new RPCHandler(appRouter, {
		interceptors: [
			onError((error) => {
				console.error(error);
			}),
		],
	});

	app.use("/*", async (c, next) => {
		const context = await createContext(c);

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

	return {
		// This computer only, until it is a Host with an https:// address.
		...services.serve,
		fetch(request, server) {
			if (new URL(request.url).pathname === SYNC_PATH) {
				return sync.upgrade(request, server);
			}
			return app.fetch(request, server);
		},
		websocket: sync.websocket,
	};
}
