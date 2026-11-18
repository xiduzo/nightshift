import { harnessLimitsTurns } from "@nightshift/agents/harness-facts";
import { settleCost } from "@nightshift/agents/pricing";
import type {
	AgentAskBrief,
	AgentUsage,
	StepReportOutcome,
} from "@nightshift/agents/types";
import {
	type AgentNode,
	type JsonValue,
	knowledgeFolderPath,
	profileLabel,
	renderTemplate,
	resolvedAgent,
} from "@nightshift/flows";
import { now } from "@nightshift/time";
import type { SessionEvent, SessionInput } from "../../../device";
import type { EnginePayloads, StepOutputs } from "../../../log";
import { deriveBudgetSpend } from "../../../read";
import {
	DEFAULT_RESUME_PROMPT,
	harnessLabel,
	isWaitKind,
	STOP_GRACE_MS,
	type StepContext,
	stepFailure,
} from "../../context";
import { normalizeOutputData, outputVerdict } from "../../data";
import {
	budgetPassed,
	guardMessage,
	runBudget,
	sessionGuards,
	turnLimit,
} from "../../policy";
import {
	type BodyResult,
	briefOf,
	type StepHandle,
	sessionCostUnknown,
} from "../../step";
import { ASK_CHOICES } from "./agent-ask";
import { closeStream, consumeStream } from "./consume";
import { ASK_OUTCOME, agentOutcomes, stepReportOf } from "./report";
import { programsOf } from "./requirements";

/**
 * The body of an Agent step: one harness session from its start to its
 * end (`runSession`), recorded through the session record of the step, and
 * the end of the step from the report.
 */

/** The prompt a new session gets: the node's prompt rendered, as `/<skill> <prompt>` with a skill. */
export function agentPrompt(node: AgentNode, tctx: StepHandle["tctx"]): string {
	const rendered = renderTemplate(node.prompt, tctx);
	return node.skill ? `/${node.skill} ${rendered}`.trim() : rendered;
}

/**
 * What the Device that runs the session gets of the project's knowledge:
 * the whole folder (`knowledge`), only some folders of it
 * (`knowledgeOnly`), or nothing. A list travels in a field of its own, so
 * a Device that does not know it gives no knowledge, never the whole folder.
 */
function knowledgeOf(
	node: AgentNode,
	projectId: string,
): Pick<SessionInput, "knowledge" | "knowledgeOnly"> {
	if (node.knowledge === false) return {};
	if (Array.isArray(node.knowledge)) {
		const folders = node.knowledge.flatMap(
			(folder) => knowledgeFolderPath(folder) ?? [],
		);
		return { knowledgeOnly: { projectId, folders } };
	}
	return {
		knowledge: {
			projectId,
			...(node.knowledge === true ? { always: true } : {}),
		},
	};
}

type AgentReport = {
	outcome: StepReportOutcome;
	summary: string;
	data?: unknown;
	ask?: AgentAskBrief;
};

type SessionEnding = EnginePayloads["SessionEnded"];

/** How often a session's spend so far goes to the log, at most. */
const SPENT_EVERY_MS = 5_000;

/**
 * One harness session of the step: `SessionStarted`, the stream (every
 * event but `usage` to the transcript; `HarnessSessionAssigned` when the
 * harness names its session; `SessionUsage` with the spend so far, at most
 * every `SPENT_EVERY_MS`), `SessionEnded`, then the step's end from the
 * report, the output schema and the node's outcomes; or a wait request.
 */
export async function runSession(
	ctx: StepContext,
	node: AgentNode,
	step: StepHandle,
	input: {
		prompt: string | null;
		resumeSessionId: string | null;
		/** The person's answer this session goes on with, when it does (`ask`). */
		note: string | null;
	},
): Promise<BodyResult> {
	const { visit, signal } = step;
	const { resumeSessionId } = input;
	const prompt = input.prompt ?? agentPrompt(node, step.tctx);

	const end = (
		outcome: string,
		outputs: StepOutputs,
		error: string | null,
		harnessSessionId: string | null,
	): BodyResult => ({ kind: "end", outcome, outputs, error, harnessSessionId });

	// The run resolved the node's profile when it started, unless the
	// profile is another Person's Offer: the Device that offers it
	// resolves it itself, and the Walker never learns its settings.
	const agent = resolvedAgent(node);
	if (!agent && node.profile === undefined) {
		return end(
			"error",
			{ outcome: "error", visit },
			`Agent node "${node.id}" has no harness, model or permission mode: name a profile, or set them on the node.`,
			null,
		);
	}
	// The node's connections go to the Device by name, with `${NAME}` as
	// written: the Device fills them in, and the values go to the harness
	// only, never into the log. The log keeps the node's
	// prompt only, like the report instruction the harness adds; a new
	// session learns its CLI tools from the Device after the prompt.
	const clis = [...new Set(programsOf(node))];
	// The run's budget: what the run spent since it started or a person
	// resumed it. Nothing left: the session does not start.
	const budgetUsd = runBudget(ctx);
	const spentBefore =
		budgetUsd === null ? 0 : deriveBudgetSpend(step.runState).usd;
	if (budgetUsd !== null && spentBefore >= budgetUsd) {
		step.halt("budget", budgetPassed(budgetUsd, spentBefore));
		return {
			kind: "aborted",
			outputs: {
				visit,
				output: "",
				summary: "",
				session_id: resumeSessionId ?? "",
			},
			harnessSessionId: resumeSessionId,
		};
	}
	const maxTurns = turnLimit(ctx, node);
	// The files people added to the run's answers go to the Device that runs it.
	const files = await ctx.artifacts.answerFiles(ctx.run.id);
	const common = {
		cwd: step.worktree,
		prompt,
		resumeSessionId: resumeSessionId ?? undefined,
		stepReport: stepReportOf(node),
		artifacts: { runId: ctx.run.id, stepId: step.stepId },
		...(files.length > 0 ? { files } : {}),
		// The project's knowledge folder on the Device that runs the step.
		...knowledgeOf(node, ctx.run.projectId),
		signal,
		...(maxTurns !== null ? { maxTurns } : {}),
		...(budgetUsd !== null ? { maxBudgetUsd: budgetUsd - spentBefore } : {}),
	};
	const stream = step.device
		.session(
			agent
				? {
						...common,
						harness: agent.harness,
						model: agent.model,
						permissionMode: agent.permissionMode,
						effort: agent.effort,
						...(clis.length > 0 ? { clis } : {}),
						...(node.connections ? { connections: node.connections } : {}),
					}
				: {
						...common,
						offered: {
							// By id. A run copied from format 6 still holds the name.
							profile: profileLabel(node.profile),
							...(node.permissionMode
								? { permissionMode: node.permissionMode }
								: {}),
						},
					},
		)
		[Symbol.asyncIterator]();
	// The Device says first whether the session can start: no session is
	// recorded for one that cannot.
	const first = await stream.next();
	const harness =
		agent?.harness ??
		(!first.done && first.value.type === "ready" ? first.value.harness : null);
	if (first.done || first.value.type !== "ready" || !harness) {
		return end(
			"error",
			{ outcome: "error", visit },
			!first.done && first.value.type === "refused"
				? first.value.message
				: "The agent could not start.",
			null,
		);
	}

	const session = await step.session({
		prompt,
		resumeSessionId,
		harness,
	});
	const sessionId = session.id;
	// The engine counts turns for a harness that does not stop at its limit itself.
	const guards = sessionGuards({
		maxTurns: harnessLimitsTurns(harness) ? null : maxTurns,
	});
	/** Stops the run when the session's spend so far takes it past its budget. */
	const checkBudget = (usage: AgentUsage | undefined) => {
		if (budgetUsd === null || !usage) return;
		const { costUsd } = settleCost(usage, sessionModel);
		if (costUsd !== null && spentBefore + costUsd > budgetUsd) {
			step.halt("budget", budgetPassed(budgetUsd, spentBefore + costUsd));
		}
	};

	let harnessSessionId: string | null = resumeSessionId;
	/** The model the harness says it runs, else the one the node asked for: the price list prices it. */
	let sessionModel: string | null = agent?.model || null;
	let ending: SessionEnding | null = null;
	let report: AgentReport | null = null;
	/** The text after the last tool call: the agent's final message. */
	let output = "";
	let afterTool = false;
	let lastMessageId: string | null = null;
	const stoppedByPerson = () => signal.aborted && signal.reason === "stopped";

	/** The usage so far, from the last `usage` event. */
	let used: AgentUsage | null = null;
	let spentAt = 0;
	let spentTimer: ReturnType<typeof setTimeout> | undefined;
	let sessionOver = false;
	const logSpent = () => {
		spentTimer = undefined;
		if (sessionOver || !used) return;
		spentAt = now();
		void session
			.spent({ usage: used, ...settleCost(used, sessionModel) })
			.catch(() => {});
	};
	/** Logs the spend so far now, or once `SPENT_EVERY_MS` passed since the last time. */
	const spendSoFar = (usage: AgentUsage) => {
		used = usage;
		if (spentTimer) return;
		const wait = spentAt + SPENT_EVERY_MS - now();
		if (wait <= 0) logSpent();
		else spentTimer = setTimeout(logSpent, wait);
	};

	/** The harness did more than name the session: it took a turn. */
	let tookATurn = false;

	const onEvent = async (agentEvent: SessionEvent): Promise<void> => {
		if (agentEvent.type === "ready" || agentEvent.type === "refused") return;
		if (agentEvent.type !== "session" && agentEvent.type !== "error") {
			tookATurn = true;
		}
		step.touch();
		// A search or a read of the knowledge goes to the log, not the transcript.
		if (agentEvent.type === "knowledge") {
			await step.usedKnowledge(sessionId, agentEvent);
			return;
		}
		// The spend so far is not part of the transcript.
		if (agentEvent.type === "usage") {
			spendSoFar(agentEvent.usage);
			checkBudget(agentEvent.usage);
			return;
		}
		step.record(sessionId, agentEvent);
		const trip = guards.see(agentEvent);
		if (trip) step.halt(trip.kind, guardMessage(trip));
		// A subagent's events go to the transcript only: its text is not the step's output.
		if ("parentToolCallId" in agentEvent && agentEvent.parentToolCallId) return;
		switch (agentEvent.type) {
			case "session":
				harnessSessionId = agentEvent.sessionId;
				sessionModel = agentEvent.model ?? sessionModel;
				await session.assigned(agentEvent.sessionId, agentEvent.model ?? null);
				break;
			case "text":
				// The output is the last message: a tool call or a new message starts it over.
				if (afterTool || agentEvent.messageId !== lastMessageId) {
					output = "";
					afterTool = false;
					lastMessageId = agentEvent.messageId;
				}
				output += agentEvent.delta;
				break;
			case "tool-start":
			case "tool-end":
			case "tool-result":
				afterTool = true;
				break;
			case "report":
				afterTool = true;
				report = {
					outcome: agentEvent.outcome,
					summary: agentEvent.summary,
					data: agentEvent.data,
					...(agentEvent.ask ? { ask: agentEvent.ask } : {}),
				};
				break;
			case "finished":
				ending = {
					outcome: "finished",
					error: null,
					errorKind: null,
					usage: agentEvent.usage ?? null,
					// The harness's cost, else its tokens priced for the model it ran.
					...settleCost(agentEvent.usage, sessionModel),
					resetAt: null,
				};
				// The harness stopped at a limit the session set (Claude Code).
				if (agentEvent.limit === "turns" && maxTurns !== null) {
					step.halt("turns", guardMessage({ kind: "turns", limit: maxTurns }));
				} else if (agentEvent.limit === "budget" && budgetUsd !== null) {
					step.halt(
						"budget",
						budgetPassed(budgetUsd, spentBefore + (ending.costUsd ?? 0)),
					);
				}
				break;
			case "error":
				ending = {
					outcome: stoppedByPerson() ? "stopped" : "failed",
					error: agentEvent.message,
					errorKind: agentEvent.kind,
					...spentBeforeTheEnd(),
					resetAt: agentEvent.resetAt ?? null,
				};
				break;
		}
	};

	/** A session that ends without a result keeps what it spent so far. */
	const spentBeforeTheEnd = () =>
		used
			? { usage: used, ...settleCost(used, sessionModel) }
			: { usage: null, costUsd: null };

	const endWithoutResult = (message: string): SessionEnding => ({
		outcome: stoppedByPerson() ? "stopped" : "failed",
		error: signal.aborted ? "The step was stopped." : message,
		errorKind: signal.aborted ? "aborted" : "harness",
		...spentBeforeTheEnd(),
		resetAt: null,
	});

	try {
		// A stop that came in while the session was being recorded. The
		// harness never ran, but the Device made the step's knowledge view:
		// its cleanup ends before the step does.
		if (signal.aborted) {
			await closeStream(stream, STOP_GRACE_MS);
			throw new Error("The step was stopped.");
		}
		await consumeStream(
			{ [Symbol.asyncIterator]: () => stream },
			{
				signal,
				graceMs: STOP_GRACE_MS,
				onItem: onEvent,
				isLast: (e) => e.type === "finished" || e.type === "error",
			},
		);
	} catch (error) {
		// A harness ends its stream with an `error` event: a throw is not one of its words.
		ending ??= endWithoutResult(
			signal.aborted
				? ""
				: stepFailure(
						error,
						`the session of node "${node.id}" of run ${ctx.run.id}`,
					),
		);
	}
	const final: SessionEnding =
		ending ?? endWithoutResult("The agent stopped without a result.");
	// The end has the final cost: no running total after it.
	sessionOver = true;
	clearTimeout(spentTimer);
	await session.ended(final);
	// The resume failed before a single turn: the harness has no
	// conversation to go on with (the session ended before its first turn,
	// or another computer keeps it). A new session starts instead.
	if (
		resumeSessionId !== null &&
		!tookATurn &&
		!signal.aborted &&
		final.outcome === "failed" &&
		final.errorKind === "harness"
	) {
		return runSession(ctx, node, step, {
			...input,
			resumeSessionId: null,
			prompt: freshPrompt(node, step, input.prompt),
		});
	}
	if (final.outcome === "finished" && final.costUsd === null) {
		await step.warn(
			"cost-unknown",
			sessionCostUnknown(
				harnessLabel(harness),
				sessionModel,
				(final.usage?.inputTokens ?? 0) + (final.usage?.outputTokens ?? 0) > 0,
			),
		);
	}

	const finalReport = report as AgentReport | null;
	if (finalReport && node.output) {
		finalReport.data = normalizeOutputData(node.output, finalReport.data);
	}
	const outputs: StepOutputs = {
		visit,
		output,
		summary: finalReport?.summary || output,
		session_id: harnessSessionId ?? "",
		...(input.note !== null ? { note: input.note } : {}),
	};
	if (finalReport?.data !== undefined) {
		outputs.data = finalReport.data as JsonValue;
	}
	if (signal.aborted) return { kind: "aborted", outputs, harnessSessionId };
	if (final.outcome === "failed" && isWaitKind(final.errorKind)) {
		return {
			kind: "wait",
			reason: final.errorKind,
			message: final.error ?? final.errorKind,
			resetAt: final.resetAt,
			harnessSessionId,
		};
	}
	const stepError = (error: string) =>
		end("error", { ...outputs, outcome: "error" }, error, harnessSessionId);
	if (finalReport) {
		const outcomes = agentOutcomes(node);
		if (!outcomes.includes(finalReport.outcome)) {
			return stepError(
				`The agent reported "${finalReport.outcome}", which is not an outcome of this node. Its outcomes are: ${outcomes.join(", ")}.`,
			);
		}
		// It asks a person: no edge, a Gate. Its data may wait for the answer.
		if (node.ask === "person" && finalReport.outcome === ASK_OUTCOME.name) {
			const ask = finalReport.ask ?? {};
			return {
				kind: "ask",
				question: askQuestion(finalReport.summary, output),
				choices: [...ASK_CHOICES],
				outputs: { ...outputs, outcome: ASK_OUTCOME.name },
				// The agent's own brief (ADR 21): no model call for its question.
				brief: briefOf(
					{
						...ask,
						...(ask.recommend
							? {
									recommend: {
										option: ask.recommend.choice,
										...(ask.recommend.reason
											? { reason: ask.recommend.reason }
											: {}),
									},
								}
							: {}),
					},
					ASK_CHOICES,
					true,
				),
			};
		}
		// A schema a person wrote holds the data to it, an inferred one warns.
		const verdict = outputVerdict(node, finalReport.data);
		if (verdict.kind === "broken") return stepError(verdict.message);
		if (verdict.kind === "warning") await step.warn("shape", verdict.message);
		return end(
			finalReport.outcome,
			{ ...outputs, outcome: finalReport.outcome },
			null,
			harnessSessionId,
		);
	}
	if (final.outcome === "finished") {
		if (node.outcomes) {
			return stepError(
				`The agent finished with no step report. This node needs one of its outcomes: ${agentOutcomes(node).join(", ")}.`,
			);
		}
		const verdict = outputVerdict(node, undefined);
		if (verdict.kind === "warning") await step.warn("shape", verdict.message);
		if (verdict.kind === "broken") {
			return stepError(
				"The agent finished with no step report, so it gave no data for the output schema.",
			);
		}
		return end("pass", { ...outputs, outcome: "pass" }, null, harnessSessionId);
	}
	return end(
		"error",
		{ ...outputs, outcome: "error" },
		final.error ?? "The agent failed.",
		harnessSessionId,
	);
}

/**
 * The prompt of a new session in place of a resume that failed: the node's
 * own prompt, then the follow-up when it says more than "go on".
 */
function freshPrompt(
	node: AgentNode,
	step: StepHandle,
	followUp: string | null,
): string {
	const own = agentPrompt(node, step.tctx);
	return followUp === null || followUp === DEFAULT_RESUME_PROMPT
		? own
		: `${own}\n\n${followUp}`;
}

/**
 * What the Gate of an agent that asks shows: its summary, then its final
 * message, where its questions are, when that says more.
 */
function askQuestion(summary: string, output: string): string {
	const short = summary.trim();
	const long = output.trim();
	if (long === "" || long === short) return short;
	if (short === "") return long;
	return `${short}\n\n${long}`;
}
