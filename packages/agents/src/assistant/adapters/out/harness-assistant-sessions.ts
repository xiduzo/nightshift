/**
 * Runs a design-time assistant session on a harness: maps harness events to
 * what the assistant streams.
 */
import type { AssistantUsage } from "@nightshift/flows";
import type { AgentUsage, ValueResult } from "../../../port";
import { settleCost } from "../../../pricing";
import type { AssistantSessionInput } from "../../application/chat-turn";
import type { AssistantVia } from "../../application/explain-run";
import type { AssistantSessions } from "../../application/ports";

import {
	type AssistantReport,
	type AssistantSessionEvent,
	AT_LIMIT,
	sessionErrorMessage,
	settleUsage,
} from "../../domain/session";
import { activityOf } from "./activity-lines";

function usageOf(usage: AgentUsage, model: string | null): AssistantUsage {
	const { costUsd } = settleCost(usage, model);
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		...(costUsd !== null && costUsd !== undefined ? { costUsd } : {}),
	};
}

const MODEL_NOTE = [
	"",
	"---",
	"",
	"You cannot read files or call tools. Work with what is above only.",
	"Answer with one JSON object. `summary` is the summary of your step report. `data`, when asked for, is its data.",
].join("\n");

function reportSchema(
	output: Record<string, unknown> | undefined,
): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			summary: { type: "string" },
			...(output ? { data: output } : {}),
		},
		required: output ? ["summary", "data"] : ["summary"],
		additionalProperties: false,
	};
}

async function* runAssistantSession(
	input: AssistantSessionInput,
): AsyncGenerator<AssistantSessionEvent> {
	const { harness, profile, cwd, limits } = input;
	const stop = new AbortController();
	const signal = AbortSignal.any([input.signal, stop.signal]);
	let turns = 0;
	let sessionId: string | null = input.resumeSessionId ?? null;
	let model: string | null = profile.model;
	let report: AssistantReport | null = null;
	let text = "";
	let lastMessage: string | null = null;
	let lastActivity: string | null = null;
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
					if (event.parentToolCallId) break;
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
							usage: settleUsage(live, usageOf(event.usage, model)),
						};
					}
					if (event.limit && !report) {
						yield { type: "error", message: AT_LIMIT, sessionId };
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
					yield {
						type: "error",
						message: stop.signal.aborted
							? AT_LIMIT
							: sessionErrorMessage(
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
		yield {
			type: "error",
			message: stop.signal.aborted
				? AT_LIMIT
				: input.signal.aborted
					? "Stopped."
					: error instanceof Error && error.message
						? error.message
						: "The agent stopped with an error.",
			sessionId,
		};
	}
}

async function* runReportSession(
	via: AssistantVia,
	input: {
		prompt: string;
		report: { output?: Record<string, unknown> };
		resumeSessionId?: string;
		signal: AbortSignal;
	},
): AsyncGenerator<AssistantSessionEvent> {
	if (via.kind === "agent") {
		yield* runAssistantSession({
			harness: via.harness,
			profile: via.profile,
			cwd: via.cwd,
			prompt: input.prompt,
			report: input.report,
			...(input.resumeSessionId
				? { resumeSessionId: input.resumeSessionId }
				: {}),
			...(via.limits ? { limits: via.limits } : {}),
			signal: input.signal,
		});
		return;
	}
	yield { type: "activity", text: "Asks the model" };
	let result: ValueResult;
	try {
		result = await via.ask({
			prompt: `${input.prompt}\n${MODEL_NOTE}`,
			output: reportSchema(input.report.output),
			signal: input.signal,
		});
	} catch (error) {
		yield {
			type: "error",
			message: error instanceof Error ? error.message : "The model failed.",
			sessionId: null,
		};
		return;
	}
	if (result.costUsd !== null) {
		yield {
			type: "usage",
			usage: { inputTokens: 0, outputTokens: 0, costUsd: result.costUsd },
		};
	}
	if (result.kind === "error") {
		yield {
			type: "error",
			message: sessionErrorMessage(
				input.signal.aborted ? "aborted" : result.errorKind,
				result.message,
			),
			sessionId: null,
		};
		return;
	}
	const data =
		typeof result.data === "object" && result.data !== null
			? (result.data as { summary?: unknown; data?: unknown })
			: {};
	const summary = typeof data.summary === "string" ? data.summary : "";
	yield {
		type: "end",
		sessionId: "",
		report: {
			summary,
			...(data.data !== undefined ? { data: data.data } : {}),
		},
		text: summary,
	};
}

/** The real adapter: assistant sessions over harnesses on this computer. */
export function harnessAssistantSessions(): AssistantSessions {
	return {
		async *run(input) {
			yield* runAssistantSession(input);
		},
		async *runReport(via, input) {
			yield* runReportSession(via, input);
		},
	};
}
