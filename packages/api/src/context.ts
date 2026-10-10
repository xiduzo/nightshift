import type { Session } from "@nightshift/auth";
import type { Database } from "@nightshift/db";

export type Context = {
  session: Session | null;
  db: Database;
};
