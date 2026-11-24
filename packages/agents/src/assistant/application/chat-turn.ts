import {
	type AgentProfileSettings,
	builtinAgent,
	type ChatEvent,
	type ChatRequest,
	chatMessage,
	type FlowProposal,
} from "@nightshift/flows";
import type { AgentHarness, BridgedTool } from "../../port";
import { type ChatExchange, chatFollowUpPrompt, chatPrompt } from "../catalog";
import type { AuthoringPort } from "../domain/authoring";
import type { HistoryPort } from "../domain/history-port";
import type { Sessions } from "../sessions";
import { draftSummary } from "../suggestion";

/** What the tools of one turn stand on. They push each proposal on `proposals`. */
export type TurnTools = {
	agent: "builder" | "improver";
	port: Omit<AuthoringPort, "propose">;
	past?: HistoryPort;
	proposals: FlowProposal[];
};

export type ChatTurnPorts = Pick<Sessions, "runSession"> & {
	/** The tools of one turn. They do no I/O of their own. */
	toolsFor(turn: TurnTools): readonly BridgedTool[];
	/** The line of one tool call in plain words. */
	describeTool(name: string): string | undefined;
};

export type ChatTurnInput = {
	request: ChatRequest;
	agent: "builder" | "improver";
	harness: AgentHarness;
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	cwd: string;
	port: Omit<AuthoringPort, "propose">;
	past?: HistoryPort;
	resumeSessionId?: string;
	newRun?: boolean;
	history?: readonly ChatExchange[];
	signal: AbortSignal;
};

export type ChatTurnEvent =
	| Exclude<ChatEvent, { type: "thread" }>
	| { type: "session"; sessionId: string };

export const chatTurn = (ports: ChatTurnPorts) =>
	async function* (input: ChatTurnInput): AsyncGenerator<ChatTurnEvent> {
		const { request, harness, signal } = input;
		const message = chatMessage(request) ?? "";
		const proposals: FlowProposal[] = [];
		// The history tools are the Improver's: their `get_run` reads any run
		// of the project. The prompt names them only when it has them.
		const past = input.agent === "improver" ? input.past : undefined;
		const aboutRun = input.agent === "improver" ? request.runId : undefined;
		const prompt = input.resumeSessionId
			? chatFollowUpPrompt({
					message,
					...(input.newRun && aboutRun ? { newRunId: aboutRun } : {}),
				})
			: chatPrompt({
					flowName: request.flowName,
					summary: draftSummary(request.flow),
					message,
					...(aboutRun ? { runId: aboutRun } : {}),
					...(past ? { past: true } : {}),
					...(input.history && input.history.length > 0
						? { history: input.history }
						: {}),
				});
		const flush = function* (): Generator<ChatTurnEvent> {
			for (const proposal of proposals.splice(0)) {
				yield { type: "proposal", proposal };
			}
		};
		const tools = ports.toolsFor({
			agent: input.agent,
			port: input.port,
			...(past ? { past } : {}),
			proposals,
		});
		for await (const event of ports.runSession({
			harness,
			profile: input.profile,
			cwd: input.cwd,
			prompt,
			...(input.resumeSessionId
				? { resumeSessionId: input.resumeSessionId }
				: {}),
			tools,
			describeTool: ports.describeTool,
			limits: builtinAgent(input.agent).limits,
			signal,
		})) {
			yield* flush();
			switch (event.type) {
				case "session":
				case "activity":
				case "text":
				case "usage":
					yield event;
					break;
				case "error":
					yield { type: "error", message: event.message };
					return;
				case "end":
					yield { type: "done" };
					return;
			}
		}
	};
