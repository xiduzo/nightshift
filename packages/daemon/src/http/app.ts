import { appRouter, runAccess } from "@nightshift/api";
import {
	type AccessRefusal,
	authEndpointAllowed,
	PEER_ADDRESS_HEADER,
} from "@nightshift/auth";
import { READS, READS_HEADER } from "@nightshift/devices";
import { WEBHOOK_PATH } from "@nightshift/flows";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono, type Context as HonoContext } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { leaseHealth, readHeartbeat } from "../runtime";
import type { Sync } from "../sync";
import { artifactFileResponse, artifactNotFound } from "./artifact-file";
import { type HttpServices, requestContexts } from "./context";
import { desktopOrigins } from "./origins";
import { decodedRequest, UnreadableBody } from "./request-encoding";
import { runExportResponse } from "./run-export";
import type { DaemonServe } from "./serve";
import { peerAddress } from "./this-computer";
import { webhookResponse } from "./webhook";

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
 * What Bun serves: the Hono app (the health check, the webhooks of
 * schedules, Better Auth, the run export, run artifacts, the procedures),
 * and the sync WebSocket beside it. Bun upgrades
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
	const {
		corsOrigin,
		dataDir,
		leaseOwner,
		sync,
		serve,
		logRequests,
		...httpServices
	} = services;
	const { auth, db, connections, engine } = httpServices;
	const { access, authAccess, createContext } = requestContexts(httpServices);
	const app = new Hono();

	// For watchdogs and health checks, before the logger: they ask often. 200
	// while the lease heartbeat is fresh, else 503. It reads the clock and the
	// database only, so it answers truthfully when the timers stopped. It says
	// nothing about this computer: anyone may ask.
	app.get("/health", async (c) => {
		try {
			const health = leaseHealth(await readHeartbeat(db), {
				owner: leaseOwner,
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
	if (logRequests) app.use(logger());

	// A webhook for a schedule: the one call anyone may make without a
	// session. The schedule's secret is its check (`webhook.ts`).
	app.post(`${WEBHOOK_PATH}/:projectId/:scheduleId`, (c) =>
		webhookResponse(engine, c.req.raw, {
			projectId: c.req.param("projectId"),
			scheduleId: c.req.param("scheduleId"),
		}),
	);
	app.use(
		"/*",
		cors({
			origin: [corsOrigin, ...desktopOrigins],
			allowMethods: ["GET", "POST", "OPTIONS"],
			// x-orpc-batch: the web app on another address (the desktop
			// app, `bun run dev`) sends its calls together in one batch.
			allowHeaders: ["Content-Type", "Authorization", "x-orpc-batch"],
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

	/** An access refusal, as the procedures give it: its status, code and words. */
	const refused = (c: HonoContext, refusal: AccessRefusal) =>
		c.json({ code: refusal.code, message: refusal.message }, refusal.status);

	// A file download, not an oRPC call: a run of any of the Person's
	// Spaces, for a role that may export runs there (`runAccess`).
	app.get("/api/runs/:id/export", async (c) => {
		const runId = c.req.param("id");
		const found = await runAccess({ access: await access(c), engine }, runId, {
			run: ["export"],
		});
		if (!found.allowed) return refused(c, found);
		return runExportResponse(
			{ db, dataDir, connections },
			runId,
			found.spaceId,
		);
	});

	// A file, not an oRPC call: one artifact of a run of any of the Person's
	// Spaces (`runAccess`), for an <img>, a <video> or a download. A run the
	// Person may not see has no artifact for them.
	app.get("/api/runs/:id/artifacts/:artifactId", async (c) => {
		const runId = c.req.param("id");
		const found = await runAccess({ access: await access(c), engine }, runId);
		if (!found.allowed) {
			return found.code === "NOT_FOUND"
				? artifactNotFound()
				: refused(c, found);
		}
		return artifactFileResponse(
			engine.space(found.spaceId, { personId: found.session.user.id }),
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
		...serve,
		fetch(request, server) {
			if (new URL(request.url).pathname === SYNC_PATH) {
				return sync.upgrade(request, server);
			}
			return app.fetch(request, server);
		},
		websocket: sync.websocket,
	};
}
