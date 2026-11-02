import { answeredOf, inboxOf } from "@nightshift/engine";
import { now } from "@nightshift/time";
import { z } from "zod";

import { output } from "../output";
import { protectedProcedure } from "../procedures";
import { runProcedure } from "../runs";
import { answerGate, answerRefusals } from "./answer";
import {
	answeredGateSchema,
	gateAnswerSchema,
	inboxGateSchema,
} from "./schemas";

/**
 * The Needs-you inbox. It spans every Space the Person is in, not only the
 * session's Space: a Gate is answered where it is, without a switch.
 */
export const gates = {
	list: protectedProcedure
		.route({
			summary:
				"Lists the open Gates of every Space the Person is in, oldest first: the Needs-you inbox.",
		})
		.output(output(z.array(inboxGateSchema)))
		.handler(({ context }) => inboxOf(context, context.session.user.id)),
	answered: protectedProcedure
		.route({
			summary:
				"Lists the Gates of every Space the Person is in that closed in the last 90 days, newest first: the answered part of the inbox.",
		})
		.output(output(z.array(answeredGateSchema)))
		.handler(({ context }) =>
			answeredOf(context, context.session.user.id, now()),
		),
	resolve: runProcedure(gateAnswerSchema, { gate: ["resolve"] })
		.errors(answerRefusals)
		.route({
			summary:
				"Answers an open Gate in any of the Person's Spaces with one of its choices, and the run goes on.",
		})
		.output(output(z.void()))
		.handler(({ context, input, errors }) =>
			answerGate(context.space, input, errors),
		),
};
