import type { Session } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { Engine } from "@nightshift/engine/types";

export type Context = {
	session: Session | null;
	db: Database;
	engine: Engine;
};
