import { randomUUID } from "node:crypto";
import {
	Command,
	interrupt,
	type LangGraphRunnableConfig,
} from "@langchain/langgraph";
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
	renderTemplate,
	resolvedAgent,
} from "@nightshift/flows";
import { eq } from "drizzle-orm";

import { consumeStream } from "../../consume";
import {
	type DerivedStep,
	deriveSteps,
	type EnginePayloads,
	type LoggedEvent,
	lastHarnessSessionOfNode,
	type StepOutputs,
	scopeKey,
} from "../../events";
import { checkOutputData } from "../../output-schema";
import {
	beginStep,
	beginWait,
	DEFAULT_RESUME_PROMPT,
	HARNESS_LABEL,
	isWaitKind,
	messageOf,
	type NodeAction,
	STOP_GRACE_MS,
	type StepContext,
	type StepHandle,
	type StepStart,
	type WaitRequest,
} from "../context";
import { route, type StepEnd, scopeOf, waitNodeId } from "../route";
import type {
	Parked,
	PendingParked,
	ResumeValue,
	RunStateValues,
} from "../state";

/**
 * The Agent node: one harness session per visit, ported from `runAgentStep`
 * in engine.ts. The log is written as there: `SessionStarted`,
 * `HarnessSessionAssigned`, `SessionEnded`, then the step's end.
 *
 * How the node enters, in this order:
 *
 * 1. `pending.kind === "wait"` for this node: the step waited and the wait
 *    ended (the runner appended `WaitEnded`). The step continues: same step
 *    id and visit, the harness session the log assigned, `pending.prompt`
 *    as the follow-up (the wake's prompt, or "Continue where you left
 *    off."). Nothing is appended before `SessionStarted`. If recovery ended
 *    the step meanwhile (the daemon died after the wake), it is reopened
 *    instead (`StepReopened`), with the prompt of the latest `RunResumed`
 *    for it when the daemon left one, else the wait's prompt; a step that
 *    never got a harness session reopens with a new session on the node's
 *    own prompt.
 * 2. `pending.kind === "parked"` for this node with a step that has a
 *    harness session: a person resumed the parked step. `StepReopened` with
 *    the resume prompt, then a new session of the same harness session.
 *    A parked step without a harness session starts a new visit.
 * 3. No `pending`, but the log has a step of this node the graph never
 *    committed (the daemon died while it ran, design rule 5): when it has a
 *    harness session, it is reopened with the prompt of the latest
 *    `RunResumed` for it (the engine appends it before `invoke(null)`),
 *    else "Continue where you left off.". Without a harness session, a new
 *    visit.
 * 4. Else a new visit. With `session: "resume"`, it continues the node's
 *    last harness session (`lastHarnessSessionOfNode`).
 *
 * A usage limit or a network failure plans a wait (`beginWait`) and jumps
 * to the wait node (`wait__<id>`), which interrupts; a give-up ends the
 * step `error`. Everything else ends the step and routes (`route()`).
 */
export function agentNode(node: AgentNode, ctx: StepContext): NodeAction {
	return async (state, config) => {
		const events = await ctx.log.events(ctx.run.id);
		const entry = entryOf(node, state, events, config);
		const begun = await beginStep(ctx, node, state, config, entry.start);
		if (begun.kind === "parked") return begun.command;
		const step = begun.step;

		let result: StepEnd | WaitRequest;
		try {
			result = await runSession(ctx, node, step, {
				prompt: entry.prompt,
				resumeSessionId: entry.resumeSessionId,
			});
			if ("reason" in result) {
				const waited = await beginWait(ctx, node, step, result);
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

/**
 * The Agent node's wait node: interrupts with the planned wait (the runner
 * schedules the wake timer from it) and, on the resume, jumps back to the
 * Agent node. A `wake` continues the step with its prompt; a `resume` (the
 * run was stopped while it slept, and a person resumed it) reopens the
 * step, as the engine does today after `closeParked`.
 */
export function agentWaitNode(node: AgentNode, _ctx: StepContext): NodeAction {
	return async (state: RunStateValues) => {
		const pending = state.pending;
		if (pending?.kind !== "wait" || pending.nodeId !== node.id) {
			throw new Error(`Nothing waits at node "${node.id}".`);
		}
		const value: Parked = {
			kind: "wait",
			stepId: pending.stepId,
			nodeId: node.id,
			reason: pending.reason,
			until: pending.until,
			message: pending.message,
		};
		const answer = interrupt<Parked, ResumeValue | undefined>(value);
		if (answer?.kind === "resume") {
			const parked: PendingParked = {
				kind: "parked",
				stepId: pending.stepId,
				nodeId: node.id,
				visit: pending.visit,
				harnessSessionId: pending.harnessSessionId,
				prompt: answer.prompt ?? null,
				status: "stopped",
				reason: null,
			};
			return new Command({ update: { pending: parked }, goto: node.id });
		}
		const prompt =
			answer?.kind === "wake" && answer.prompt !== undefined
				? answer.prompt
				: pending.prompt;
		return new Command({
			update: { pending: { ...pending, prompt } },
			goto: node.id,
		});
	};
}

type Entry = {
	start: StepStart;
	/** The follow-up message of a continued session; null renders the node's prompt. */
	prompt: string | null;
	resumeSessionId: string | null;
};

/** The harness session a step has, from the log. */
function sessionOf(step: DerivedStep | undefined): string | null {
	return (
		step?.sessions.findLast((s) => s.harnessSessionId)?.harnessSessionId ?? null
	);
}

/** The prompt the latest `RunResumed` for this step carries, if any. */
function resumePromptOf(
	events: readonly LoggedEvent[],
	step: DerivedStep,
): string | null {
	const resumed = events.findLast(
		(e) =>
			e.type === "RunResumed" &&
			e.seq > step.startSeq &&
			e.payload.stepId === step.id,
	);
	return resumed?.type === "RunResumed" ? resumed.payload.prompt : null;
}

function entryOf(
	node: AgentNode,
	state: RunStateValues,
	events: readonly LoggedEvent[],
	config: LangGraphRunnableConfig,
): Entry {
	const steps = deriveSteps(events);
	const pending = state.pending?.nodeId === node.id ? state.pending : null;
	const reopen = (
		step: DerivedStep,
		harnessSessionId: string,
		prompt: string,
	): Entry => ({
		start: { kind: "reopen", stepId: step.id, prompt },
		prompt,
		resumeSessionId: harnessSessionId,
	});

	if (pending?.kind === "wait") {
		const own = steps.find((s) => s.id === pending.stepId);
		const harnessSessionId = pending.harnessSessionId ?? sessionOf(own);
		if (own && own.endedAt !== null) {
			// Recovery ended the step after the wake (the daemon died while it
			// continued): a reopen, as a resume does, with the daemon's resume
			// prompt when it left one. Without a harness session the node's
			// own prompt starts a new session of the reopened step.
			if (harnessSessionId) {
				return reopen(
					own,
					harnessSessionId,
					resumePromptOf(events, own) ?? pending.prompt,
				);
			}
			return {
				start: { kind: "reopen", stepId: own.id, prompt: null },
				prompt: null,
				resumeSessionId: null,
			};
		}
		return {
			start: { kind: "continue", stepId: pending.stepId },
			// After a wait: the step's own harness session, if it got one.
			prompt: harnessSessionId ? pending.prompt : null,
			resumeSessionId: harnessSessionId,
		};
	}
	if (pending?.kind === "parked" && pending.stepId) {
		const own = steps.find((s) => s.id === pending.stepId);
		const harnessSessionId = pending.harnessSessionId ?? sessionOf(own);
		if (own && harnessSessionId) {
			return reopen(
				own,
				harnessSessionId,
				pending.prompt ?? DEFAULT_RESUME_PROMPT,
			);
		}
	}
	if (!pending) {
		const scope = scopeOf(config);
		const key = scopeKey(scope);
		const logged = steps.filter(
			(s) => s.nodeId === node.id && scopeKey(s.scope) === key,
		);
		const stale =
			logged.length > (state.visits[node.id] ?? 0) ? logged.at(-1) : undefined;
		const harnessSessionId = sessionOf(stale);
		if (stale && harnessSessionId) {
			return reopen(
				stale,
				harnessSessionId,
				resumePromptOf(events, stale) ?? DEFAULT_RESUME_PROMPT,
			);
		}
	}
	return {
		start: { kind: "new" },
		prompt: null,
		resumeSessionId:
			node.session === "resume"
				? lastHarnessSessionOfNode(events, node.id, scopeKey(scopeOf(config)))
				: null,
	};
}

const BUILT_IN_AGENT_OUTCOMES = ["pass", "fail", "needs-input"];

/** The outcomes an Agent node may report. */
function agentOutcomes(node: AgentNode): string[] {
	return node.outcomes?.map((o) => o.name) ?? BUILT_IN_AGENT_OUTCOMES;
}

/** What the harness asks the agent to report: a spec for own outcomes or an output schema. */
function stepReportOf(node: AgentNode): AgentSessionInput["stepReport"] {
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
			prompt,
			model: agent.model,
			permissionMode: agent.permissionMode,
			effort: agent.effort,
			resumeSessionId: resumeSessionId ?? undefined,
			stepReport: stepReportOf(node),
			...(node.clis && node.clis.length > 0 ? { clis: node.clis } : {}),
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
