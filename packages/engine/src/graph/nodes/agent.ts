import { randomUUID } from "node:crypto";
import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { DECIDER_ADAPTERS } from "@nightshift/agents/decider";
import type {
	AgentEvent,
	AgentSessionInput,
	StepReportOutcome,
	StepReportSpec,
} from "@nightshift/agents/types";
import { agentSession } from "@nightshift/db/schema/nightshift";
import {
	type AgentNode,
	type JsonValue,
	optionProblem,
	renderTemplate,
	resolvedAgent,
} from "@nightshift/flows";
import { eq } from "drizzle-orm";

import { cliToolsInstruction } from "../../cli-tools";
import { consumeStream } from "../../consume";
import {
	type EnginePayloads,
	type LoggedEvent,
	lastHarnessSessionOfNode,
	type StepOutputs,
	scopeKey,
} from "../../events";
import { checkOutputData, normalizeOutputData } from "../../output-schema";
import {
	beginStep,
	beginWait,
	HARNESS_LABEL,
	isWaitKind,
	messageOf,
	type NodeAction,
	pastStopTime,
	STOP_GRACE_MS,
	STOP_TIME_REASON,
	type StepContext,
	type StepHandle,
	type StepStart,
	type WaitRequest,
} from "../context";
import { RESUME_RULES, resumePoint, entryOf as startOf } from "../resume-point";
import {
	parkStopped,
	route,
	type StepEnd,
	scopeOf,
	waitNodeId,
} from "../route";
import type { RunStateValues } from "../state";
import { decideWithin } from "./choosers/model";

/**
 * The Agent node: one harness session per visit, ported from `runAgentStep`
 * in engine.ts. The log is written as there: `SessionStarted`,
 * `HarnessSessionAssigned`, `SessionEnded`, then the step's end.
 *
 * How the node enters is one resume point (`resumePoint`, graph/resume-point.ts,
 * `RESUME_RULES.agent`): a step that waited continues with its harness
 * session and `pending.prompt` as the follow-up (nothing is appended before
 * `SessionStarted`), or is reopened (`StepReopened`) when recovery ended it
 * after the wake; a parked step a person resumed, or a step the daemon died
 * in (design rule 5), is reopened when it has a harness session to
 * continue, with the resume prompt; else a new visit. With `session:
 * "resume"` a new visit continues the node's last harness session
 * (`lastHarnessSessionOfNode`).
 *
 * A usage limit or a network failure plans a wait (`beginWait`) and jumps
 * to the wait node (`wait__<id>`, the shared `waitNode` in graph/wait.ts),
 * which interrupts; a give-up ends the step `error`. Everything else ends
 * the step and routes (`route()`).
 */
export function agentNode(node: AgentNode, ctx: StepContext): NodeAction {
	return async (state, config) => {
		const events = await ctx.log.events(ctx.run.id);
		const entry = entryOf(node, state, events, config);
		const begun = await beginStep(ctx, node, state, config, entry.start);
		if (begun.kind === "parked") return begun.command;
		const step = begun.step;
		// The wait ended past the stop time (Night Shift was not running at
		// the wake): the step does not continue, a resume continues it.
		if (step.opened === "continue" && pastStopTime(ctx, state, config)) {
			const end = await step.end(
				"stopped",
				{ outcome: "stopped", visit: step.visit },
				null,
				{ harnessSessionId: entry.resumeSessionId },
			);
			return parkStopped(node, end, STOP_TIME_REASON);
		}

		let result: StepEnd | WaitRequest;
		try {
			result = await runSession(ctx, node, step, {
				prompt: entry.prompt,
				resumeSessionId: entry.resumeSessionId,
			});
			if ("reason" in result) {
				const waited = await beginWait(ctx, node, state, config, step, result);
				if (waited.kind === "stop-time") {
					const end = await step.end(
						"stopped",
						{ outcome: "stopped", visit: step.visit },
						null,
						{ harnessSessionId: result.harnessSessionId },
					);
					return parkStopped(node, end, waited.reason);
				}
				if (waited.kind === "wait") {
					return new Command({
						update: {
							pending: waited.pending,
							visits: { [node.id]: step.visit },
						},
						goto: waitNodeId(node.id),
					});
				}
				result = await step.end(
					"error",
					{ outcome: "error", visit: step.visit },
					waited.error,
					{ harnessSessionId: result.harnessSessionId },
				);
			}
		} catch (error) {
			result = await step.end(
				"error",
				{ outcome: "error", visit: step.visit },
				messageOf(error),
			);
		}
		return route(ctx, state, node, result, config);
	};
}

type Entry = {
	start: StepStart;
	/** The follow-up message of a continued session; null renders the node's prompt. */
	prompt: string | null;
	resumeSessionId: string | null;
};

/** The resume point, with the harness session a new `session: "resume"` visit continues. */
function entryOf(
	node: AgentNode,
	state: RunStateValues,
	events: readonly LoggedEvent[],
	config: LangGraphRunnableConfig,
): Entry {
	const point = resumePoint(
		node,
		state,
		events,
		scopeOf(config),
		RESUME_RULES.agent,
	);
	if (point.kind === "new") {
		return {
			start: { kind: "new" },
			prompt: null,
			resumeSessionId:
				node.session === "resume"
					? lastSessionOf(node, state, events, config)
					: null,
		};
	}
	return {
		start: startOf(point),
		prompt: point.prompt,
		resumeSessionId: point.harnessSessionId,
	};
}

/**
 * The harness session a `session: "resume"` visit continues: the one the
 * node's latest committed visit ended with (`state.nodes[id].session_id`),
 * else the log's (a visit that ended before its session got an id, or a
 * thread re-entered from the log).
 */
function lastSessionOf(
	node: AgentNode,
	state: RunStateValues,
	events: readonly LoggedEvent[],
	config: LangGraphRunnableConfig,
): string | null {
	const own = state.nodes[node.id]?.session_id;
	if (typeof own === "string" && own !== "") return own;
	return lastHarnessSessionOfNode(events, node.id, scopeKey(scopeOf(config)));
}

const BUILT_IN_AGENT_OUTCOMES = ["pass", "fail", "needs-input"];

/** The outcomes an Agent node may report. */
function agentOutcomes(node: AgentNode): string[] {
	return node.outcomes?.map((o) => o.name) ?? BUILT_IN_AGENT_OUTCOMES;
}

/** The built-in outcomes as a checker sees them. */
const BUILT_IN_CHECK_OUTCOMES = [
	{ name: "pass", description: "The task is done." },
	{ name: "fail", description: "The task is not done." },
	{
		name: "needs-input",
		description: "A person must decide or provide something first.",
	},
];

/** The outcomes a checker picks from: name and description only. */
function checkOutcomes(
	node: AgentNode,
): { name: string; description?: string }[] {
	return (
		node.outcomes?.map((o) =>
			o.description === undefined
				? { name: o.name }
				: { name: o.name, description: o.description },
		) ?? BUILT_IN_CHECK_OUTCOMES
	);
}

/**
 * What the harness asks the agent to report: a spec for own outcomes or an
 * output schema. With a checker the agent reports no outcome: the checker
 * picks it.
 */
function stepReportOf(node: AgentNode): AgentSessionInput["stepReport"] {
	if (node.checker) {
		return node.output
			? { outcome: false, output: node.output }
			: { outcome: false };
	}
	if (!node.outcomes && !node.output) return true;
	const spec: StepReportSpec = {};
	if (node.outcomes) {
		spec.outcomes = node.outcomes.map((o) =>
			o.description === undefined
				? { name: o.name }
				: { name: o.name, description: o.description },
		);
	}
	if (node.output) spec.output = node.output;
	return spec;
}

type AgentReport = {
	outcome: StepReportOutcome;
	summary: string;
	data?: unknown;
};

type SessionEnding = EnginePayloads["SessionEnded"];

/**
 * One harness session of the step: `SessionStarted`, the stream (every
 * event to the transcript; `HarnessSessionAssigned` when the harness names
 * its session), `SessionEnded`, then the step's end from the report, the
 * output schema and the node's outcomes; or a wait request.
 */
async function runSession(
	ctx: StepContext,
	node: AgentNode,
	step: StepHandle,
	input: { prompt: string | null; resumeSessionId: string | null },
): Promise<StepEnd | WaitRequest> {
	const runId = ctx.run.id;
	const { stepId, visit, signal } = step;
	const { resumeSessionId } = input;
	const prompt =
		input.prompt ??
		(() => {
			const rendered = renderTemplate(node.prompt, step.tctx);
			return node.skill ? `/${node.skill} ${rendered}`.trim() : rendered;
		})();

	const end = (
		outcome: StepEnd["outcome"],
		outputs: StepOutputs,
		error: string | null,
		harnessSessionId: string | null,
	) => step.end(outcome, outputs, error, { harnessSessionId });

	// The run resolved the node's profile when it started.
	const agent = resolvedAgent(node);
	if (!agent) {
		return end(
			"error",
			{ outcome: "error", visit },
			`Agent node "${node.id}" has no harness, model or permission mode: name a profile, or set them on the node.`,
			null,
		);
	}
	const harness = ctx.harnessFor(agent.harness);
	if (!harness) {
		return end(
			"error",
			{ outcome: "error", visit },
			`No ${HARNESS_LABEL[agent.harness]} harness is added. Add it under Agents.`,
			null,
		);
	}

	// The node's connections and its own servers. `${NAME}` in env values
	// and headers reads the keychain, then the daemon's environment. The
	// expanded values go to the harness only, never into the log.
	const mcp = await ctx.mcpServersFor(node);
	if (!mcp.ok) {
		return end("error", { outcome: "error", visit }, mcp.message, null);
	}

	// A new session learns its CLI tools after the prompt. A resumed session
	// has them already. Plan mode runs no command. The log keeps the node's
	// prompt only, like the report instruction the harness adds.
	// The daemon's CLI tools (with the profile's) and the node's own.
	const clis = [...new Set([...(node.clis ?? []), ...(node.nodeClis ?? [])])];
	const cliGuide =
		!resumeSessionId &&
		agent.permissionMode !== "plan" &&
		clis.length > 0 &&
		ctx.cliToolsFor
			? cliToolsInstruction(await ctx.cliToolsFor(clis))
			: "";
	const harnessPrompt = cliGuide ? `${prompt}\n\n${cliGuide}` : prompt;

	const sessionId = randomUUID();
	await ctx.db
		.insert(agentSession)
		.values({ id: sessionId, runId, stepId, prompt });
	await ctx.log.append({
		type: "SessionStarted",
		runId,
		stepId,
		sessionId,
		payload: { prompt, resumeSessionId, harness: agent.harness },
	});
	ctx.bus.publish(runId, { kind: "step-changed", stepId });

	let harnessSessionId: string | null = resumeSessionId;
	let ending: SessionEnding | null = null;
	let report: AgentReport | null = null;
	/** The text after the last tool call: the agent's final message. */
	let output = "";
	let afterTool = false;
	let lastMessageId: string | null = null;
	const stoppedByPerson = () => signal.aborted && signal.reason === "stopped";

	const onEvent = async (agentEvent: AgentEvent): Promise<void> => {
		step.touch();
		step.record(sessionId, agentEvent);
		switch (agentEvent.type) {
			case "session":
				harnessSessionId = agentEvent.sessionId;
				await ctx.db
					.update(agentSession)
					.set({ harnessSessionId: agentEvent.sessionId })
					.where(eq(agentSession.id, sessionId));
				await ctx.log.append({
					type: "HarnessSessionAssigned",
					runId,
					stepId,
					sessionId,
					payload: {
						harnessSessionId: agentEvent.sessionId,
						model: agentEvent.model ?? null,
					},
				});
				ctx.bus.publish(runId, { kind: "step-changed", stepId });
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
				};
				break;
			case "finished":
				ending = {
					outcome: "finished",
					error: null,
					errorKind: null,
					usage: agentEvent.usage ?? null,
					costUsd: agentEvent.usage?.costUsd ?? null,
					resetAt: null,
				};
				break;
			case "error":
				ending = {
					outcome: stoppedByPerson() ? "stopped" : "failed",
					error: agentEvent.message,
					errorKind: agentEvent.kind,
					usage: null,
					costUsd: null,
					resetAt: agentEvent.resetAt ?? null,
				};
				break;
		}
	};

	const endWithoutResult = (message: string): SessionEnding => ({
		outcome: stoppedByPerson() ? "stopped" : "failed",
		error: signal.aborted ? "The session was aborted." : message,
		errorKind: signal.aborted ? "aborted" : "harness",
		usage: null,
		costUsd: null,
		resetAt: null,
	});

	try {
		// A stop that came in while the session was being recorded.
		if (signal.aborted) throw new Error("The session was aborted.");
		const stream = harness.run({
			cwd: ctx.run.worktreePath,
			prompt: harnessPrompt,
			model: agent.model,
			permissionMode: agent.permissionMode,
			effort: agent.effort,
			resumeSessionId: resumeSessionId ?? undefined,
			stepReport: stepReportOf(node),
			...(clis.length > 0 ? { clis } : {}),
			...(Object.keys(mcp.servers).length > 0
				? { mcpServers: mcp.servers }
				: {}),
			signal,
		});
		await consumeStream(stream, {
			signal,
			graceMs: STOP_GRACE_MS,
			onItem: onEvent,
			isLast: (e) => e.type === "finished" || e.type === "error",
		});
	} catch (error) {
		ending ??= endWithoutResult(messageOf(error));
	}
	const final: SessionEnding =
		ending ?? endWithoutResult("The harness stream ended without a result.");
	await ctx.log.append({
		type: "SessionEnded",
		runId,
		stepId,
		sessionId,
		payload: final,
	});

	const finalReport = report as AgentReport | null;
	if (finalReport && node.output) {
		finalReport.data = normalizeOutputData(node.output, finalReport.data);
	}
	const outputs: StepOutputs = {
		visit,
		output,
		summary: finalReport?.summary || output,
		session_id: harnessSessionId ?? "",
	};
	if (finalReport?.data !== undefined) {
		outputs.data = finalReport.data as JsonValue;
	}
	const aborted = step.abortResult(outputs);
	if (aborted) {
		return end(
			aborted.outcome,
			aborted.outputs,
			aborted.error,
			harnessSessionId,
		);
	}
	if (final.outcome === "failed" && isWaitKind(final.errorKind)) {
		return {
			reason: final.errorKind,
			message: final.error ?? final.errorKind,
			resetAt: final.resetAt,
			harnessSessionId,
		};
	}
	const stepError = (error: string) =>
		end("error", { ...outputs, outcome: "error" }, error, harnessSessionId);
	if (node.checker && (finalReport || final.outcome === "finished")) {
		if (node.output) {
			if (!finalReport) {
				return stepError(
					"The agent finished with no step report, so it gave no data for the output schema.",
				);
			}
			const problem = checkOutputData(node.output, finalReport.data);
			if (problem) return stepError(problem);
		}
		return checkOutcome(ctx, node, step, outputs, harnessSessionId);
	}
	if (finalReport) {
		const outcomes = agentOutcomes(node);
		if (!outcomes.includes(finalReport.outcome)) {
			return stepError(
				`The agent reported "${finalReport.outcome}", which is not an outcome of this node. Its outcomes are: ${outcomes.join(", ")}.`,
			);
		}
		if (node.output) {
			const problem = checkOutputData(node.output, finalReport.data);
			if (problem) return stepError(problem);
		}
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
		if (node.output) {
			return stepError(
				"The agent finished with no step report, so it gave no data for the output schema.",
			);
		}
		return end("pass", { ...outputs, outcome: "pass" }, null, harnessSessionId);
	}
	return end(
		"error",
		{ ...outputs, outcome: "error" },
		final.error ?? "The agent session failed.",
		harnessSessionId,
	);
}

/** What the checker reads when its prompt is empty. */
const DEFAULT_CHECK_BRIEF =
	"Read what the agent did, then pick the outcome that fits its result.";

/**
 * The checker of an Agent node: after the session, its decider reads the
 * agent's task, summary, final message and data, and picks one of the
 * node's outcomes. The transcript gets `decision-start` and `decision` as
 * for a Decision decided by a model; the checker's reasons are the `note`
 * output and its cost goes on `StepEnded`. A usage limit or a network
 * failure of the checker fails the step: waiting would run the agent again.
 */
async function checkOutcome(
	ctx: StepContext,
	node: AgentNode,
	step: StepHandle,
	outputs: StepOutputs,
	harnessSessionId: string | null,
): Promise<StepEnd> {
	const checker = node.checker as NonNullable<AgentNode["checker"]>;
	const { signal } = step;
	const options = checkOutcomes(node);
	const model = checker.model ?? DECIDER_ADAPTERS[checker.decider].defaultModel;
	const task = renderTemplate(node.prompt, step.tctx);
	const brief = checker.prompt
		? renderTemplate(checker.prompt, step.tctx).trim()
		: "";
	const sections = [
		brief || DEFAULT_CHECK_BRIEF,
		"## The agent's task",
		node.skill ? `/${node.skill} ${task}`.trim() : task,
		"## The agent's summary",
		String(outputs.summary ?? ""),
		"## The agent's final message",
		String(outputs.output ?? ""),
		...(outputs.data !== undefined
			? ["## The agent's data", JSON.stringify(outputs.data, null, 2)]
			: []),
	];
	const prompt = sections.join("\n\n");
	step.record(null, {
		type: "decision-start",
		prompt,
		labels: options.map((option) => option.name),
		model,
	});
	const finish = (
		outcome: StepEnd["outcome"],
		note: string,
		error: string | null,
		costUsd: number | null,
	) =>
		step.end(outcome, { ...outputs, outcome, note }, error, {
			harnessSessionId,
			costUsd,
		});
	if (!ctx.decider) {
		return finish(
			"error",
			"",
			"No decider is configured for the checker of this Agent node.",
			null,
		);
	}
	const result = await decideWithin(
		ctx.decider,
		{ decider: checker.decider, prompt, labels: options, model, signal },
		signal,
	);
	const costUsd = result.costUsd;
	if (result.kind === "decided") {
		step.record(null, {
			type: "decision",
			label: result.label,
			notes: result.notes,
		});
	}
	const note = result.kind === "decided" ? result.notes : "";
	const aborted = step.abortResult({ ...outputs, note });
	if (aborted) {
		return step.end(aborted.outcome, aborted.outputs, aborted.error, {
			harnessSessionId,
			costUsd,
		});
	}
	if (result.kind === "error") {
		return finish(
			"error",
			note,
			`The checker failed: ${result.message}`,
			costUsd,
		);
	}
	const problem = optionProblem(options, result.label);
	if (problem !== null) return finish("error", note, problem, costUsd);
	return finish(result.label, note, null, costUsd);
}
