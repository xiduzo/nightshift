import { Command, interrupt } from "@langchain/langgraph";

import type { NodeAction } from "./context";
import type {
	Parked,
	PendingParked,
	ResumeValue,
	RunStateValues,
} from "./state";

/**
 * The wait node of an Agent node, a Decision decided by a model, or a Wait
 * node (`wait__<id>`, design rule 8). It interrupts with the planned wait
 * (the runner schedules the wake timer from it) and, on the resume, jumps
 * back to the node:
 *
 * - a `wake` continues the step with its prompt (the wake's, else the
 *   pending one); the node continues the same step and harness session;
 * - a `signal` (someone sent the run a signal) continues the step with the
 *   signal's name in `pending.signal`; a Wait node on it ends `done`;
 * - a `resume` (the run was stopped while it slept, and a person resumed
 *   it) parks the step as stopped and jumps back, so the node reopens the
 *   step when it has a session, else starts its next visit, as the engine
 *   does after `closeParked`.
 */
export function waitNode(nodeId: string): NodeAction {
	return async (state: RunStateValues) => {
		const pending = state.pending;
		if (pending?.kind !== "wait" || pending.nodeId !== nodeId) {
			throw new Error(`Nothing waits at node "${nodeId}".`);
		}
		const value: Parked = {
			kind: "wait",
			stepId: pending.stepId,
			nodeId,
			reason: pending.reason,
			until: pending.until,
			message: pending.message,
		};
		const answer = interrupt<Parked, ResumeValue | undefined>(value);
		if (answer?.kind === "resume") {
			const parked: PendingParked = {
				kind: "parked",
				stepId: pending.stepId,
				nodeId,
				visit: pending.visit,
				harnessSessionId: pending.harnessSessionId,
				prompt: answer.prompt ?? null,
				status: "stopped",
				reason: null,
			};
			return new Command({ update: { pending: parked }, goto: nodeId });
		}
		if (answer?.kind === "signal") {
			return new Command({
				update: { pending: { ...pending, signal: answer.name } },
				goto: nodeId,
			});
		}
		const prompt =
			answer?.kind === "wake" && answer.prompt !== undefined
				? answer.prompt
				: pending.prompt;
		return new Command({
			update: { pending: { ...pending, prompt } },
			goto: nodeId,
		});
	};
}
