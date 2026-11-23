import {
	type AgentProfileSettings,
	type ChatEvent,
	type ChatRequest,
	chatMessage,
	type FlowProposal,
} from "@nightshift/flows";
import type { AgentHarness } from "../../port";
import { chatFollowUpPrompt, type ChatExchange, chatPrompt } from "../domain/prompts";
import type { AuthoringPort } from "../domain/authoring";
export type HistoryPort = import("../adapters/out/tanstack-history-tools").HistoryPort;
import type { AssistantSessions } from "./ports";

export type ChatTools = {
	forTurn(input: {
		agent: "builder" | "improver";
		port: Omit<AuthoringPort, "propose">;
		past?: HistoryPort;
		proposals: { push(p: FlowProposal): void };
	}): readonly import("../../port").BridgedTool[];
	describeTool(name: string, input: unknown): string | undefined;
	limits(agent: "builder" | "improver"): import("../domain/session").SessionLimits;
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

export const chatTurn =
	(ports: ChatTurnPorts) =>
	async function* (
		input: ChatTurnInput,
	): AsyncGenerator<ChatTurnEvent> {
		const { request, harness, signal } = input;
		const message = chatMessage(request) ?? "";
		const proposals: FlowProposal[] = [];
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
					...(input.past ? { past: true } : {}),
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
			...(input.past ? { past: input.past } : {}),
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