import type { RouterClient } from "@orpc/server";
import { z } from "zod";
import { assistant } from "./assistant";
import {
	cliTools,
	connections,
	deciders,
	harnesses,
	ollama,
	profiles,
	programs,
	settings,
} from "./config";
import { dashboard } from "./dashboard";
import { account, devices, hostPeer, offers } from "./devices";
import { flows } from "./flows";
import { gates } from "./gates";
import { knowledge } from "./knowledge";
import { notifications } from "./notifications";
import { output } from "./output";
import { publicProcedure } from "./procedures";
import { projects } from "./projects";
import { runs } from "./runs";
import { schedules } from "./schedules";
import { invitations, members, spaces } from "./spaces";
import { usage } from "./usage";

// Every procedure but the health check needs a session in a Space. One
// person on one computer has one without signing in (the local session).
// Lists, starts and projects are the session's Space's. A procedure keyed
// by a run id is the run's own Space's, for a Person with a role there
// (`runProcedure`). What changes them needs a role that allows it. The
// Needs-you inbox spans every Space of the Person. This computer's own
// configuration is its owner's. A paired Device calls with its Device key,
// not a session: the peer protocol of `@nightshift/devices`, mounted at
// its paths.

/**
 * The rest of the peer protocol, as a paired Device calls it. A const of
 * its own: in one object with the rest, the router's type grows past what
 * the compiler writes out (TS7056).
 */
const peerRoutes = {
	pairing: hostPeer.pairing,
	link: hostPeer.link,
	sync: hostPeer.sync,
	archive: hostPeer.archive,
	leases: hostPeer.leases,
	secrets: hostPeer.secrets,
	projectSecrets: hostPeer.projectSecrets,
	spaceSecrets: hostPeer.spaceSecrets,
};

/** What the screens call, and the Devices procedures of a paired Device. */
const screenRoutes = {
	healthCheck: publicProcedure
		.route({ summary: "Answers OK while Night Shift runs." })
		.output(output(z.string()))
		.handler(() => "OK"),
	spaces,
	members,
	invitations,
	projects,
	knowledge,
	flows,
	gates,
	assistant,
	schedules,
	runs,
	notifications,
	dashboard,
	settings,
	usage,
	connections,
	cliTools,
	programs,
	harnesses,
	deciders,
	ollama,
	profiles,
	offers,
	// A Person's Devices, and the work relay a paired Device calls.
	devices: { ...devices, ...hostPeer.devices },
	account,
};

/**
 * The API: one router from the procedures of each domain. Its keys and
 * nesting are the wire format (`/rpc/runs/list`): the web app, OpenAPI and
 * the paired Devices all go through it.
 */
export const appRouter: typeof screenRoutes & typeof peerRoutes = {
	...screenRoutes,
	...peerRoutes,
};
export type AppRouterClient = RouterClient<typeof appRouter>;
