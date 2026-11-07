import {
	type AgentChoice,
	agentHarnessSchema,
	isAgentProfile,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { z } from "zod";

import type { Context } from "../context";
import { ownsThisComputer } from "../procedures";

/**
 * Which Agent Profile of this computer takes each agent that the flows of
 * an import name (their harness and model). An agent without a choice
 * stays as the flow names it.
 */
export const agentChoicesSchema = z
	.array(
		z.object({
			harness: agentHarnessSchema,
			model: z.string().min(1),
			/** The id of an Agent Profile of this computer. */
			profile: z.string().min(1),
		}),
	)
	.max(64);

/**
 * The choices as profiles of this computer, or a refusal. Only the owner
 * of this computer picks its profiles, and each must be an Agent Profile
 * it has.
 */
export function agentChoices(
	context: Pick<Context, "access" | "daemon" | "profiles">,
	input: z.infer<typeof agentChoicesSchema> | undefined,
): AgentChoice[] {
	if (input === undefined || input.length === 0) return [];
	if (!ownsThisComputer(context)) {
		throw new Refusal(
			"forbidden",
			"Only the owner of this computer can choose its profiles. Keep the agents the flows name.",
		);
	}
	return input.map(({ harness, model, profile }) => {
		const found = context.profiles.get(profile);
		if (found === null || !isAgentProfile(found)) {
			throw new Refusal(
				"invalid",
				"One of the agents you chose is no longer on this computer. Choose your agents again.",
			);
		}
		return {
			agent: { harness, model },
			profile: { device: context.daemon.device.id, profile },
		};
	});
}
