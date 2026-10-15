import type { Context as ApiContext } from "@nightshift/api/context";
import type { Context as HonoContext } from "hono";

import { auth, db, engine } from "./services";

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
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
