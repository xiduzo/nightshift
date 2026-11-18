import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	type AgentNode,
	type AgentTier,
	personTierIndex,
	renderCommand,
} from "@nightshift/flows";
import { runCommand } from "../../../device";
import { type RunState, scopeKey } from "../../../log";
import { lastHarnessSessionOfNode } from "../../../read";
import type { Climb } from "../../cascade";
import {
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../../context";
import { heldStep } from "../../position";
import { scopeOf } from "../../route";
import type { RunStateValues } from "../../state";
import {
	type BodyResult,
	RESUME_RULES,
	rerunEntryOf,
	runStep,
	type StepEntry,
	type StepHandle,
} from "../../step";
import { climbing, previousFailure, retryAsk } from "../decide";
import { agentAskNode } from "./agent-ask";
import { cliToolsInstalled, harnessesAdded, programsOf } from "./requirements";
import { agentPrompt, runSession } from "./session";

/**
 * The Agent node: one harness session per visit, ported from `runAgentStep`
 * in engine.ts. The log is written as there: `SessionStarted`,
 * `HarnessSessionAssigned`, `SessionEnded`, then the step's end.
 *
 * The step lifecycle is the step runner's (`runStep`, graph/step/step-runner.ts),
 * which enters through the one resume point (`RESUME_RULES.agent`): a step
 * that waited continues with its harness session and the pending prompt as
 * the follow-up (nothing is appended before `SessionStarted`), or is
 * reopened (`StepReopened`) when recovery ended it after the wake; a parked
 * step a person resumed, or a step the daemon died in (design rule 5), is
 * reopened when it has a harness session to continue, with the resume
 * prompt; else a new visit. With `session: "resume"` a new visit continues
 * the node's last harness session (`lastHarnessSessionOfNode`).
 *
 * The body is `runSession` (`session.ts`): one harness session, recorded
 * through the step's session record, and the step's end from the report. A
 * usage limit or a network failure is a wait request; the runner plans the
 * wait and parks at the wait node (`wait__<id>`, the shared `waitNode`), or
 * ends the step `error` on a give-up. With `ask: "person"` a report of
 * `needs-input` asks a person instead (`agent-ask.ts`): the runner opens a
 * Gate on the open step, and the answer reopens it with the note as the
 * prompt.
 *
 * What the node needs of a Device is in `requirements.ts`, and what its
 * agent reports in `report.ts`.
 */
export function agentNode(node: AgentNode, ctx: StepContext): NodeAction {
	if (node.cascade !== undefined) {
		return climbing(node, ctx, {
			person: retryAsk,
			attempt: (own, climb) => agentTry(node, own, ctx, climb),
		});
	}
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: AGENT.resumeRules(node),
			body: (step, entry) => {
				// The first visit of a rerun from this node: the person chose
				// to continue a session, or to start fresh.
				const rerun =
					entry.kind === "new"
						? rerunEntryOf(node, step.runState, scopeOf(config))
						: undefined;
				// The person's answer at the agent's Gate, when this entry goes on from it.
				const asked = heldStep(state, node.id);
				const answer =
					asked?.kind === "gate" && asked.answer !== undefined
						? asked.answer
						: null;
				return runSession(ctx, node, step, {
					note: answer,
					prompt:
						rerun !== undefined
							? (rerun?.prompt ?? null)
							: entry.kind === "new"
								? null
								: entry.prompt,
					resumeSessionId:
						rerun !== undefined
							? (rerun?.harnessSessionId ?? null)
							: resumeSessionOf(node, entry, state, step, config),
				});
			},
		});
}

/**
 * One try of an Agent with a cascade (ADR 6, `climbing`): `own` is the
 * agent of its tier (`tierNode`), tried up to the tier's `tries`, then the
 * next tier's. A try holds when the agent ends `pass` (or an own outcome)
 * and the node's `check` exits 0. The next try gets the failure in its
 * prompt; `session: "resume"` continues the session of the try before
 * within a tier, and a new tier starts a new session. `ask: "person"`
 * works inside a try as without a cascade. The person tier is a Gate with
 * "try-again" and "stop" (`climb-gate.ts`).
 */
function agentTry(
	node: AgentNode,
	own: AgentNode,
	ctx: StepContext,
	climb: Climb<AgentTier>,
): NodeAction {
	const { at } = climb;
	const previous = at.trail.at(-1);
	// Within a tier, `session: "resume"` goes on with the try before.
	const resumed =
		at.try > 1 && own.session === "resume" && previous?.session_id
			? previous.session_id
			: null;
	return (state, config) =>
		runStep(ctx, own, state, config, {
			rules: AGENT.resumeRules(own),
			body: async (step, entry) => {
				const asked = heldStep(state, node.id);
				const answer =
					asked?.kind === "gate" && asked.answer !== undefined
						? asked.answer
						: null;
				const told =
					previous === undefined
						? null
						: previousFailure(previous, node.check, at.note);
				const prompt =
					entry.kind !== "new"
						? entry.prompt
						: told === null
							? null
							: resumed !== null
								? told
								: `${agentPrompt(own, step.tctx)}\n\n${told}`;
				const result = await runSession(ctx, own, step, {
					note: answer,
					prompt,
					resumeSessionId:
						entry.kind !== "new" ? entry.harnessSessionId : resumed,
				});
				return checkTry(ctx, node, step, result);
			},
			climb,
		});
}

/**
 * The node's check, run after a try's end that holds so far: an exit
 * other than 0 ends the try `fail`, with the check's log tail. The check's
 * output goes to the step's transcript and its command log, as a Command
 * node's does.
 */
async function checkTry(
	ctx: StepContext,
	node: AgentNode,
	step: StepHandle,
	result: BodyResult,
): Promise<BodyResult> {
	if (result.kind !== "end") return result;
	const check = node.check;
	if (
		check === undefined ||
		result.outcome === "fail" ||
		result.outcome === "needs-input" ||
		result.outcome === "error"
	) {
		return result;
	}
	const { command, env } = renderCommand(check, step.tctx);
	step.record(null, { type: "command-start", command });
	const run = await runCommand(step.device, {
		command,
		cwd: step.worktree,
		env,
		logPath: ctx.log.files(ctx.run.id).commandLog(step.stepId),
		signal: step.signal,
		onOutput: (stream, text) =>
			step.record(null, { type: "command-output", stream, text }),
	});
	if (run.refused === null) {
		step.record(null, { type: "command-exit", exitCode: run.exitCode });
	}
	const outputs = { ...result.outputs, log_tail: run.logTail };
	if (step.signal.aborted) {
		return {
			kind: "aborted",
			outputs,
			harnessSessionId: result.harnessSessionId ?? null,
		};
	}
	if (run.exitCode === 0) return { ...result, outputs };
	const why =
		run.refused ??
		(run.spawnError !== null
			? `The check could not start: ${run.spawnError}`
			: `The check \`${check}\` exited with code ${run.exitCode ?? "none"}.`);
	return {
		...result,
		outcome: "fail",
		outputs: { ...outputs, outcome: "fail" },
		error: why,
	};
}

/**
 * The Agent kind. A wait node for the policy's waits; `pass` and the
 * node's own outcomes are chosen ends, and an own outcome is the label a
 * Call reports; the idle timer is this kind's alone; an Agent that asks a
 * person has an ask node for its Gate; the Device must have its
 * connections, CLI tools and harness.
 */
export const AGENT: NodeKind<AgentNode> = {
	...PLAIN_KIND,
	type: "agent",
	make: agentNode,
	works: () => "worktree",
	resumeRules: () => RESUME_RULES.agent,
	// The ask node serves `ask` and a cascade's person tier alike.
	aux: (node) =>
		node.ask === "person" || personTierIndex(node) !== null
			? [{ kind: "wait" }, { kind: "ask", make: agentAskNode }]
			: [{ kind: "wait" }],
	// Every Agent step has an idle clock: its own, else the run policy's.
	timeBudget: (node, policy) => ({
		timeoutMinutes: node.timeoutMinutes,
		idleMinutes: node.idleMinutes ?? policy.idleMinutes,
	}),
	// The check of a cascade writes the step's command log.
	logsCommandOutput: (node) => node.check !== undefined,
	connections: (node) => node.connections ?? [],
	programs: programsOf,
	requirements: [cliToolsInstalled, harnessesAdded],
};

/**
 * The harness session the visit continues: the one the resume point found
 * for a continued or reopened step, or with `session: "resume"` the node's
 * last session for a new visit; else none.
 */
function resumeSessionOf(
	node: AgentNode,
	entry: StepEntry,
	state: RunStateValues,
	step: StepHandle,
	config: LangGraphRunnableConfig,
): string | null {
	if (entry.kind !== "new") return entry.harnessSessionId;
	return node.session === "resume"
		? lastSessionOf(node, state, step.runState, config)
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
	runState: RunState,
	config: LangGraphRunnableConfig,
): string | null {
	const own = state.nodes[node.id]?.session_id;
	if (typeof own === "string" && own !== "") return own;
	return lastHarnessSessionOfNode(runState, node.id, scopeKey(scopeOf(config)));
}
