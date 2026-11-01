/**
 * The assistant's design-time session: one harness session on the agent
 * the person picked (an Agent Profile, or a harness and model), in a
 * project's Clone, read only. Generic: it knows nothing of
 * suggestions or chats. A suggestion asks for a step report with an output
 * schema; a chat resumes the session per message and adds its own tools.
 *
 * It maps the harness's events to what the assistant streams: `activity`
 * lines in plain words, the answer's `text`, the `usage` so far, and one
 * `end` (with the report and the session id to resume) or `error` last.
 */
import type { AgentProfileSettings, AssistantUsage } from "@nightshift/flows";
import { formatDateTime } from "@nightshift/time";
import type {
	AgentErrorKind,
	AgentHarness,
	AgentUsage,
	BridgedTool,
} from "../port";
import { settleCost } from "../pricing";
import { activityOf } from "./activity";

export type AssistantSessionInput = {
	/** The harness that answers, as this computer runs it. */
	harness: AgentHarness;
	/**
	 * The model and effort: a profile's, with the person's overrides, or
	 * the ones the person picked. Nothing else of a profile is used (its
	 * permission mode, CLI tools, connections): the session reads the
	 * project and changes nothing.
	 */
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	/** The project's Clone on this computer. */
	cwd: string;
	prompt: string;
	/** Continue this session (the `sessionId` of an earlier `end` or `error`). */
	resumeSessionId?: string;
	/** Night Shift's own tools, over the shared bridge. pi cannot offer them. */
	tools?: readonly BridgedTool[];
	/** The activity line of a call of one of `tools`, by its name. */
	describeTool?: (name: string, input: unknown) => string | undefined;
	/**
	 * Ask for a step report: a summary, and `data` matching `output` when
	 * given. No outcome: the assistant has none to pick.
	 */
	report?: { output?: Record<string, unknown> };
	signal: AbortSignal;
};

/** The step report of an assistant session. `data` is not checked yet. */
export type AssistantReport = { summary: string; data?: unknown };

export type AssistantSessionEvent =
	/** First, once the harness names its session. */
	| { type: "session"; sessionId: string }
	| { type: "activity"; text: string }
	| { type: "text"; delta: string }
	/** What the session has used so far: a running total. */
	| { type: "usage"; usage: AssistantUsage }
	/** Last, when the session failed. `sessionId` resumes it, when it has one. */
	| { type: "error"; message: string; sessionId: string | null }
	/** Last, when the session finished. */
	| {
			type: "end";
			sessionId: string;
			/** Null when the session was asked for none, or ended without one. */
			report: AssistantReport | null;
			/** The whole answer text, as `text` streamed it. */
			text: string;
	  };

/** Words for the person about a failed session. */
export function sessionErrorMessage(
	kind: AgentErrorKind,
	message: string,
	resetAt?: number,
): string {
	switch (kind) {
		case "aborted":
			return "Stopped.";
		case "usage-limit":
			return resetAt
				? `This agent reached its usage limit until ${formatDateTime(resetAt)}. Try again then, or choose another agent.`
				: "This agent reached its usage limit. Try again later, or choose another agent.";
		case "network":
			return "Night Shift could not reach the model. Check the internet connection, then try again.";
		default:
			return message.trim() || "The agent stopped with an error.";
	}
}

function usageOf(usage: AgentUsage, model: string | null): AssistantUsage {
	const { costUsd } = settleCost(usage, model);
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		...(costUsd !== null && costUsd !== undefined ? { costUsd } : {}),
	};
}

/**
 * The session's total at its end: the harness's own (`end`), unless it
 * counts less than the running total before it (`live`). A running total
 * never goes down: an end usage with fewer tokens covers only part of the
 * session (its last model call, say), so the larger counts and cost win.
 * An end usage that covers the running total wins whole: its reported
 * cost is truer than an estimate from tokens.
 */
export function settleUsage(
	live: AssistantUsage | null,
	end: AssistantUsage,
): AssistantUsage {
	if (
		!live ||
		(end.inputTokens >= live.inputTokens &&
			end.outputTokens >= live.outputTokens)
	) {
		return end;
	}
	const costs = [live.costUsd, end.costUsd].filter(
		(cost): cost is number => cost !== undefined,
	);
	return {
		inputTokens: Math.max(live.inputTokens, end.inputTokens),
		outputTokens: Math.max(live.outputTokens, end.outputTokens),
		...(costs.length > 0 ? { costUsd: Math.max(...costs) } : {}),
	};
}

/**
 * Run one assistant session. Never throws: a failure ends the stream with
 * an `error` event. Aborting `signal` stops the harness.
 */
export async function* runAssistantSession(
	input: AssistantSessionInput,
): AsyncGenerator<AssistantSessionEvent> {
	const { harness, profile, cwd, signal } = input;
	let sessionId: string | null = input.resumeSessionId ?? null;
	let model: string | null = profile.model;
	let report: AssistantReport | null = null;
	let text = "";
	let lastMessage: string | null = null;
	let lastActivity: string | null = null;
	/** The running total the harness reported last. */
	let live: AssistantUsage | null = null;
	try {
		const events = harness.run({
			cwd,
			prompt: input.prompt,
			model: profile.model,
			...(profile.effort ? { effort: profile.effort } : {}),
			permissionMode: "default",
			readOnly: true,
			...(input.resumeSessionId
				? { resumeSessionId: input.resumeSessionId }
				: {}),
			...(input.report
				? {
						stepReport: {
							outcome: false,
							...(input.report.output ? { output: input.report.output } : {}),
						},
					}
				: {}),
			...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
			signal,
		});
		for await (const event of events) {
			switch (event.type) {
				case "session":
					sessionId = event.sessionId;
					if (event.model) model = event.model;
					yield { type: "session", sessionId: event.sessionId };
					break;
				case "text": {
					// A subagent's text is its own work, not the answer.
					if (event.parentToolCallId) break;
					// A new message after a tool call starts a new paragraph.
					const gap =
						lastMessage !== null && lastMessage !== event.messageId && text
							? "\n\n"
							: "";
					lastMessage = event.messageId;
					text += gap + event.delta;
					yield { type: "text", delta: gap + event.delta };
					break;
				}
				case "tool-end": {
					const line = activityOf(
						event.name,
						event.input,
						cwd,
						input.describeTool,
					);
					if (line && line !== lastActivity) {
						lastActivity = line;
						yield { type: "activity", text: line };
					}
					break;
				}
				case "report":
					report = {
						summary: event.summary,
						...(event.data !== undefined ? { data: event.data } : {}),
					};
					break;
				case "usage":
					live = usageOf(event.usage, model);
					yield { type: "usage", usage: live };
					break;
				case "finished":
					if (event.usage) {
						yield {
							type: "usage",
							usage: settleUsage(live, usageOf(event.usage, model)),
						};
					}
					yield {
						type: "end",
						sessionId: sessionId ?? "",
						report,
						text,
					};
					return;
				case "error":
					yield {
						type: "error",
						message: sessionErrorMessage(
							signal.aborted ? "aborted" : event.kind,
							event.message,
							event.resetAt,
						),
						sessionId,
					};
					return;
				default:
					break;
			}
		}
		yield {
			type: "error",
			message: "The agent stopped without an answer.",
			sessionId,
		};
	} catch (error) {
		yield {
			type: "error",
			message: signal.aborted
				? "Stopped."
				: error instanceof Error && error.message
					? error.message
					: "The agent stopped with an error.",
			sessionId,
		};
	}
}
