/**
 * One turn of a chat about a flow: the person's message to a read-only
 * session with the authoring tools, and the answer as `ChatEvent`s. The
 * first message starts the session with the chat's prompt; a later one
 * resumes it. A chat that moves to another agent starts a new session,
 * with the conversation so far in its first prompt. A proposal the agent
 * makes with `propose_flow` streams as a `proposal` event, in the order the
 * agent made it.
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
	harnessTakesTools,
} from "@nightshift/flows";
import type { AgentHarness } from "../port";
import { type ChatExchange, chatFollowUpPrompt, chatPrompt } from "./prompts";
import { runAssistantSession } from "./session";
import {
	type AuthoringPort,
	authoringTools,
	describeAuthoringTool,
} from "./tools";

/**
 * Whether a chat can run on this harness: it must take Night Shift's own
 * tools to read the draft and propose a flow.
 */
export function chatCanUseTools(harness: AgentHarnessName): boolean {
	return harnessTakesTools(harness);
}

/**
 * Harnesses whose session resumes on another model or effort: their CLI
 * takes the model again on each resume. On any other harness, a change of
 * model starts a new session, as a change of harness does.
 */
const SWITCHES_MODEL_ON_RESUME: readonly AgentHarnessName[] = [
	"claude-code",
	"opencode",
	"codex",
];

/** Whether a session of this harness resumes on another model or effort. */
export function resumesOnAnotherModel(harness: AgentHarnessName): boolean {
	return SWITCHES_MODEL_ON_RESUME.includes(harness);
}

export type ChatTurnInput = {
	request: ChatRequest;
	/** The harness that answers, as this computer runs it. */
	harness: AgentHarness;
	/** The model and effort that answer. */
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	/** The project's Clone on this computer. */
	cwd: string;
	/** What the tools read. Proposals become `proposal` events. */
	port: Omit<AuthoringPort, "propose">;
	/** Continue this session. Unset: a new session. */
	resumeSessionId?: string;
	/** On resume: the chat was not about `request.runId` before. */
	newRun?: boolean;
	/**
	 * A new session of a chat that had another agent before: the messages
	 * and answers so far, oldest first, so the chat keeps its context.
	 */
	history?: readonly ChatExchange[];
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
				...(input.history && input.history.length > 0
					? { history: input.history }
					: {}),
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
