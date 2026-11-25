/**
 * One harness session on the agent the person picked (an Agent Profile, or
 * a harness and model), in a project's Clone, read only. Generic: it knows
 * nothing of suggestions or chats.
 *
 * It maps the harness's events to what the assistant streams: `activity`
 * lines in plain words, the answer's `text`, the `usage` so far, and one
 * `end` (with the report and the session id to resume) or `error` last.
 */
import type { AgentProfileSettings, AssistantUsage } from "@nightshift/flows";
import type { AgentHarness, AgentUsage, BridgedTool } from "../../../port";
import {
	type AssistantReport,
	type AssistantSessionEvent,
	endAtLimit,
	type SessionLimits,
	sessionErrorMessage,
	settleUsage,
} from "../domain/session";

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
	/**
	 * The most one answer may use: the limits of the built-in agent that
	 * answers. The session stops there, and the person can ask again.
	 */
	limits?: SessionLimits;
	signal: AbortSignal;
};

/** What a session cannot do on its own: neither has I/O. */
export type SessionPorts = {
	/** The line of one tool call in plain words. Null: nothing to show. */
	activityOf(
		name: string,
		input: unknown,
		cwd: string,
		describe?: (name: string, input: unknown) => string | undefined,
	): string | null;
	/** What a usage cost in dollars. Null: not known. */
	costOf(usage: AgentUsage, model: string | null): number | null;
};

function usageOf(costUsd: number | null, usage: AgentUsage): AssistantUsage {
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		...(costUsd !== null ? { costUsd } : {}),
	};
}

/**
 * Run one assistant session. Never throws: a failure ends the stream with
 * an `error` event. Aborting `signal` stops the harness.
 */
export const runSession = (ports: SessionPorts) =>
	async function* (
		input: AssistantSessionInput,
	): AsyncGenerator<AssistantSessionEvent> {
		const { harness, profile, cwd, limits } = input;
		// A harness that does not stop at a limit itself is stopped here.
		const stop = new AbortController();
		const signal = AbortSignal.any([input.signal, stop.signal]);
		let turns = 0;
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
				...(input.tools && input.tools.length > 0
					? { tools: input.tools }
					: {}),
				...(limits?.turns !== undefined ? { maxTurns: limits.turns } : {}),
				...(limits?.usd !== undefined ? { maxBudgetUsd: limits.usd } : {}),
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
						if (lastMessage !== event.messageId) turns += 1;
						lastMessage = event.messageId;
						if (limits?.turns !== undefined && turns > limits.turns) {
							stop.abort();
						}
						text += gap + event.delta;
						yield { type: "text", delta: gap + event.delta };
						break;
					}
					case "tool-end": {
						const line = ports.activityOf(
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
						live = usageOf(ports.costOf(event.usage, model), event.usage);
						yield { type: "usage", usage: live };
						if (
							limits?.usd !== undefined &&
							live.costUsd !== undefined &&
							live.costUsd > limits.usd
						) {
							stop.abort();
						}
						break;
					case "finished":
						if (event.usage) {
							yield {
								type: "usage",
								usage: settleUsage(
									live,
									usageOf(ports.costOf(event.usage, model), event.usage),
								),
							};
						}
						if (event.limit && !report) {
							yield endAtLimit(sessionId);
							return;
						}
						yield {
							type: "end",
							sessionId: sessionId ?? "",
							report,
							text,
						};
						return;
					case "error":
						yield stop.signal.aborted
							? endAtLimit(sessionId)
							: {
									type: "error",
									message: sessionErrorMessage(
										input.signal.aborted ? "aborted" : event.kind,
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
			yield stop.signal.aborted
				? endAtLimit(sessionId)
				: {
						type: "error",
						message: input.signal.aborted
							? "Stopped."
							: error instanceof Error && error.message
								? error.message
								: "The agent stopped with an error.",
						sessionId,
					};
		}
	};
