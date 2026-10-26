/**
 * One turn of a chat about a flow: the person's message to a read-only
 * session with the authoring tools, and the answer as `ChatEvent`s. The
 * first message starts the session with the chat's prompt; a later one
 * resumes it. A proposal the agent makes with `propose_flow` streams as a
 * `proposal` event, in the order the agent made it.
 *
 * Who keeps the chat (the thread and its session id) is the caller's: this
 * module knows one turn only.
 */
import {
	type AgentHarnessName,
	type AgentProfileSettings,
	type ChatEvent,
	type ChatRequest,
	type FlowProposal,
	isCustomHarness,
} from "@nightshift/flows";
import type { AgentHarness } from "../port";
import { chatFollowUpPrompt, chatPrompt } from "./prompts";
import { runAssistantSession } from "./session";
import {
	type AuthoringPort,
	authoringTools,
	describeAuthoringTool,
} from "./tools";

/**
 * Harnesses that cannot take Night Shift's own tools in a session: pi drops
 * MCP, Grok Build reports in text. A chat on them could not read the draft
 * or propose a flow.
 */
const WITHOUT_TOOLS: readonly AgentHarnessName[] = ["pi", "grok-build"];

/** Whether a chat can run on a profile of this harness. Custom agents speak ACP with MCP. */
export function chatCanUseTools(harness: AgentHarnessName): boolean {
	return isCustomHarness(harness) || !WITHOUT_TOOLS.includes(harness);
}

export type ChatTurnInput = {
	request: ChatRequest;
	/** The harness of the profile, as this computer runs it. */
	harness: AgentHarness;
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	/** The project's Clone on this computer. */
	cwd: string;
	/** What the tools read. Proposals become `proposal` events. */
	port: Omit<AuthoringPort, "propose">;
	/** Continue this session. Unset: the chat's first message. */
	resumeSessionId?: string;
	/** On resume: the chat was not about `request.runId` before. */
	newRun?: boolean;
	signal: AbortSignal;
};

/** A turn's events: the chat's own, and the session to resume next time. */
export type ChatTurnEvent =
	| Exclude<ChatEvent, { type: "thread" }>
	| { type: "session"; sessionId: string };

/**
 * Stream one turn: activity, text, usage and proposals, then `done` or an
 * `error`. A `session` event names the session once the harness does.
 * Never throws.
 */
export async function* chatTurn(
	input: ChatTurnInput,
): AsyncGenerator<ChatTurnEvent> {
	const { request, harness, signal } = input;
	const proposals: FlowProposal[] = [];
	const tools = authoringTools({
		...input.port,
		propose: (proposal) => {
			proposals.push(proposal);
		},
	});
	const prompt = input.resumeSessionId
		? chatFollowUpPrompt({
				message: request.message,
				...(input.newRun && request.runId ? { newRunId: request.runId } : {}),
			})
		: chatPrompt({
				flowName: request.flowName,
				flow: request.flow,
				message: request.message,
				...(request.runId ? { runId: request.runId } : {}),
			});
	const flush = function* (): Generator<ChatTurnEvent> {
		for (const proposal of proposals.splice(0)) {
			yield { type: "proposal", proposal };
		}
	};
	for await (const event of runAssistantSession({
		harness,
		profile: input.profile,
		cwd: input.cwd,
		prompt,
		...(input.resumeSessionId
			? { resumeSessionId: input.resumeSessionId }
			: {}),
		tools,
		describeTool: describeAuthoringTool,
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
}
