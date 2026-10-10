import { createAuth } from "@nightshift/auth";
import { createDb } from "@nightshift/db";

import { ENV, desktopOrigins } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db, desktopOrigins);
