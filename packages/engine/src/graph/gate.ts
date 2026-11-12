import type { AskForm } from "@nightshift/flows";
import type { GateChoice, GateDeadline, GateVia, StepEvent } from "../log";
import { isTestRun } from "../run-status";
import type { StepContext } from "./context";
import { saysAnything, type WrittenBrief } from "./gate-brief";

/**
 * Opens a Gate on a step that stays open: a person answers it. Two nodes
 * ask a person: a Decision decided by a person (`choosers/person.ts`), and
 * an Agent that asks a person when it needs input (`ask`, the step runner).
 * Both open the Gate the same way, so the inbox, the notifications and the
 * phone show it the same way.
 *
 * The fact goes in the log first, so the Gate is open even when the daemon
 * dies before the transcript line is written. A Gate with a `deadline` (a
 * Decision's, worked out as it opens) logs it with the Gate: the runner
 * sets its timer from there. An Ask (a Value made by a person, ADR 10)
 * logs its form with the Gate. Its brief (ADR 21) goes with it when it
 * says anything, with the cost of the model that wrote part of it.
 */
export async function openGate(
	ctx: Pick<StepContext, "log" | "bus" | "run">,
	step: {
		stepId: string;
		record(sessionId: string | null, event: StepEvent): void;
	},
	gate: {
		question: string;
		choices: GateChoice[];
		lockScreen?: boolean;
		deadline?: GateDeadline | null;
		form?: AskForm;
		brief?: WrittenBrief | null;
	},
): Promise<void> {
	const { stepId } = step;
	const { question, brief } = gate;
	const choices = brief?.choices ?? gate.choices;
	const due = gate.deadline ? { deadline: gate.deadline } : {};
	await ctx.log.append({
		type: "GateOpened",
		runId: ctx.run.id,
		stepId,
		payload: {
			question,
			choices,
			...(gate.lockScreen === true ? { lockScreen: true as const } : {}),
			...due,
			...(gate.form ? { form: gate.form } : {}),
			...(brief && saysAnything(brief)
				? { urgency: brief.urgency, brief: brief.brief }
				: {}),
			...(brief?.cost
				? {
						briefCostUsd: brief.cost.costUsd,
						...(brief.cost.costSource !== undefined
							? { briefCostSource: brief.cost.costSource }
							: {}),
					}
				: {}),
		},
	});
	step.record(null, { type: "gate-open", question, choices, ...due });
	ctx.bus.publish(ctx.run.id, { kind: "step-changed", stepId });
}

/**
 * Scores a Gate's answer (`Scored`, `gate_decision`, on the Gate's step):
 * the option it took, and whether a person or the deadline chose it. Both
 * nodes that ask a person score it the same way.
 */
export async function scoreGate(
	ctx: Pick<StepContext, "log" | "run" | "usage">,
	stepId: string,
	answer: { choice: string; byDeadline?: boolean; via?: GateVia },
): Promise<void> {
	const via = answer.via ?? "_OTHER";
	await ctx.log.append({
		type: "Scored",
		runId: ctx.run.id,
		stepId,
		payload: {
			score: "gate_decision",
			value: 1,
			label: answer.choice,
			by: answer.byDeadline ? "deadline" : "person",
			via,
		},
	});
	if (!ctx.usage) return;
	const state = await ctx.log.state(ctx.run.id);
	// A test run sends no usage event (ADR 27): its Gates count nowhere but in the run.
	if (isTestRun(state)) return;
	const step = state.steps.get(stepId);
	const waits = step?.gateWaits ?? [];
	let waitMs = 0;
	for (const wait of waits) {
		if (wait.to !== null && wait.to >= wait.from) waitMs += wait.to - wait.from;
	}
	ctx.usage.note({
		kind: "gate-answered",
		by: answer.byDeadline ? "deadline" : "person",
		via,
		waitMs,
		hasDeadline: step?.gate?.deadline != null,
		isForm: step?.gate?.form != null,
	});
}
