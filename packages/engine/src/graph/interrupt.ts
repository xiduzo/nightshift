import {
	type Command,
	interrupt,
	isGraphInterrupt,
	type LangGraphRunnableConfig,
} from "@langchain/langgraph";

import type { NodeAction, StepContext } from "./context";
import { heldStep, holdEnded } from "./run-position";
import type { Parked, Pending, ResumeValue, RunStateValues } from "./state";

/**
 * The one interrupting graph node. Three nodes park a thread at an
 * interrupt: the wait node (a sleep, `graph/sleep.ts`), the park node (a
 * failed or stopped step, `graph/route.ts`) and the Gate's ask node
 * (`choosers/person.ts`). Each did the same three things with its own
 * `pending`: check it is this node's, interrupt with a copy of it, and jump
 * back on the answer. That skeleton lives here once; a node gives only what
 * differs: the copy the interrupt carries (`value`) and what its answer
 * does (`answer`).
 *
 * Nothing before `interrupt()` has a side effect (design rule 4): the node
 * re-runs on the resume, and only `answer` writes state. The interrupt
 * payloads (`Parked`) are the seam to the runner and the tests; this module
 * does not change them.
 *
 * A held step can be stale: a stop ended the open Gate or the sleep in the
 * log after the node held it, and before the hold was checkpointed (the
 * run position, `holdEnded`). No answer comes for it, so with no answer
 * waiting the node lets the step go (`letGo`) instead of waiting forever:
 * the Gate asks again, a sleep parks as stopped. An answer that waits is
 * taken as always.
 */
export function interruptNode<K extends Pending["kind"]>(spec: {
	kind: K;
	nodeId: string;
	/** The error when nothing of this kind is pending at the node. */
	missing: string;
	/** What the interrupt carries: a copy of the pending step, as the runner reads it. */
	value(pending: Extract<Pending, { kind: K }>): Parked;
	/** What the resume does: the `Command` the node returns. */
	answer(
		pending: Extract<Pending, { kind: K }>,
		answer: ResumeValue | undefined,
		state: RunStateValues,
		config: LangGraphRunnableConfig,
	): Command | Promise<Command>;
	/** A held step the log may have ended: the log to look in, and what the node does then. */
	stale?: {
		ctx: Pick<StepContext, "log" | "run">;
		letGo(
			pending: Extract<Pending, { kind: K }>,
			state: RunStateValues,
			config: LangGraphRunnableConfig,
		): Command | Promise<Command>;
	};
}): NodeAction {
	return async (state, config) => {
		const pending = heldStep(state, spec.nodeId);
		if (pending?.kind !== spec.kind) {
			throw new Error(spec.missing);
		}
		const own = pending as Extract<Pending, { kind: K }>;
		let answer: ResumeValue | undefined;
		try {
			answer = interrupt<Parked, ResumeValue | undefined>(spec.value(own));
		} catch (error) {
			// No answer waits. A stale hold gets none: the node lets it go.
			const { stale } = spec;
			if (
				isGraphInterrupt(error) &&
				stale &&
				holdEnded(await stale.ctx.log.events(stale.ctx.run.id), own)
			) {
				return stale.letGo(own, state, config);
			}
			throw error;
		}
		return spec.answer(own, answer, state, config);
	};
}
