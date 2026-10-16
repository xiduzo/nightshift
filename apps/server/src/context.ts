import type { Context as ApiContext } from "@nightshift/api/context";
import type { Context as HonoContext } from "hono";

import {
	auth,
	checks,
	connections,
	daemon,
	db,
	engine,
	settings,
} from "./services";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		db,
		engine,
		session,
		settings,
		connections,
		checks,
		daemon,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
