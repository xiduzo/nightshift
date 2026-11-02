import { join } from "node:path";

import {
	createInsights,
	migrateInsights,
	publicNumbers,
} from "@nightshift/insights";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";

import { ingestRequest } from "@/features/ingest";
import { adminRouter } from "@/features/reports";
import {
	createAdminAuth,
	ensureAdmin,
	migrateAdminAuth,
} from "@/features/session";
import type { Env } from "@/shared/config";

const DIST = join(import.meta.dir, "../dist");

/** Starts the admin listener and the internal ingest listener. */
export async function start(env: Env): Promise<void> {
	const db = createInsights(env.DATABASE_URL);
	await migrateInsights(db);
	await migrateAdminAuth(env.DATABASE_URL);
	const auth = createAdminAuth(db, env);
	await ensureAdmin(auth, env);

	Bun.serve({
		hostname: env.INSIGHTS_INGEST_HOST,
		port: env.INSIGHTS_INGEST_PORT,
		fetch: createIngest(db).fetch,
	});

	if (process.env.NODE_ENV === "production") {
		Bun.serve({
			hostname: "0.0.0.0",
			port: env.INSIGHTS_PORT,
			fetch: createApi(db, auth, true).fetch,
		});
	} else {
		const internal = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: createApi(db, auth, false).fetch,
		});
		const { createServer } = await import("vite");
		const vite = await createServer({
			root: join(import.meta.dir, ".."),
			appType: "spa",
			server: {
				host: "0.0.0.0",
				port: env.INSIGHTS_PORT,
				proxy: {
					"/api": {
						target: `http://127.0.0.1:${internal.port}`,
						changeOrigin: false,
					},
					"/rpc": {
						target: `http://127.0.0.1:${internal.port}`,
						changeOrigin: false,
					},
				},
			},
		});
		await vite.listen();
	}

	console.log(`Admin UI on port ${env.INSIGHTS_PORT}.`);
	console.log(`Ingest on port ${env.INSIGHTS_INGEST_PORT}.`);
}

function createIngest(db: ReturnType<typeof createInsights>) {
	const app = new Hono();
	app.post("/v1/logs", (c) => ingestRequest(db, c.req.raw));
	return app;
}

function createApi(
	db: ReturnType<typeof createInsights>,
	auth: ReturnType<typeof createAdminAuth>,
	files: boolean,
) {
	const app = new Hono();
	const rpc = new RPCHandler(adminRouter);

	app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
	app.get("/api/proof", async (c) => c.json(await publicNumbers(db)));
	app.use("/rpc/*", async (c, next) => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		const result = await rpc.handle(c.req.raw, {
			prefix: "/rpc",
			context: {
				db,
				session: session
					? {
							user: {
								id: session.user.id,
								email: session.user.email,
								name: session.user.name,
							},
						}
					: null,
			},
		});
		if (result.matched) {
			return c.newResponse(result.response.body, result.response);
		}
		await next();
	});

	if (files) {
		app.get("*", async (c) => serveUi(c.req.path));
	}
	return app;
}

async function serveUi(pathname: string): Promise<Response> {
	if (pathname.includes("..")) return new Response(null, { status: 404 });
	const relative = pathname === "/" ? "index.html" : pathname.slice(1);
	const file = Bun.file(join(DIST, relative));
	if (await file.exists()) return new Response(file);
	if (pathname.includes(".")) return new Response(null, { status: 404 });
	const index = Bun.file(join(DIST, "index.html"));
	if (!(await index.exists())) {
		return new Response("Build the admin UI first.", { status: 500 });
	}
	return new Response(index, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}
