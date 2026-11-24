import { harnessNameSchema } from "@nightshift/flows";
import { z } from "zod";

import type { Context } from "../context";
import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { agentSetupStatusSchema, agentSetupViewSchema } from "./schemas";

/**
 * The guided setup of an agent CLI (ADR 25): install it with the vendor's
 * installer, sign it in with its own sign-in, and add it with a profile.
 * Only the owner, only from this computer, and never when Night Shift runs
 * in a container: the engine refuses everything else. The screen polls
 * `status` while a job runs.
 */

const harnessInput = z.object({ harness: harnessNameSchema });

/** Where the request comes from: setup acts only on this computer itself. */
const callerOf = (context: Pick<Context, "fromThisComputer">) => ({
	here: context.fromThisComputer,
});

export const agentSetup = {
	status: ownerProcedure
		.route({
			summary:
				"Lists the agents Night Shift can install and sign in here, what each step runs, and how each setup goes.",
		})
		.output(output(agentSetupStatusSchema))
		.handler(({ context }) => context.agentSetup.status(callerOf(context))),
	install: ownerProcedure
		.route({
			summary:
				"Installs an agent on this computer with its vendor's installer, after the person confirms.",
		})
		.input(harnessInput)
		.output(output(agentSetupViewSchema))
		.handler(({ context, input }) =>
			context.agentSetup.install(input.harness, callerOf(context)),
		),
	signIn: ownerProcedure
		.route({
			summary:
				"Signs an agent in with its own sign-in, then adds it with a profile.",
		})
		.input(harnessInput)
		.output(output(agentSetupViewSchema))
		.handler(({ context, input }) =>
			context.agentSetup.signIn(input.harness, callerOf(context)),
		),
	sendCode: ownerProcedure
		.route({
			summary: "Gives a waiting sign-in the code its sign-in page shows.",
		})
		.input(harnessInput.extend({ code: z.string().trim().min(1).max(2_048) }))
		.output(output(agentSetupViewSchema))
		.handler(({ context, input }) =>
			context.agentSetup.sendCode(input.harness, input.code, callerOf(context)),
		),
	cancel: ownerProcedure
		.route({ summary: "Stops the install or the sign-in of an agent." })
		.input(harnessInput)
		.output(output(agentSetupViewSchema))
		.handler(({ context, input }) =>
			context.agentSetup.cancel(input.harness, callerOf(context)),
		),
};
