import type { BridgedTool } from "../../../port";
import type { TurnTools } from "../../application/chat-turn";
import { toolsOf } from "../../catalog";
import {
	authoringTools,
	describeAuthoringTool,
} from "./tanstack-authoring-tools";
import { describeHistoryTool, historyTools } from "./tanstack-history-tools";

export function chatToolsForTurn(input: TurnTools): readonly BridgedTool[] {
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

export const describeChatTool = (name: string): string | undefined =>
	describeAuthoringTool(name) ?? describeHistoryTool(name);
