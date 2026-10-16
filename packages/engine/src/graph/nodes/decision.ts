import { Command, interrupt } from "@langchain/langgraph";
import type {
	Decider,
	DecisionInput,
	DecisionResult,
} from "@nightshift/agents/types";
import { type DecisionNode, renderTemplate } from "@nightshift/flows";

import { deriveSteps, type LoggedEvent, type StepOutputs } from "../../events";
import {
	beginStep,
	beginWait,
	isWaitKind,
	messageOf,
	type NodeAction,
	STOP_GRACE_MS,
	type StepContext,
	type StepHandle,
	type StepStart,
	type WaitRequest,
} from "../context";
import { route, type StepEnd, waitNodeId } from "../route";
import type {
	Parked,
	PendingParked,
	ResumeValue,
	RunStateValues,
} from "../state";

/**
 * The Decision node: the decider picks one of the node's labels, which is
 * the step's outcome. Port of `runDecisionStep` and `decideWithin` in
 * engine.ts. The transcript gets `decision-start` (the rendered prompt, the
 * label names, the model) and, on a decision, `decision`; `StepEnded`
 * carries the decider's cost as `costUsd`, also on an error or a stop.
 *
 * How the node enters: with `pending.kind === "wait"` for this node, the
 * step that waited for a usage limit or the network continues (same step
 * id and visit; nothing is appended before the decider is asked again),
 * or is reopened first when recovery ended it after the wake. Otherwise a
 * new visit: a parked or interrupted Decision step has no session to
 * reopen.
 *
 * A usage limit or a network failure of the decider plans a wait
 * (`beginWait`) and jumps to the node's wait node (`wait__<id>`,
 * `decisionWaitNode`), which interrupts; a give-up ends the step `error`.
 */
export function decisionNode(node: DecisionNode, ctx: StepContext): NodeAction {
	return async (state, config) => {
		const begun = await beginStep(
			ctx,
			node,
			state,
			config,
			entryOf(node, state, await ctx.log.events(ctx.run.id)),
		);
		if (begun.kind === "parked") return begun.command;
		const step = begun.step;

		let result: StepEnd;
		try {
			const decided = await decide(ctx, node, step);
			if ("reason" in decided) {
				const waited = await beginWait(ctx, node, step, decided);
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
					{ visit: step.visit, notes: "", outcome: "error" },
					waited.error,
					{ costUsd: decided.costUsd },
				);
			} else {
				result = decided;
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
 * The Decision node's wait node: interrupts with the planned wait and, on
 * the resume, jumps back to the node. A `wake` continues the step (the
 * decider is asked again); a `resume` (the run was stopped while it slept,
 * and a person resumed it) parks the step as stopped and the node starts
 * its next visit, as the engine does today after `closeParked`.
 */
export function decisionWaitNode(
	node: DecisionNode,
	_ctx: StepContext,
): NodeAction {
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
				harnessSessionId: null,
				prompt: answer.prompt ?? null,
				status: "stopped",
				reason: null,
			};
			return new Command({ update: { pending: parked }, goto: node.id });
		}
		return new Command({ update: { pending }, goto: node.id });
	};
}

/**
 * The step continues after a wait, or is reopened (`StepReopened`) when
 * recovery ended it `interrupted` meanwhile (the daemon died after the
 * wake), so the log keeps one open step to end; anything else is a new
 * visit.
 */
function entryOf(
	node: DecisionNode,
	state: RunStateValues,
	events: readonly LoggedEvent[],
): StepStart {
	const pending = state.pending;
	if (pending?.kind === "wait" && pending.nodeId === node.id) {
		const own = deriveSteps(events).find((s) => s.id === pending.stepId);
		if (own && own.endedAt !== null) {
			return { kind: "reopen", stepId: own.id, prompt: null };
		}
		return { kind: "continue", stepId: pending.stepId };
	}
	return { kind: "new" };
}

/** A wait request that also carries what the decider cost before it hit the limit. */
type DecisionWait = WaitRequest & { costUsd: number | null };

/** Asks the decider and ends the step on its answer, or asks for a wait. */
async function decide(
	ctx: StepContext,
	node: DecisionNode,
	step: StepHandle,
): Promise<StepEnd | DecisionWait> {
	const { visit, signal } = step;
	const prompt = renderTemplate(node.prompt, step.tctx);
	const labels = node.labels.map((label) => label.name);
	step.record(null, {
		type: "decision-start",
		prompt,
		labels,
		model: node.model,
	});
	if (!ctx.decider) {
		return step.end(
			"error",
			{ visit, notes: "", outcome: "error" },
			"No decider is configured for Decision nodes.",
		);
	}
	const result = await decideWithin(
		ctx.decider,
		{
			cwd: ctx.run.worktreePath,
			prompt,
			labels: node.labels.map((label) =>
				label.description === undefined
					? { name: label.name }
					: { name: label.name, description: label.description },
			),
			model: node.model,
			tools: node.tools ?? [],
			signal,
		},
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
	const outputs: StepOutputs = {
		visit,
		notes: result.kind === "decided" ? result.notes : "",
	};
	const end = (
		outcome: StepEnd["outcome"],
		ended: StepOutputs,
		error: string | null,
	) => step.end(outcome, ended, error, { costUsd });
	const aborted = step.abortResult(outputs);
	if (aborted) return end(aborted.outcome, aborted.outputs, aborted.error);
	if (result.kind === "error") {
		if (isWaitKind(result.errorKind)) {
			return {
				reason: result.errorKind,
				message: result.message,
				resetAt: null,
				harnessSessionId: null,
				costUsd,
			};
		}
		return end(
			"error",
			{ ...outputs, outcome: "error" },
			`The decider failed: ${result.message}`,
		);
	}
	if (!labels.includes(result.label)) {
		return end(
			"error",
			{ ...outputs, outcome: "error" },
			`The decider picked "${result.label}", which is not a label of this node. The labels are: ${labels.join(", ")}.`,
		);
	}
	return end(result.label, { ...outputs, outcome: result.label }, null);
}

/**
 * Asks the decider, but never waits on it longer than `STOP_GRACE_MS` past
 * an abort: a decider that ignores its signal cannot hold the run. A decider
 * that throws (against its contract) counts as an error.
 */
async function decideWithin(
	decider: Decider,
	input: DecisionInput,
	signal: AbortSignal,
): Promise<DecisionResult> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const late = new Promise<DecisionResult>((resolve) => {
		onAbort = () => {
			timer = setTimeout(
				() =>
					resolve({
						kind: "error",
						errorKind: "aborted",
						message: "The decider did not stop when it was aborted.",
						costUsd: null,
					}),
				STOP_GRACE_MS,
			);
		};
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([
			decider.decide(input).catch(
				(error): DecisionResult => ({
					kind: "error",
					errorKind: "harness",
					message: messageOf(error),
					costUsd: null,
				}),
			),
			late,
		]);
	} finally {
		clearTimeout(timer);
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}
