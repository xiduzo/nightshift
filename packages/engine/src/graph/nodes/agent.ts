import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type {
	AgentEvent,
	AgentHarness,
	AgentSessionInput,
	HarnessName,
	StepReportOutcome,
	StepReportSpec,
} from "@nightshift/agents/types";
import {
	type AgentNode,
	type FlowNode,
	type JsonValue,
	type Outcome,
	optionProblem,
	renderTemplate,
	resolvedAgent,
} from "@nightshift/flows";

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
	HARNESS_LABEL,
	isWaitKind,
	messageOf,
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type Requirement,
	STOP_GRACE_MS,
	type StepContext,
} from "../context";
import { RESUME_RULES, type ResumePoint } from "../resume-point";
import { scopeOf } from "../route";
import type { RunStateValues } from "../state";
import { type BodyResult, runStep, type StepHandle } from "../step-runner";
import { decideWithin } from "./choosers/model";

/**
 * The Agent node: one harness session per visit, ported from `runAgentStep`
 * in engine.ts. The log is written as there: `SessionStarted`,
 * `HarnessSessionAssigned`, `SessionEnded`, then the step's end.
 *
 * The step lifecycle is the step runner's (`runStep`, graph/step-runner.ts),
 * which enters through the one resume point (`RESUME_RULES.agent`): a step
 * that waited continues with its harness session and the pending prompt as
 * the follow-up (nothing is appended before `SessionStarted`), or is
 * reopened (`StepReopened`) when recovery ended it after the wake; a parked
 * step a person resumed, or a step the daemon died in (design rule 5), is
 * reopened when it has a harness session to continue, with the resume
 * prompt; else a new visit. With `session: "resume"` a new visit continues
 * the node's last harness session (`lastHarnessSessionOfNode`).
 *
 * This module is the body, `runSession`: one harness session, recorded
 * through the step's session record, and the step's end from the report. A
 * usage limit or a network failure is a wait request; the runner plans the
 * wait and parks at the wait node (`wait__<id>`, the shared `waitNode`), or
 * ends the step `error` on a give-up.
 */
export function agentNode(node: AgentNode, ctx: StepContext): NodeAction {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: AGENT.resumeRules(node),
			body: (step, entry) =>
				runSession(ctx, node, step, {
					prompt: entry.kind === "new" ? null : entry.prompt,
					resumeSessionId: resumeSessionOf(node, entry, state, step, config),
				}),
		});
}

/** An Agent's own outcome, other than one named `fail` or `needs-input`. */
export function isOwnAgentLabel(node: AgentNode, outcome: Outcome): boolean {
	return (
		node.outcomes !== undefined &&
		outcome !== "fail" &&
		outcome !== "needs-input"
	);
}

/** Agent nodes name CLI tools the daemon defines. */
export const cliToolsDefined: Requirement<AgentNode> = (nodes, has) => {
	const unknown = missingNames(
		nodes,
		(node) => node.clis ?? [],
		has.cliNames(),
	);
	if (unknown.length === 0) return null;
	return unknown
		.map(
			({ name, nodeIds }) =>
				`The flow uses the CLI tool "${name}" (${nodeIds.join(", ")}), but no CLI tool has that name. Add it under Agents → Tools.`,
		)
		.join(" ");
};

/** Every CLI tool an Agent node uses is on this computer. */
export const cliToolsInstalled: Requirement<AgentNode> = (nodes, has) => {
	const notFound = [
		...new Set(
			// A node's own CLI tools need no definition, but this computer must have them.
			nodes.flatMap((n) => [...(n.clis ?? []), ...(n.nodeClis ?? [])]),
		),
	].filter((name) => has.findCli(name) === null);
	if (notFound.length === 0) return null;
	return notFound
		.map(
			(name) =>
				`The flow uses the CLI tool "${name}", but this computer does not have it. Install ${name}, or take it off the flow.`,
		)
		.join(" ");
};

/** Agent nodes run on harnesses the daemon has added. */
export const harnessesAdded: Requirement<AgentNode> = (nodes, has) => {
	const missing = missingHarnesses(nodes, has.harnessFor);
	if (missing.length === 0) return null;
	return missing
		.map(
			({ harness, nodeIds }) =>
				`The flow has ${nodeIds.length === 1 ? "an Agent node" : "Agent nodes"} on ${HARNESS_LABEL[harness]} (${nodeIds.join(", ")}), but no ${HARNESS_LABEL[harness]} harness is added. Add it under Agents.`,
		)
		.join(" ");
};

/** An Agent node's checker needs the decider. */
export const checkersHaveDecider: Requirement<AgentNode> = (nodes, has) =>
	!has.decider && nodes.some((n) => n.checker !== undefined)
		? "The flow has an Agent node with a checker, but no decider is configured."
		: null;

/** The harnesses the Agent nodes name that the daemon has not configured, with their nodes. */
function missingHarnesses(
	nodes: readonly AgentNode[],
	harnessFor: (name: HarnessName) => AgentHarness | undefined,
): { harness: HarnessName; nodeIds: string[] }[] {
	const missing = new Map<HarnessName, string[]>();
	for (const node of nodes) {
		if (node.harness === undefined) continue;
		if (harnessFor(node.harness)) continue;
		const ids = missing.get(node.harness) ?? [];
		if (!ids.includes(node.id)) ids.push(node.id);
		missing.set(node.harness, ids);
	}
	return [...missing].map(([harness, nodeIds]) => ({ harness, nodeIds }));
}

/** The names the nodes list that the daemon does not have, with their nodes. */
export function missingNames<N extends FlowNode>(
	nodes: readonly N[],
	listed: (node: N) => readonly string[],
	names: ReadonlySet<string>,
): { name: string; nodeIds: string[] }[] {
	const missing = new Map<string, string[]>();
	for (const node of nodes) {
		for (const name of listed(node)) {
			if (names.has(name)) continue;
			const ids = missing.get(name) ?? [];
			if (!ids.includes(node.id)) ids.push(node.id);
			missing.set(name, ids);
		}
	}
	return [...missing].map(([name, nodeIds]) => ({ name, nodeIds }));
}

/**
 * The Agent kind. A wait node for the policy's waits; `pass` and the
 * node's own outcomes are chosen ends, and an own outcome is the label a
 * Call reports; the idle timer is this kind's alone; the daemon must have
 * its connections, CLI tools, harness and, for a checker, the decider.
 */
export const AGENT: NodeKind<AgentNode> = {
	...PLAIN_KIND,
	type: "agent",
	make: agentNode,
	resumeRules: () => RESUME_RULES.agent,
	aux: () => [{ kind: "wait" }],
	isChosenEnd: (node, outcome) =>
		outcome === "pass" || isOwnAgentLabel(node, outcome),
	endedLabel: (node, outcome) =>
		isOwnAgentLabel(node, outcome) ? outcome : "",
	timeBudget: (node) => ({
		timeoutMinutes: node.timeoutMinutes,
		idleMinutes: node.idleMinutes,
	}),
	connections: (node) => node.connections ?? [],
	requirements: [
		cliToolsDefined,
		cliToolsInstalled,
		harnessesAdded,
		checkersHaveDecider,
	],
};

/**
 * The harness session the visit continues: the one the resume point found
 * for a continued or reopened step, or with `session: "resume"` the node's
 * last session for a new visit; else none.
 */
function resumeSessionOf(
	node: AgentNode,
	entry: ResumePoint,
	state: RunStateValues,
	step: StepHandle,
	config: LangGraphRunnableConfig,
): string | null {
	if (entry.kind !== "new") return entry.harnessSessionId;
	return node.session === "resume"
		? lastSessionOf(node, state, step.events, config)
		: null;
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
): Promise<BodyResult> {
	const { visit, signal } = step;
	const { resumeSessionId } = input;
	const prompt =
		input.prompt ??
		(() => {
			const rendered = renderTemplate(node.prompt, step.tctx);
			return node.skill ? `/${node.skill} ${rendered}`.trim() : rendered;
		})();

	const end = (
		outcome: string,
		outputs: StepOutputs,
		error: string | null,
		harnessSessionId: string | null,
	): BodyResult => ({ kind: "end", outcome, outputs, error, harnessSessionId });

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

	const session = await step.session({
		prompt,
		resumeSessionId,
		harness: agent.harness,
	});
	const sessionId = session.id;

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
	await session.ended(final);

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
): Promise<BodyResult> {
	const checker = node.checker as NonNullable<AgentNode["checker"]>;
	const { signal } = step;
	const options = checkOutcomes(node);
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
	const finish = (
		outcome: string,
		note: string,
		error: string | null,
		costUsd: number | null,
	): BodyResult => ({
		kind: "end",
		outcome,
		outputs: { ...outputs, outcome, note },
		error,
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
	// The decider port says which model a checker without one starts on.
	const model =
		checker.model ?? ctx.decider.defaultModel(checker.decider, "decision");
	step.record(null, {
		type: "decision-start",
		prompt,
		labels: options.map((option) => option.name),
		model,
	});
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
	if (signal.aborted) {
		return {
			kind: "aborted",
			outputs: { ...outputs, note },
			harnessSessionId,
			costUsd,
		};
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
