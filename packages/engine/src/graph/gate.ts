import type { GateChoice, StepEvent } from "../log";
import type { StepContext } from "./context";

/**
 * Opens a Gate on a step that stays open: a person answers it. Two nodes
 * ask a person: a Decision decided by a person (`choosers/person.ts`), and
 * an Agent that asks a person when it needs input (`ask`, the step runner).
 * Both open the Gate the same way, so the inbox, the notifications and the
 * phone show it the same way.
 *
 * The fact goes in the log first, so the Gate is open even when the daemon
 * dies before the transcript line is written.
 */
export async function openGate(
	ctx: Pick<StepContext, "log" | "bus" | "run">,
	step: {
		stepId: string;
		record(sessionId: string | null, event: StepEvent): void;
	},
	gate: { question: string; choices: GateChoice[]; lockScreen?: boolean },
): Promise<void> {
	const { stepId } = step;
	const { question, choices } = gate;
	await ctx.log.append({
		type: "GateOpened",
		runId: ctx.run.id,
		stepId,
		payload: {
			question,
			choices,
			...(gate.lockScreen === true ? { lockScreen: true as const } : {}),
		},
	});
	step.record(null, { type: "gate-open", question, choices });
	ctx.bus.publish(ctx.run.id, { kind: "step-changed", stepId });
}
