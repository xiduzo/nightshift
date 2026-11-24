import {
	type AgentProfileSettings,
	type ChatEvent,
	type ChatRequest,
	chatMessage,
	type FlowProposal,
} from "@nightshift/flows";
import type { AgentHarness, BridgedTool } from "../../port";
import { type ChatExchange, chatFollowUpPrompt, chatPrompt } from "../catalog";
import type { AuthoringPort } from "../domain/authoring";
import type { HistoryPort } from "../domain/history-port";
import type { SessionLimits } from "../domain/session";
import type { AssistantSessions } from "./ports";

export type { HistoryPort };

export type ChatTools = {
	forTurn(input: {
		agent: "builder" | "improver";
		port: Omit<AuthoringPort, "propose">;
		past?: HistoryPort;
		proposals: { push(p: FlowProposal): void };
	}): readonly BridgedTool[];
	describeTool(name: string, input: unknown): string | undefined;
	limits(agent: "builder" | "improver"): SessionLimits;
};

/** What a session is asked. `cwd` is the project's Clone on this computer. */
export type AssistantSessionInput = {
	/** The harness that answers, as this computer runs it. */
	harness: AgentHarness;
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	cwd: string;
	prompt: string;
	resumeSessionId?: string;
	tools?: readonly BridgedTool[];
	describeTool?: (name: string, input: unknown) => string | undefined;
	report?: { output?: Record<string, unknown> };
	limits?: SessionLimits;
	signal: AbortSignal;
};

export type ChatTurnPorts = {
	sessions: Pick<AssistantSessions, "run">;
	chatTools: ChatTools;
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
					flow: request.flow,
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
		const tools = ports.chatTools.forTurn({
			agent: input.agent,
			port: input.port,
			...(past ? { past } : {}),
			proposals,
		});
		for await (const event of ports.sessions.run({
			harness,
			profile: input.profile,
			cwd: input.cwd,
			prompt,
			...(input.resumeSessionId
				? { resumeSessionId: input.resumeSessionId }
				: {}),
			tools,
			describeTool: ports.chatTools.describeTool,
			limits: ports.chatTools.limits(input.agent),
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
