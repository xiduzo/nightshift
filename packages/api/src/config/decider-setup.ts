import { z } from "zod";

import type { Context } from "../context";
import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { deciderSetupStatusSchema } from "./schemas";

/**
 * The guided setup of a decider (Q22), after an agent: Local (Ollama on
 * this computer, no account) or TypeSafe Jev (a key). Only the owner, only
 * from this computer, and never when Night Shift runs in a container: the
 * engine refuses everything else. Each route answers with the status, and
 * the screen polls `status` while a job runs. No reply holds the key.
 */

/** Where the request comes from: the setup acts only on this computer itself. */
const callerOf = (context: Pick<Context, "fromThisComputer">) => ({
	here: context.fromThisComputer,
});

export const deciderSetup = {
	status: ownerProcedure
		.route({
			summary:
				"Says which decider new Decision nodes start on, whether Ollama and its model are here, and how a setup goes.",
		})
		.output(output(deciderSetupStatusSchema))
		.handler(({ context }) => context.deciderSetup.status(callerOf(context))),
	installOllama: ownerProcedure
		.route({
			summary:
				"Installs Ollama with Homebrew on this Mac, after the person confirms, then sets up the local decider.",
		})
		.output(output(deciderSetupStatusSchema))
		.handler(({ context }) =>
			context.deciderSetup.installOllama(callerOf(context)),
		),
	useLocal: ownerProcedure
		.route({
			summary:
				"Starts Ollama, downloads the small model, and makes it the decider of new Decision nodes.",
		})
		.output(output(deciderSetupStatusSchema))
		.handler(({ context }) => context.deciderSetup.useLocal(callerOf(context))),
	/** Without a key, the key saved already stays. */
	useTypesafe: ownerProcedure
		.route({
			summary:
				"Saves the TypeSafe key on this computer and makes TypeSafe Jev the decider of new Decision nodes.",
		})
		.input(z.object({ key: z.string().max(1_000).optional() }))
		.output(output(deciderSetupStatusSchema))
		.handler(({ context, input }) =>
			context.deciderSetup.useTypesafe(input.key ?? null, callerOf(context)),
		),
	cancel: ownerProcedure
		.route({
			summary: "Stops the install of Ollama or the download of the model.",
		})
		.output(output(deciderSetupStatusSchema))
		.handler(({ context }) => context.deciderSetup.cancel(callerOf(context))),
};
