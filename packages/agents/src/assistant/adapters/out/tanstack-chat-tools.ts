import type { ChatRequest } from "@nightshift/flows";
import { builtinAgent } from "@nightshift/flows";
import type { BridgedTool } from "../../../port";
import type { AuthoringPort } from "../../domain/authoring";
import type { HistoryPort } from "./tanstack-history-tools";
import { toolsOf } from "../../domain/builtin-tools";
import {
	authoringTools,
	describeAuthoringTool,
} from "./tanstack-authoring-tools";
import { describeHistoryTool, historyTools } from "./tanstack-history-tools";

export function chatToolsForTurn(input: {
	agent: "builder" | "improver";
	port: Omit<AuthoringPort, "propose">;
	past?: HistoryPort;
	proposals: { push(p: import("@nightshift/flows").FlowProposal): void };
}): readonly BridgedTool[] {
	const past = input.agent === "improver" ? input.past : undefined;
	const { run: _run, ...withoutRun } = input.port;
	return toolsOf(input.agent, [
		...authoringTools({
			...(past ? withoutRun : input.port),
			propose: (proposal) => {
				input.proposals.push(proposal);
			},
		}),
		...(past ? historyTools(past, input.port.draft) : []),
	]);
}

export function describeChatTool(
	name: string,
	input: unknown,
): string | undefined {
	return describeAuthoringTool(name) ?? describeHistoryTool(name);
}

export const chatAgentLimits = (agent: "builder" | "improver") =>
	builtinAgent(agent).limits;