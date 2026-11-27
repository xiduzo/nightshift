import { Command } from "@langchain/langgraph";
import type { DerivedStep, RunState, StepOutputs } from "../../log";
import { ANSWER_DROPPED, OUTRUN_ERROR } from "../../read";
import type { StepContext } from "../context";
import { commitVisit } from "../position";
import type { RunStateValues } from "../state";

/**
 * The end of a step whose branch lost its `first` Join (`outrun` in
 * `branches.ts`), when that step is in the log already: a held Gate or
 * sleep, or a step that a resume or a new daemon takes up again. It ends
 * `stopped` with the outrun words, and so does each open step of its
 * called flows: a Gate in a Subflow closes, and a sleep there ends. The
 * branch goes no further.
 */

/** Ends `step` of `node` and the open steps of its called flows as outrun. The node goes nowhere. */
export async function endOutrun(
	ctx: Pick<StepContext, "log" | "run" | "bus" | "flow" | "kindOf">,
	nodeId: string,
	step: DerivedStep,
	state: Pick<RunStateValues, "loops">,
): Promise<Command> {
	const run = await ctx.log.state(ctx.run.id);
	const node = ctx.flow.nodes.find((n) => n.id === nodeId);
	const inside: { open: DerivedStep; outputs: StepOutputs }[] = openInside(
		run,
		step.id,
	).map((open) => ({ open, outputs: { ...open.outputs, outcome: "stopped" } }));
	if (step.endedAt === null) {
		inside.push({
			open: step,
			outputs: node
				? ctx.kindOf(node).cutShortOutputs(step, node, "stopped")
				: { ...step.outputs, outcome: "stopped" },
		});
	}
	for (const { open, outputs } of inside) {
		await ctx.log.append({
			type: "StepEnded",
			runId: ctx.run.id,
			stepId: open.id,
			payload: { outcome: "stopped", outputs, error: OUTRUN_ERROR },
		});
		// An answer that waited for the drive goes with the Gate.
		if (open.gate?.queued) {
			await ctx.log.append({
				type: "RunWarned",
				runId: ctx.run.id,
				stepId: open.id,
				payload: {
					kind: "answer-dropped",
					message: `${ANSWER_DROPPED} ${OUTRUN_ERROR}`,
				},
			});
		}
		ctx.bus.publish(ctx.run.id, { kind: "step-changed", stepId: open.id });
	}
	return new Command({
		update: {
			pending: { [nodeId]: null },
			...commitVisit({ id: nodeId }, step.visit),
			...(state.loops?.[nodeId] ? { loops: { [nodeId]: null } } : {}),
		},
	});
}

/** The open steps of the flows `stepId` calls, at any depth, innermost first. */
function openInside(run: RunState, stepId: string): DerivedStep[] {
	const inside = (step: DerivedStep): boolean => {
		let parent = step.scope?.parentStepId ?? null;
		while (parent !== null) {
			if (parent === stepId) return true;
			parent = run.steps.get(parent)?.scope?.parentStepId ?? null;
		}
		return false;
	};
	return [...run.steps.values()]
		.filter((step) => step.endedAt === null && inside(step))
		.sort((a, b) => b.startSeq - a.startSeq);
}
