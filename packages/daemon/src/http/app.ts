import { appRouter, runSpaceFor } from "@nightshift/api";
import { authEndpointAllowed, PEER_ADDRESS_HEADER } from "@nightshift/auth";
import { READS, READS_HEADER } from "@nightshift/devices";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { leaseHealth, readHeartbeat } from "../runtime";
import type { Sync } from "../sync";
import { artifactFileResponse } from "./artifact-file";
import { type HttpServices, requestContexts } from "./context";
import { desktopOrigins } from "./origins";
import { decodedRequest, UnreadableBody } from "./request-encoding";
import { runExportResponse } from "./run-export";
import type { DaemonServe } from "./serve";
import { peerAddress } from "./this-computer";

/** The relay's WebSocket: Yjs documents sync here (see `sync/`). */
export const SYNC_PATH = "/sync";

/** Where the procedures answer as plain HTTP, with their reference. */
const API_REFERENCE = "/api-reference";

/** The reference's own page and spec: anyone may read them, without a session. */
const API_REFERENCE_PAGES = new Set([
	API_REFERENCE,
	`${API_REFERENCE}/spec.json`,
]);

/**
 * What Bun serves: the Hono app (the health check, Better Auth, the run
 * export, run artifacts, the procedures), and the sync WebSocket beside it. Bun upgrades
 * the socket itself, so the sync path never reaches Hono.
 */
export function createHttp(
	services: HttpServices & {
		/** The web app's address (CORS_ORIGIN). */
		corsOrigin: string;
		/** This computer's data folder: the run export reads transcripts there. */
		dataDir: string;
		/** The lease this daemon holds, to tell another daemon's apart. */
		leaseOwner: string;
		sync: Sync;
		/** Where Bun listens, and the daemon's own TLS. */
		serve: Pick<DaemonServe, "hostname" | "tls">;
		/** Logs each request (`bun run dev`). */
		logRequests?: boolean;
	},
): DaemonServe {
	const { auth, db, connections, sync } = services;
	const { access, authAccess, createContext } = requestContexts(services);
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

	// Each poll is a request: only a developer reads a line for each.
	if (services.logRequests) app.use(logger());
	app.use(
		"/*",
		cors({
			origin: [services.corsOrigin, ...desktopOrigins],
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization"],
			credentials: true,
		}),
	);
	// A reply the caller accepts compressed: JSON, text. Never a stream of
	// events (`text/event-stream`), nor a reply under 1 KB.
	app.use(compress());

	// Better Auth's own endpoints (the session, the Spaces). A request from
	// this computer without a session goes in with the local session. A
	// session the Host refuses (two-factor required, not on) may only set it
	// up and sign out. The connection's address goes along for the rate
	// limits: the client's own copy of the header never does. Better Auth
	// reads the session itself.
	app.on(["POST", "GET"], "/api/auth/*", async (c) => {
		const { headers, hostAccess } = await authAccess(c);
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

	// A file download, not an oRPC call: a run of any of the Person's
	// Spaces, for a role that may export runs there (`runSpaceFor`).
	app.get("/api/runs/:id/export", async (c) => {
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
		const runId = c.req.param("id");
		const found = await runSpaceFor(services, session.user.id, runId, {
			run: ["export"],
		});
		if ("refused" in found) {
			return found.refused === "forbidden"
				? c.json(
						{ message: "Your role in this Space does not allow this." },
						403,
					)
				: c.json({ message: "This run is not in one of your Spaces." }, 404);
		}
		return runExportResponse(
			{ db, dataDir: services.dataDir, connections },
			runId,
			found.spaceId,
		);
	});

	// A file, not an oRPC call: one artifact of a run of any of the Person's
	// Spaces (`runSpaceFor`), for an <img>, a <video> or a download.
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
		const runId = c.req.param("id");
		const found = await runSpaceFor(services, session.user.id, runId);
		if ("refused" in found) {
			return c.json({ message: "Artifact not found." }, 404);
		}
		return artifactFileResponse(
			services.engine.space(found.spaceId, { personId: session.user.id }),
			c.req.raw,
			runId,
			c.req.param("artifactId"),
		);
	});

	/**
	 * The procedures answer their own errors and log their failures (`readable`
	 * in `@nightshift/api`, the peer protocol in `@nightshift/devices`). This
	 * logs only an error outside them, such as a reply that cannot be encoded.
	 */
	const logUnanswered = (error: unknown) => {
		if (!(error instanceof ORPCError))
			console.error("[http] a call failed:", error);
	};

	const apiHandler = new OpenAPIHandler(appRouter, {
		plugins: [
			new OpenAPIReferencePlugin({
				schemaConverters: [new ZodToJsonSchemaConverter()],
			}),
		],
		interceptors: [onError(logUnanswered)],
	});

	// Several calls in one request each get their own reply, with one
	// context: the request's access is read once for all of them.
	const rpcHandler = new RPCHandler(appRouter, {
		plugins: [new BatchHandlerPlugin({ maxSize: 10 })],
		interceptors: [onError(logUnanswered)],
	});

	// The procedures: only a call to one reads the request's session. The
	// API reference (its page and its spec) needs none. Each answer says
	// what this daemon reads (`READS_HEADER`): a caller of a newer version
	// batches its calls and compresses its large bodies then.
	app.use("/rpc/*", async (c, next) => {
		let request: Request;
		try {
			request = await decodedRequest(c.req.raw);
		} catch (error) {
			if (!(error instanceof UnreadableBody)) throw error;
			return c.json({ message: error.message }, error.status);
		}
		const rpcResult = await rpcHandler.handle(request, {
			prefix: "/rpc",
			context: await createContext(c),
		});
		if (rpcResult.matched) {
			c.header(READS_HEADER, READS);
			return c.newResponse(rpcResult.response.body, rpcResult.response);
		}
		await next();
	});

	app.use(`${API_REFERENCE}/*`, async (c, next) => {
		const apiResult = await apiHandler.handle(c.req.raw, {
			prefix: API_REFERENCE,
			context: await createContext(c, {
				signedOut: API_REFERENCE_PAGES.has(c.req.path.replace(/\/+$/, "")),
			}),
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
