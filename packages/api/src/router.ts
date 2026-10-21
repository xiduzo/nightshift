import type { RouterClient } from "@orpc/server";
import { z } from "zod";

import {
	cliTools,
	connections,
	deciders,
	harnesses,
	profiles,
	settings,
} from "./config";
import { account, devices, link, offers, pairing } from "./devices";
import { flows } from "./flows";
import { gates } from "./gates";
import { output } from "./output";
import { archive, sync } from "./peer";
import { publicProcedure } from "./procedures";
import { projects } from "./projects";
import { runs } from "./runs";
import { schedules } from "./schedules";
import { invitations, members, spaces } from "./spaces";

// Every procedure but the health check needs a session in a Space. One
// person on one computer has one without signing in (the local session).
// Runs, Gates and projects are the session's Space's; what changes them
// needs a role that allows it. This computer's own configuration is its
// owner's. A paired Device calls with its Device key, not a session.

/**
 * The API: one router from the procedures of each domain. Its keys and
 * nesting are the wire format (`/rpc/runs/list`): the web app, OpenAPI and
 * the paired Devices all go through it.
 */
export const appRouter = {
	healthCheck: publicProcedure
		.route({ summary: "Answers OK while Night Shift runs." })
		.output(output(z.string()))
		.handler(() => "OK"),
	spaces,
	members,
	invitations,
	projects,
	flows,
	gates,
	schedules,
	runs,
	settings,
	connections,
	cliTools,
	harnesses,
	deciders,
	profiles,
	offers,
	devices,
	account,
	pairing,
	link,
	sync,
	archive,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
