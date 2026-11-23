import { builtinAgent } from "@nightshift/flows";
import type { BridgedTool } from "../../../port";
import { toolsOf } from "../../catalog";
import type { AuthoringPort } from "../../domain/authoring";
import {
	authoringTools,
	describeAuthoringTool,
} from "./tanstack-authoring-tools";
import type { HistoryPort } from "./tanstack-history-tools";
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
	_input: unknown,
): string | undefined {
	return describeAuthoringTool(name) ?? describeHistoryTool(name);
}

export const chatAgentLimits = (agent: "builder" | "improver") =>
	builtinAgent(agent).limits;
export function tanstackChatTools(): ChatTools {
	return {
		forTurn: chatToolsForTurn,
		describeTool: describeChatTool,
		limits: chatAgentLimits,
	};
}
